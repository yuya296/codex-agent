import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('docker entrypoint repairs an invalid seeded skill when the default skill has YAML frontmatter', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'codex-agent-docker-defaults-'));

  try {
    const defaultsDir = join(tempDir, 'defaults');
    const homeDir = join(tempDir, 'home');
    const codexHome = join(tempDir, 'codex-home');
    const dataDir = join(tempDir, 'data');
    const runDir = join(tempDir, 'run');
    const profilesDir = join(tempDir, 'profiles');
    const seededSkillDir = join(defaultsDir, 'skills', 'playwright-cli-docker');
    const installedSkillDir = join(codexHome, 'skills', 'playwright-cli-docker');

    mkdirSync(seededSkillDir, { recursive: true });
    mkdirSync(installedSkillDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });

    writeFileSync(join(defaultsDir, 'AGENTS.md'), '# AGENTS\n');
    writeFileSync(
      join(seededSkillDir, 'SKILL.md'),
      ['---', 'name: playwright-cli-docker', 'description: test skill', '---', '', '# valid'].join('\n'),
    );
    writeFileSync(join(installedSkillDir, 'SKILL.md'), '# broken skill');

    await execFileAsync('bash', ['docker/entrypoint.sh', 'true'], {
      cwd: '/Users/yuya/dev/codex-agent',
      env: {
        ...process.env,
        HOME: homeDir,
        CODEX_HOME: codexHome,
        CODEX_HOME_DEFAULTS_DIR: defaultsDir,
        PLAYWRIGHT_AGENT_PROFILE_DIR: profilesDir,
        PLAYWRIGHT_MCP_CONFIG: join(runDir, 'playwright.json'),
        SQLITE_PATH: join(dataDir, 'app.sqlite'),
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_APP_TOKEN: 'xapp-test',
      },
    });

    const repairedSkill = readFileSync(join(installedSkillDir, 'SKILL.md'), 'utf8');
    assert.match(repairedSkill, /^---$/m);
    assert.match(repairedSkill, /^name: playwright-cli-docker$/m);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
