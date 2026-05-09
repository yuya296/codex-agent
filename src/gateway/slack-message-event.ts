import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { SlackMessageEvent } from './gateway.js';

export interface RawSlackMessageEvent {
  team?: string;
  team_id?: string;
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  parent_user_id?: string;
  assistant_thread?: {
    thread_ts?: string;
  };
  channel_type?: 'im' | 'channel' | 'group' | 'mpim';
  subtype?: string;
  files?: Array<{
    id?: string;
    name?: string;
    mimetype?: string;
    size?: number;
    url_private?: string;
    url_private_download?: string;
  }>;
}

const execFileAsync = promisify(execFile);
const MAX_ATTACHMENT_PREVIEW_CHARS = 6000;
const MAX_TEXT_ATTACHMENT_BYTES = 64 * 1024;
const PREVIEWABLE_TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/xml',
  'application/x-yaml',
  'text/xml',
]);

export function toSlackMessageEvent(event: RawSlackMessageEvent): SlackMessageEvent | null {
  const teamId = event.team ?? event.team_id;
  if (!teamId || !event.user || !event.channel_type) {
    return null;
  }

  return {
    team_id: teamId,
    channel_id: event.channel,
    user_id: event.user,
    text: event.text ?? '',
    ts: event.ts,
    thread_ts: event.thread_ts,
    parent_user_id: event.parent_user_id,
    assistant_thread: event.assistant_thread,
    channel_type: event.channel_type,
    subtype: event.subtype,
  };
}

export interface BuildSlackMessageEventOptions {
  fallback?: { team_id?: string };
  tmpDir?: string;
}

export async function buildSlackMessageEvent(
  event: RawSlackMessageEvent,
  botToken: string,
  maxBytes: number,
  options: BuildSlackMessageEventOptions = {},
): Promise<SlackMessageEvent | null> {
  const baseEvent = toSlackMessageEvent({
    ...event,
    team_id: event.team_id ?? event.team ?? options.fallback?.team_id,
  });
  if (!baseEvent) {
    return null;
  }

  if (!shouldDownloadSlackAttachments(baseEvent)) {
    return baseEvent;
  }

  try {
    const downloaded = await downloadSlackFiles(event.files, botToken, maxBytes, options.tmpDir);
    return {
      ...baseEvent,
      text: appendDownloadedFilesToText(baseEvent.text, downloaded.files),
      attachment_warnings: downloaded.warnings.length > 0 ? downloaded.warnings : undefined,
      downloaded_files_count: downloaded.files.length,
      temporary_directory: downloaded.directory,
    };
  } catch (error) {
    logSlackFileDownloadError('build', event, error);
    return baseEvent;
  }
}

export function appendDownloadedFilesToText(
  text: string,
  files: Array<{ path: string; name?: string; mimetype?: string; preview?: string }>,
): string {
  if (files.length === 0) {
    return text;
  }

  const attachmentLines = files.map((file) => {
    const label = file.name ? `${file.name}: ` : '';
    return `- ${label}${file.path}`;
  });

  const attachmentSection = ['添付ファイル:', ...attachmentLines].join('\n');
  const previewLines = files
    .filter((file) => file.preview)
    .flatMap((file) => {
      const title = `- ${file.name ?? basename(file.path)}`;
      return [title, file.preview ?? ''];
    });
  const previewSection =
    previewLines.length > 0 ? ['添付ファイル内容:', ...previewLines].join('\n') : '';

  return [text.trim(), attachmentSection, previewSection].filter(Boolean).join('\n\n');
}

async function downloadSlackFiles(
  files: RawSlackMessageEvent['files'],
  botToken: string,
  maxBytes: number,
  tmpDir?: string,
): Promise<{
  directory?: string;
  files: Array<{ path: string; name?: string; mimetype?: string; preview?: string }>;
  warnings: string[];
}> {
  if (!Array.isArray(files) || files.length === 0) {
    return { files: [], warnings: [] };
  }

  const baseDir = tmpDir ?? tmpdir();
  let directory: string | undefined;
  const downloaded: Array<{ path: string; name?: string; mimetype?: string; preview?: string }> = [];
  const warnings: string[] = [];

  for (const file of files) {
    const rejectionReason = rejectSlackFileDownload(file, maxBytes);
    if (rejectionReason) {
      warnings.push(formatSlackAttachmentWarning(file, rejectionReason));
      continue;
    }

    try {
      const sourceUrl = file.url_private_download ?? file.url_private;
      if (!sourceUrl) {
        warnings.push(formatSlackAttachmentWarning(file, 'ダウンロード URL が見つかりません。'));
        continue;
      }

      if (directory === undefined) {
        if (tmpDir) {
          await mkdir(tmpDir, { recursive: true });
        }
        directory = await mkdtemp(join(baseDir, 'codex-agent-slack-files-'));
      }
      const response = await fetch(sourceUrl, {
        headers: {
          Authorization: `Bearer ${botToken}`,
        },
      });
      if (!response.ok) {
        logSlackFileDownloadError('fetch', undefined, new Error(`Slack returned ${response.status}`), file);
        warnings.push(
          formatSlackAttachmentWarning(file, `ダウンロードに失敗しました (HTTP ${response.status})。`),
        );
        continue;
      }

      const fileName = sanitizeDownloadedFileName(file.id, file.name, file.mimetype);
      const targetPath = join(directory, fileName);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writeFile(targetPath, bytes);
      const preview = await extractSlackFilePreview(targetPath, file.mimetype);
      downloaded.push({
        path: targetPath,
        name: file.name,
        mimetype: file.mimetype,
        preview,
      });
    } catch (error) {
      logSlackFileDownloadError('file', undefined, error, file);
      warnings.push(formatSlackAttachmentWarning(file, `ダウンロードに失敗しました (${String(error)})。`));
    }
  }

  if (downloaded.length === 0 && directory) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }

  return { directory, files: downloaded, warnings };
}

function shouldDownloadSlackAttachments(event: SlackMessageEvent): boolean {
  return event.channel_type === 'im' && (!event.subtype || event.subtype === 'file_share');
}

function rejectSlackFileDownload(
  file: NonNullable<RawSlackMessageEvent['files']>[number],
  maxBytes: number,
): string | undefined {
  if (typeof file.size === 'number' && file.size > maxBytes) {
    return `サイズ上限 ${formatBytes(maxBytes)} を超えています (${formatBytes(file.size)})。`;
  }

  return undefined;
}

function formatSlackAttachmentWarning(
  file: NonNullable<RawSlackMessageEvent['files']>[number],
  reason: string,
): string {
  const label = file.name ?? file.id ?? 'unknown';
  return `- ${label}: ${reason}`;
}

async function extractSlackFilePreview(path: string, mimetype?: string): Promise<string | undefined> {
  try {
    if (mimetype === 'application/pdf') {
      const { stdout } = await execFileAsync('pdftotext', ['-layout', path, '-'], {
        maxBuffer: 1024 * 1024,
      });
      return normalizeAttachmentPreview(stdout);
    }

    if (
      (typeof mimetype === 'string' && mimetype.startsWith('text/')) ||
      (mimetype && PREVIEWABLE_TEXT_MIME_TYPES.has(mimetype))
    ) {
      const buffer = await readFile(path);
      return normalizeAttachmentPreview(buffer.subarray(0, MAX_TEXT_ATTACHMENT_BYTES).toString('utf8'));
    }
  } catch (error) {
    logSlackAttachmentPreviewError(path, mimetype, error);
  }

  return undefined;
}

function normalizeAttachmentPreview(value: string): string | undefined {
  const trimmed = value.replace(/\u0000/g, '').trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length <= MAX_ATTACHMENT_PREVIEW_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS)}\n...`;
}

function sanitizeDownloadedFileName(id?: string, name?: string, mimetype?: string): string {
  const baseName = (name && basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')) || 'attachment';
  const safeId = id ? id.replace(/[^a-zA-Z0-9._-]/g, '_') : undefined;
  const suffix = safeId ? `-${safeId}` : '';
  if (extname(baseName)) {
    const extension = extname(baseName);
    const stem = baseName.slice(0, -extension.length) || 'attachment';
    return `${stem}${suffix}${extension}`;
  }

  const fallbackExtension = mimeTypeToExtension(mimetype);
  return `${baseName}${suffix}${fallbackExtension}`;
}

function mimeTypeToExtension(mimetype?: string): string {
  if (mimetype === 'image/jpeg') {
    return '.jpg';
  }
  if (mimetype === 'image/png') {
    return '.png';
  }
  if (mimetype === 'image/gif') {
    return '.gif';
  }
  if (mimetype === 'image/webp') {
    return '.webp';
  }
  if (mimetype === 'application/pdf') {
    return '.pdf';
  }
  if (mimetype === 'application/json') {
    return '.json';
  }
  if (mimetype === 'application/xml' || mimetype === 'text/xml') {
    return '.xml';
  }
  if (mimetype === 'application/x-yaml') {
    return '.yaml';
  }
  if (typeof mimetype === 'string' && mimetype.startsWith('text/')) {
    return '.txt';
  }
  return '';
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function logSlackAttachmentPreviewError(path: string, mimetype: string | undefined, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    '[slack:file-preview-error]',
    JSON.stringify({
      error: String(error),
      path,
      mimetype: mimetype ?? null,
    }),
  );
}

function logSlackFileDownloadError(
  stage: 'build' | 'fetch' | 'file',
  event: RawSlackMessageEvent | undefined,
  error: unknown,
  file?: { id?: string; name?: string; mimetype?: string },
): void {
  // eslint-disable-next-line no-console
  console.error(
    '[slack:file-download-error]',
    JSON.stringify({
      stage,
      error: String(error),
      team: event?.team ?? event?.team_id ?? null,
      channel: event?.channel ?? null,
      ts: event?.ts ?? null,
      file_id: file?.id ?? null,
      file_name: file?.name ?? null,
      mimetype: file?.mimetype ?? null,
    }),
  );
}
