#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
app_env_path="${APP_ENV_PATH:-/etc/codex-agent/app.env}"

if [[ -z "${APP_IMAGE:-}" && -f "${app_env_path}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${app_env_path}"
  set +a
fi

app_image="${APP_IMAGE:-codex-agent:local}"

cd "${repo_root}"

exec docker build -t "${app_image}" .
