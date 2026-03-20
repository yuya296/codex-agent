import { createBoltGatewayRuntime } from './gateway/bolt.js';
import { Gateway } from './gateway/gateway.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { SessionRepository } from './repository/session-repository.js';
import { loadConfigFromEnv } from './config/index.js';
import { StdioJsonRpcWorkerClient } from './worker/stdio-jsonrpc-worker-client.js';

const debugSlackEvents = process.env.DEBUG_SLACK_EVENTS === 'true';
const debugWorkerEvents = process.env.DEBUG_WORKER_EVENTS === 'true';
const debugWorkerEventDeltas = process.env.DEBUG_WORKER_EVENT_DELTAS === 'true';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  process.env.CODEX_HOME = config.codexHome;

  const repository = new SessionRepository(config.sqlitePath);
  const workerClient = new StdioJsonRpcWorkerClient(
    config.workerCommand,
    config.workerArgs,
    config.workerCwd,
    {
      streamEventTimeoutMs: config.workerStreamEventTimeoutMs,
      debugEvents: debugWorkerEvents,
      debugDeltaEvents: debugWorkerEventDeltas,
    },
  );

  let gateway!: Gateway;
  const orchestrator = new Orchestrator(repository, workerClient, {
    notifyProgress: async (session, message) => gateway.notifyProgress(session, message),
    notifyApproval: async (session, approval) => gateway.notifyApproval(session, approval),
    notifyCompleted: async (session, message) => gateway.notifyCompleted(session, message),
    notifyFailed: async (session, message) => gateway.notifyFailed(session, message),
  });

  const runtime = createBoltGatewayRuntime(
    (gateway = new Gateway(orchestrator, {
      postThreadMessage: async ({ channel_id, root_thread_ts, text, blocks }) => {
        logSlackClient('chat.postMessage', {
          channel_id,
          root_thread_ts,
          text,
        });
        await runtime.app.client.chat.postMessage({
          channel: channel_id,
          thread_ts: root_thread_ts,
          text,
          blocks: blocks as any,
        });
      },
      setThreadStatus: async ({ channel_id, root_thread_ts, status, loading_messages }) => {
        if (!config.slackAgentChatStatusEnabled) {
          logSlackClient('chat.postMessage.status-fallback', {
            channel_id,
            root_thread_ts,
            status,
          });
          await runtime.app.client.chat.postMessage({
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
        await runtime.app.client.assistant.threads.setStatus({
          channel_id,
          thread_ts: root_thread_ts,
          status,
          loading_messages,
        });
      },
    })),
    {
      botToken: config.slackBotToken,
      appToken: config.slackAppToken,
    },
  );

  await runtime.start(config.port);
  // eslint-disable-next-line no-console
  console.log('codex-agent started');

  const shutdown = async () => {
    await runtime.stop();
    await workerClient.close();
    repository.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();

function logSlackClient(type: string, details: Record<string, unknown>): void {
  if (!debugSlackEvents) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[slack:client]', JSON.stringify({ type, ...details }));
}
