import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { App } from '@slack/bolt';
import { Gateway, type SlackApprovalAction, type SlackMessageEvent, type SlackPublisher } from './gateway.js';

export interface BoltGatewayRuntime {
  app: App;
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
}

interface BoltRuntimeConfig {
  botToken: string;
  appToken: string;
}

interface SlackPublisherOptions {
  slackAgentChatStatusEnabled: boolean;
}

interface RawSlackEventEnvelope {
  team_id?: string;
  authorizations?: Array<{
    team_id?: string;
  }>;
}

interface RawSlackMessageEvent {
  team?: string;
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

const debugSlackEvents = process.env.DEBUG_SLACK_EVENTS === 'true';
const DOWNLOADABLE_IMAGE_MIME_PREFIX = 'image/';
const MAX_DOWNLOADABLE_SLACK_FILE_BYTES = 10 * 1024 * 1024;
const DOWNLOADABLE_TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/xml',
  'application/x-yaml',
  'text/xml',
]);

export function createBoltGatewayRuntime(
  gateway: Gateway,
  config: BoltRuntimeConfig,
): BoltGatewayRuntime {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
  });

  app.event('message', async ({ event, body, context }) => {
    const rawEvent = event as RawSlackMessageEvent;
    const envelope = body as RawSlackEventEnvelope;

    try {
      const messageEvent = await buildSlackMessageEvent(rawEvent, config.botToken, {
        team_id: resolveTeamId(rawEvent, envelope, context),
      });
      logSlackEvent('message', rawEvent);
      if (!messageEvent) {
        logDroppedSlackMessageEvent(rawEvent, 'missing required identity fields');
        return;
      }

      await gateway.handleMessageEvent(messageEvent);
    } catch (error) {
      logSlackMessageHandlingError(rawEvent, error);
    }
  });

  const actionHandler = async ({ ack, body, action }: any, decision: 'approve' | 'reject') => {
    await ack();

    const raw = action?.value;
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Omit<SlackApprovalAction, 'decision'>;

    await gateway.handleApprovalAction({
      ...parsed,
      decision,
    });

    const channelId = body?.channel?.id;
    const messageTs = getActionMessageTs(body);
    if (channelId && messageTs) {
      const originalPrompt = readApprovalPrompt(body, parsed.prompt);
      await app.client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `${originalPrompt}\n\n選択: ${decision === 'approve' ? 'Approve' : 'Reject'}`,
        blocks: buildResolvedApprovalBlocks(originalPrompt, decision) as any,
      });
    }
  };

  app.action('approve', async (args) => actionHandler(args, 'approve'));
  app.action('reject', async (args) => actionHandler(args, 'reject'));

  return {
    app,
    start: async (port?: number) => {
      if (typeof port === 'number') {
        await app.start(port);
        return;
      }
      await app.start();
    },
    stop: async () => {
      await app.stop();
    },
  };
}

export function createSlackPublisher(
  getApp: () => App,
  options: SlackPublisherOptions,
): SlackPublisher {
  return {
    postThreadMessage: async ({ channel_id, root_thread_ts, text, blocks }) => {
      logSlackClient('chat.postMessage', {
        channel_id,
        root_thread_ts,
        text,
      });
      await getApp().client.chat.postMessage({
        channel: channel_id,
        thread_ts: root_thread_ts,
        text,
        blocks: blocks as any,
      });
    },
    uploadThreadFiles: async ({ channel_id, root_thread_ts, files }) => {
      for (const file of files) {
        logSlackClient('filesUploadV2', {
          channel_id,
          root_thread_ts,
          path: file.path,
        });
        await getApp().client.filesUploadV2({
          channel_id,
          thread_ts: root_thread_ts,
          file: file.path,
          filename: basename(file.path),
          alt_text: file.alt_text,
        });
      }
    },
    setThreadStatus: async ({ channel_id, root_thread_ts, status, loading_messages }) => {
      if (!options.slackAgentChatStatusEnabled) {
        logSlackClient('chat.postMessage.status-fallback', {
          channel_id,
          root_thread_ts,
          status,
        });
        await getApp().client.chat.postMessage({
          channel: channel_id,
          thread_ts: root_thread_ts,
          text: status,
        });
        return;
      }

      logSlackClient('assistant.threads.setStatus', {
        channel_id,
        root_thread_ts,
        status,
        loading_messages,
      });
      await getApp().client.assistant.threads.setStatus({
        channel_id,
        thread_ts: root_thread_ts,
        status,
        loading_messages,
      });
    },
  };
}

export function toSlackMessageEvent(event: RawSlackMessageEvent): SlackMessageEvent | null {
  if (!event.team || !event.user || !event.channel_type) {
    return null;
  }

  return {
    team_id: event.team,
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
    team: event.team ?? fallback?.team_id,
  });
  if (!baseEvent) {
    return null;
  }

  try {
    const downloaded = await downloadSlackFiles(event.files, botToken);
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

export function buildResolvedApprovalBlocks(
  prompt: string,
  decision: 'approve' | 'reject',
): Array<Record<string, unknown>> {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: prompt,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `選択: *${decision === 'approve' ? 'Approve' : 'Reject'}*`,
        },
      ],
    },
  ];
}

export function getActionMessageTs(body: any): string | undefined {
  return body?.container?.message_ts ?? body?.message?.ts;
}

export function readApprovalPrompt(body: any, fallback?: string): string {
  const text = body?.message?.blocks?.[0]?.text?.text;
  if (typeof text === 'string' && text.trim() !== '') {
    return text;
  }

  if (typeof fallback === 'string' && fallback.trim() !== '') {
    return fallback;
  }

  return 'Approval required to continue.';
}

export function appendDownloadedFilesToText(
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

  const attachmentSection = ['添付ファイル:', ...attachmentLines].join('\n');
  return [text.trim(), attachmentSection].filter(Boolean).join('\n\n');
}

export const appendDownloadedImagesToText = appendDownloadedFilesToText;

async function downloadSlackFiles(
  files: RawSlackMessageEvent['files'],
  botToken: string,
): Promise<{
  directory?: string;
  files: Array<{ path: string; name?: string; mimetype?: string }>;
  warnings: string[];
}> {
  if (!Array.isArray(files) || files.length === 0) {
    return { files: [], warnings: [] };
  }

  let directory: string | undefined;
  const downloaded: Array<{ path: string; name?: string; mimetype?: string }> = [];
  const warnings: string[] = [];

  for (const file of files) {
    const rejectionReason = rejectSlackFileDownload(file);
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

      directory ??= await mkdtemp(join(tmpdir(), 'codex-agent-slack-files-'));
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

function rejectSlackFileDownload(file: NonNullable<RawSlackMessageEvent['files']>[number]): string | undefined {
  if (typeof file.size === 'number' && file.size > MAX_DOWNLOADABLE_SLACK_FILE_BYTES) {
    return `サイズ上限 ${formatBytes(MAX_DOWNLOADABLE_SLACK_FILE_BYTES)} を超えています (${formatBytes(file.size)})。`;
  }

  if (!isDownloadableSlackFile(file)) {
    return `未対応の MIME type です (${file.mimetype ?? 'unknown'})。`;
  }

  return undefined;
}

function isDownloadableSlackFile(file: NonNullable<RawSlackMessageEvent['files']>[number]): boolean {
  if (typeof file.mimetype !== 'string') {
    return false;
  }

  return (
    file.mimetype.startsWith(DOWNLOADABLE_IMAGE_MIME_PREFIX) ||
    file.mimetype.startsWith('text/') ||
    DOWNLOADABLE_TEXT_MIME_TYPES.has(file.mimetype)
  );
}

function formatSlackAttachmentWarning(
  file: NonNullable<RawSlackMessageEvent['files']>[number],
  reason: string,
): string {
  const label = file.name ?? file.id ?? 'unknown';
  return `- ${label}: ${reason}`;
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
    return `${Math.round(value / 102.4) / 10} KB`;
  }

  return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`;
}

function logSlackEvent(type: string, event: RawSlackMessageEvent): void {
  if (!debugSlackEvents) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    '[slack:event]',
    JSON.stringify({
      type,
      team: event.team ?? null,
      channel: event.channel ?? null,
      user: event.user ?? null,
      ts: event.ts ?? null,
      thread_ts: event.thread_ts ?? null,
      parent_user_id: event.parent_user_id ?? null,
      assistant_thread_ts: event.assistant_thread?.thread_ts ?? null,
      channel_type: event.channel_type ?? null,
      subtype: event.subtype ?? null,
      has_text: Boolean(event.text),
      files_count: event.files?.length ?? 0,
    }),
  );
}

function logSlackClient(type: string, details: Record<string, unknown>): void {
  if (!debugSlackEvents) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[slack:client]', JSON.stringify({ type, ...details }));
}

function resolveTeamId(
  event: RawSlackMessageEvent,
  envelope?: RawSlackEventEnvelope,
  context?: { teamId?: string },
): string | undefined {
  return event.team ?? envelope?.team_id ?? envelope?.authorizations?.[0]?.team_id ?? context?.teamId;
}

function logDroppedSlackMessageEvent(event: RawSlackMessageEvent, reason: string): void {
  // eslint-disable-next-line no-console
  console.error(
    '[slack:event-dropped]',
    JSON.stringify({
      reason,
      channel: event.channel ?? null,
      user: event.user ?? null,
      ts: event.ts ?? null,
      subtype: event.subtype ?? null,
      channel_type: event.channel_type ?? null,
      has_text: Boolean(event.text),
      files_count: event.files?.length ?? 0,
    }),
  );
}

function logSlackMessageHandlingError(event: RawSlackMessageEvent, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    '[slack:message-handler-error]',
    JSON.stringify({
      error: String(error),
      channel: event.channel ?? null,
      user: event.user ?? null,
      ts: event.ts ?? null,
      subtype: event.subtype ?? null,
      channel_type: event.channel_type ?? null,
      has_text: Boolean(event.text),
      files_count: event.files?.length ?? 0,
    }),
  );
}

function logSlackFileDownloadError(
  stage: 'build' | 'fetch' | 'file',
  event: RawSlackMessageEvent | undefined,
  error: unknown,
  file?: { id?: string; name?: string; mimetype?: string; size?: number },
): void {
  // eslint-disable-next-line no-console
  console.error(
    '[slack:file-download-error]',
    JSON.stringify({
      stage,
      error: String(error),
      team: event?.team ?? null,
      channel: event?.channel ?? null,
      ts: event?.ts ?? null,
      file_id: file?.id ?? null,
      file_name: file?.name ?? null,
      mimetype: file?.mimetype ?? null,
      size: file?.size ?? null,
    }),
  );
}
