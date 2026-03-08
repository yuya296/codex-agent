export interface AppConfig {
  sqlitePath: string;
  workerCommand: string;
  workerArgs: string[];
  workerCwd?: string;
  port?: number;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv): AppConfig {
  const workerCommand = env.CODEX_WORKER_COMMAND;
  if (!workerCommand) {
    throw new Error('CODEX_WORKER_COMMAND is required');
  }

  const workerArgs = env.CODEX_WORKER_ARGS ? env.CODEX_WORKER_ARGS.split(' ').filter(Boolean) : [];

  return {
    sqlitePath: env.SQLITE_PATH ?? './data/app.sqlite',
    workerCommand,
    workerArgs,
    workerCwd: env.CODEX_WORKER_CWD,
    port: env.PORT ? Number(env.PORT) : undefined,
  };
}
