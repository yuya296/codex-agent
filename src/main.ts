import { createRedisState } from '@chat-adapter/state-redis';
import {
  createAdminCommandHandler,
  getCodexVersion,
  getLatestCodexVersion,
  runAdminDoctor,
} from './admin/commands.js';
import { loadConfigFromEnv } from './config/index.js';
import { createChatGatewayRuntime } from './gateway/chat-sdk.js';
import { Gateway } from './gateway/gateway.js';
import { RestartableWorkerClient } from './worker/restartable-worker-client.js';
import { StdioJsonRpcWorkerClient } from './worker/stdio-jsonrpc-worker-client.js';

const debugWorkerEvents = process.env.DEBUG_WORKER_EVENTS === 'true';
const debugWorkerEventDeltas = process.env.DEBUG_WORKER_EVENT_DELTAS === 'true';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  process.env.CODEX_HOME = config.codexHome;

  const state = createRedisState({
    keyPrefix: 'codex-agent',
    url: config.redisUrl,
  });

  const workerClient = new RestartableWorkerClient(
    () => new StdioJsonRpcWorkerClient(
      config.workerCommand,
      config.workerArgs,
      config.workerCwd,
      {
        streamEventTimeoutMs: config.workerStreamEventTimeoutMs,
        debugEvents: debugWorkerEvents,
        debugDeltaEvents: debugWorkerEventDeltas,
      },
    ),
  );

  const adminCommands = createAdminCommandHandler({
    getStatusContext: async () => ({
      processUptimeSeconds: process.uptime(),
      codexHome: config.codexHome,
      redisUrl: config.redisUrl,
      workerCommand: config.workerCommand,
      workerArgs: config.workerArgs,
      workerCwd: config.workerCwd,
      slackAgentChatStatusEnabled: config.slackAgentChatStatusEnabled,
    }),
    restartWorker: async () => {
      await workerClient.restart();
    },
    getCodexVersion: async () => getCodexVersion(config.workerCommand),
    getLatestCodexVersion,
    runDoctor: async () => runAdminDoctor(config.workerCwd ?? process.cwd()),
  });

  const gateway = new Gateway(workerClient, adminCommands, {
    slackAgentChatStatusEnabled: config.slackAgentChatStatusEnabled,
  });

  const runtime = createChatGatewayRuntime(gateway, {
    botToken: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    botUserName: config.slackBotUserName,
    state,
  });

  // This release intentionally drops sqlite session migration support.
  console.warn(
    '[startup-warning] in-flight sessions and pending approvals from the old sqlite-backed session model are not migrated; the first upgrade to this build resets them.',
  );
  await runtime.start(config.port);
  // eslint-disable-next-line no-console
  console.log('codex-agent started');

  const shutdown = async () => {
    await runtime.stop();
    await workerClient.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
