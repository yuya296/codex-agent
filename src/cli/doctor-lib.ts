import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  error?: Error;
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
}

export async function runDoctorChecks(cwd = process.cwd()): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push(checkNpmInstall(cwd));
  results.push(checkCodexBinary());
  results.push(checkCodexAppServer());
  results.push(await checkNodeSqlite());
  results.push(checkSqliteCli());

  return results;
}

export function summarizeResults(results: CheckResult[]): { ok: number; warn: number; fail: number } {
  return results.reduce(
    (acc, result) => {
      acc[result.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0 },
  );
}

function checkNpmInstall(cwd: string): CheckResult {
  const packageJsonPath = join(cwd, 'package.json');
  const nodeModulesPath = join(cwd, 'node_modules');

  if (!existsSync(packageJsonPath)) {
    return {
      id: 'npm-install',
      label: 'npm install',
      status: 'fail',
      detail: 'package.json not found.',
    };
  }

  if (!existsSync(nodeModulesPath)) {
    return {
      id: 'npm-install',
      label: 'npm install',
      status: 'fail',
      detail: 'node_modules not found. Run npm install first.',
    };
  }

  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape;
  const deps = Object.keys(parsed.dependencies ?? {});
  const requireFromCwd = createRequire(packageJsonPath);

  const missing: string[] = [];
  for (const dep of deps) {
    try {
      requireFromCwd.resolve(`${dep}/package.json`);
    } catch {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    return {
      id: 'npm-install',
      label: 'npm install',
      status: 'fail',
      detail: `Missing installed dependencies: ${missing.join(', ')}`,
    };
  }

  return {
    id: 'npm-install',
    label: 'npm install',
    status: 'ok',
    detail: `Resolved ${deps.length} dependencies.`,
  };
}

function checkCodexBinary(): CheckResult {
  const command = runCommand('codex', ['--version']);

  if (!command.ok) {
    return {
      id: 'codex-binary',
      label: 'codex CLI',
      status: 'fail',
      detail: 'Unable to execute codex command. Check your PATH.',
    };
  }

  return {
    id: 'codex-binary',
    label: 'codex CLI',
    status: 'ok',
    detail: `version: ${firstLine(command.stdout) ?? 'unknown'}`,
  };
}

function checkCodexAppServer(): CheckResult {
  const command = runCommand('codex', ['app-server', '--help']);

  if (!command.ok) {
    return {
      id: 'codex-app-server',
      label: 'codex app-server support',
      status: 'fail',
      detail: 'codex app-server --help failed. Verify your codex version supports app-server.',
    };
  }

  return {
    id: 'codex-app-server',
    label: 'codex app-server support',
    status: 'ok',
    detail: 'app-server subcommand is available.',
  };
}

async function checkNodeSqlite(): Promise<CheckResult> {
  try {
    await import('node:sqlite');
    return {
      id: 'node-sqlite',
      label: 'Node SQLite runtime',
      status: 'ok',
      detail: 'node:sqlite module loaded successfully.',
    };
  } catch {
    return {
      id: 'node-sqlite',
      label: 'Node SQLite runtime',
      status: 'fail',
      detail: 'Unable to load node:sqlite. Check your Node.js version.',
    };
  }
}

function checkSqliteCli(): CheckResult {
  const command = runCommand('sqlite3', ['--version']);

  if (!command.ok) {
    return {
      id: 'sqlite-cli',
      label: 'sqlite3 CLI',
      status: 'warn',
      detail: 'sqlite3 command not found (optional for this app).',
    };
  }

  return {
    id: 'sqlite-cli',
    label: 'sqlite3 CLI',
    status: 'ok',
    detail: `version: ${firstLine(command.stdout) ?? 'unknown'}`,
  };
}

function runCommand(cmd: string, args: string[]): CommandResult {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status,
    error: result.error ?? undefined,
  };
}

function firstLine(text: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return line;
}
