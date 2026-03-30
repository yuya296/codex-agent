#!/usr/bin/env bash
set -euo pipefail

app_env_path="${APP_ENV_PATH:-/etc/codex-agent/app.env}"

if [[ -z "${APP_IMAGE:-}" && -f "${app_env_path}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${app_env_path}"
  set +a
fi

app_image="${APP_IMAGE:-codex-agent:local}"

exec docker pull "${app_image}"
