#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
app_env_path="${APP_ENV_PATH:-/etc/codex-agent/app.env}"

cd "${repo_root}"

exec docker compose \
  --env-file "${app_env_path}" \
  -f compose.yaml \
  -f compose.server.yaml \
  up -d "$@"
