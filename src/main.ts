import { createBoltGatewayRuntime } from './gateway/bolt.js';
import { Gateway } from './gateway/gateway.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { SessionRepository } from './repository/session-repository.js';
import { loadConfigFromEnv } from './config/index.js';
import { StdioJsonRpcWorkerClient } from './worker/stdio-jsonrpc-worker-client.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  process.env.CODEX_HOME = config.codexHome;

  const repository = new SessionRepository(config.sqlitePath);
  const workerClient = new StdioJsonRpcWorkerClient(
    config.workerCommand,
    config.workerArgs,
    config.workerCwd,
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
        await runtime.app.client.chat.postMessage({
          channel: channel_id,
          thread_ts: root_thread_ts,
          text,
          blocks: blocks as any,
        });
      },
      setThreadStatus: async ({ channel_id, root_thread_ts, status }) => {
        if (!config.slackAgentChatStatusEnabled) {
          await runtime.app.client.chat.postMessage({
            channel: channel_id,
            thread_ts: root_thread_ts,
            text: status,
          });
          return;
        }

        await runtime.app.client.assistant.threads.setStatus({
          channel_id,
          thread_ts: root_thread_ts,
          status,
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
