#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env: ${name}" >&2
    exit 1
  fi
}

mkdir -p "${CODEX_HOME:-/root/.codex}"
mkdir -p "${PLAYWRIGHT_AGENT_PROFILE_DIR:-/profiles/agent}"
mkdir -p "$(dirname "${SQLITE_PATH:-/data/app.sqlite}")"
mkdir -p /run/playwright

require_env SLACK_BOT_TOKEN
require_env SLACK_APP_TOKEN

cat > "${PLAYWRIGHT_MCP_CONFIG:-/run/playwright/cli.config.json}" <<EOF
{
  "browser": {
    "browserName": "chromium",
    "userDataDir": "${PLAYWRIGHT_AGENT_PROFILE_DIR:-/profiles/agent}",
    "launchOptions": {
      "executablePath": "/usr/bin/chromium"
    }
  }
}
EOF

exec "$@"
