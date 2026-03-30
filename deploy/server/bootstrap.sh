#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
host_state_root="${HOST_STATE_ROOT:-/srv/codex-agent}"
app_env_path="${APP_ENV_PATH:-/etc/codex-agent/app.env}"

mkdir -p "${host_state_root}/codex-home"
mkdir -p "${host_state_root}/playwright-agent-profile"
mkdir -p "${host_state_root}/data"

cat <<EOF
Created remote state directories under:
  ${host_state_root}/codex-home
  ${host_state_root}/playwright-agent-profile
  ${host_state_root}/data

Next steps:
  1. Copy ${repo_root}/deploy/env/server.env.example to ${app_env_path}
  2. Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN in ${app_env_path}
  3. If APP_IMAGE stays codex-agent:local, run ${repo_root}/deploy/server/up.sh --build
  4. If APP_IMAGE points to a registry image, run ${repo_root}/deploy/server/up.sh
  5. Run ${repo_root}/deploy/server/login-codex.sh for the initial Codex login
EOF
