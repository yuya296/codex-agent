import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
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
    url_private?: string;
    url_private_download?: string;
  }>;
}

const DOWNLOADABLE_IMAGE_MIME_PREFIX = 'image/';

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

export async function buildSlackMessageEvent(
  event: RawSlackMessageEvent,
  botToken: string,
  fallback?: { team_id?: string },
): Promise<SlackMessageEvent | null> {
  const baseEvent = toSlackMessageEvent({
    ...event,
    team_id: event.team_id ?? event.team ?? fallback?.team_id,
  });
  if (!baseEvent) {
    return null;
  }

  try {
    const downloaded = await downloadSlackImageFiles(event.files, botToken);
    return {
      ...baseEvent,
      text: appendDownloadedImagesToText(baseEvent.text, downloaded.files),
      temporary_directory: downloaded.directory,
    };
  } catch (error) {
    logSlackImageDownloadError('build', event, error);
    return baseEvent;
  }
}

export function appendDownloadedImagesToText(
  text: string,
  files: Array<{ path: string; name?: string; mimetype?: string }>,
): string {
  if (files.length === 0) {
    return text;
  }

  const attachmentLines = files.map((file) => {
    const label = file.name ? `${file.name}: ` : '';
    return `- ${label}${file.path}`;
  });

  const attachmentSection = ['添付画像:', ...attachmentLines].join('\n');
  return [text.trim(), attachmentSection].filter(Boolean).join('\n\n');
}

async function downloadSlackImageFiles(
  files: RawSlackMessageEvent['files'],
  botToken: string,
): Promise<{
  directory?: string;
  files: Array<{ path: string; name?: string; mimetype?: string }>;
}> {
  if (!Array.isArray(files) || files.length === 0) {
    return { files: [] };
  }

  const imageFiles = files.filter((file) => isDownloadableImageFile(file));
  if (imageFiles.length === 0) {
    return { files: [] };
  }

  const directory = await mkdtemp(join(tmpdir(), 'codex-agent-slack-files-'));
  const downloaded: Array<{ path: string; name?: string; mimetype?: string }> = [];

  for (const file of imageFiles) {
    try {
      const sourceUrl = file.url_private_download ?? file.url_private;
      if (!sourceUrl) {
        continue;
      }

      const response = await fetch(sourceUrl, {
        headers: {
          Authorization: `Bearer ${botToken}`,
        },
      });
      if (!response.ok) {
        logSlackImageDownloadError(
          'fetch',
          undefined,
          new Error(`Slack returned ${response.status}`),
          file,
        );
        continue;
      }

      const fileName = sanitizeDownloadedFileName(file.name, file.mimetype);
      const targetPath = join(directory, fileName);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writeFile(targetPath, bytes);
      downloaded.push({
        path: targetPath,
        name: file.name,
        mimetype: file.mimetype,
      });
    } catch (error) {
      logSlackImageDownloadError('file', undefined, error, file);
    }
  }

  if (downloaded.length === 0) {
    await rm(directory, { recursive: true, force: true });
    return { files: [] };
  }

  return { directory, files: downloaded };
}

function isDownloadableImageFile(file: NonNullable<RawSlackMessageEvent['files']>[number]): boolean {
  return typeof file.mimetype === 'string' && file.mimetype.startsWith(DOWNLOADABLE_IMAGE_MIME_PREFIX);
}

function sanitizeDownloadedFileName(name?: string, mimetype?: string): string {
  const baseName = (name && basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')) || 'attachment';
  if (extname(baseName)) {
    return baseName;
  }

  const fallbackExtension = mimeTypeToExtension(mimetype);
  return `${baseName}${fallbackExtension}`;
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
  return '';
}

function logSlackImageDownloadError(
  stage: 'build' | 'fetch' | 'file',
  event: RawSlackMessageEvent | undefined,
  error: unknown,
  file?: { id?: string; name?: string; mimetype?: string },
): void {
  // eslint-disable-next-line no-console
  console.error(
    '[slack:image-download-error]',
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
