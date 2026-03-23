import {
  createAdminCommandHandler,
  getCodexVersion,
  getLatestCodexVersion,
  runAdminDoctor,
} from './admin/commands.js';
import { createChatGatewayRuntime, createSlackPublisher } from './gateway/chat-sdk.js';
import { Gateway } from './gateway/gateway.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { SessionRepository } from './repository/session-repository.js';
import { loadConfigFromEnv } from './config/index.js';
import { StdioJsonRpcWorkerClient } from './worker/stdio-jsonrpc-worker-client.js';
import { RestartableWorkerClient } from './worker/restartable-worker-client.js';

const debugWorkerEvents = process.env.DEBUG_WORKER_EVENTS === 'true';
const debugWorkerEventDeltas = process.env.DEBUG_WORKER_EVENT_DELTAS === 'true';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  process.env.CODEX_HOME = config.codexHome;

  const repository = new SessionRepository(config.sqlitePath);
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

  let gateway!: Gateway;
  const orchestrator = new Orchestrator(repository, workerClient, {
    notifyProgress: async (session, message) => gateway.notifyProgress(session, message),
    notifyApproval: async (session, approval) => gateway.notifyApproval(session, approval),
    notifyCompleted: async (session, message) => gateway.notifyCompleted(session, message),
    notifyFailed: async (session, message) => gateway.notifyFailed(session, message),
  });

  const adminCommands = createAdminCommandHandler({
    getStatusContext: async () => ({
      processUptimeSeconds: process.uptime(),
      codexHome: config.codexHome,
      redisUrl: config.redisUrl,
      sqlitePath: config.sqlitePath,
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

  let runtime!: ReturnType<typeof createChatGatewayRuntime>;
  const publisher = createSlackPublisher(() => runtime.slackAdapter, {
    slackAgentChatStatusEnabled: config.slackAgentChatStatusEnabled,
  });

  runtime = createChatGatewayRuntime(
    (gateway = new Gateway(orchestrator, publisher, adminCommands)),
    {
      botToken: config.slackBotToken,
      signingSecret: config.slackSigningSecret,
      botUserName: config.slackBotUserName,
      redisUrl: config.redisUrl,
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
