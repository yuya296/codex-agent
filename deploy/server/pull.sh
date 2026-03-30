#!/usr/bin/env bash
set -euo pipefail

app_env_path="${APP_ENV_PATH:-/etc/codex-agent/app.env}"

if [[ -z "${APP_IMAGE:-}" && -f "${app_env_path}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${app_env_path}"
  set +a
fi

app_image="${APP_IMAGE:-}"
if [[ -z "${app_image}" ]]; then
  echo "APP_IMAGE is required for pull.sh" >&2
  echo "Set APP_IMAGE in ${app_env_path} or export it before running this script." >&2
  exit 1
fi

if [[ "${app_image}" == "codex-agent:local" ]]; then
  echo "APP_IMAGE=${app_image} is a local build tag. Use deploy/server/build.sh instead." >&2
  exit 1
fi

exec docker pull "${app_image}"
