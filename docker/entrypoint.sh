#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env: ${name}" >&2
    exit 1
  fi
}

prune_dangling_skill_symlinks() {
  local skills_dir="${CODEX_HOME:-/root/.codex}/skills"
  if [[ ! -d "${skills_dir}" ]]; then
    return
  fi

  while IFS= read -r -d '' link_path; do
    if [[ ! -e "${link_path}" ]]; then
      echo "removing dangling skill symlink: ${link_path}" >&2
      rm -f "${link_path}"
    fi
  done < <(find "${skills_dir}" -type l -print0)
}

skill_has_yaml_frontmatter() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    return 1
  fi

  if [[ "$(head -n 1 "${path}")" != "---" ]]; then
    return 1
  fi

  tail -n +2 "${path}" | grep -m 1 -x -- "---" >/dev/null
}

seed_file_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ ! -f "${src}" || -e "${dest}" ]]; then
    return
  fi

  mkdir -p "$(dirname "${dest}")"
  cp "${src}" "${dest}"
  echo "seeded file: ${dest}" >&2
}

seed_children_if_missing() {
  local src_dir="$1"
  local dest_dir="$2"
  if [[ ! -d "${src_dir}" ]]; then
    return
  fi

  mkdir -p "${dest_dir}"

  while IFS= read -r -d '' src_path; do
    local name
    local dest_path
    name="$(basename "${src_path}")"
    dest_path="${dest_dir}/${name}"
    if [[ -e "${dest_path}" ]]; then
      continue
    fi

    cp -R "${src_path}" "${dest_path}"
    echo "seeded path: ${dest_path}" >&2
  done < <(find "${src_dir}" -mindepth 1 -maxdepth 1 -print0)
}

repair_invalid_seeded_skills() {
  local src_dir="$1"
  local dest_dir="$2"
  if [[ ! -d "${src_dir}" || ! -d "${dest_dir}" ]]; then
    return
  fi

  while IFS= read -r -d '' src_path; do
    local name
    local dest_path
    local src_skill
    local dest_skill
    name="$(basename "${src_path}")"
    dest_path="${dest_dir}/${name}"
    src_skill="${src_path}/SKILL.md"
    dest_skill="${dest_path}/SKILL.md"

    if [[ ! -d "${dest_path}" || ! -f "${src_skill}" || ! -f "${dest_skill}" ]]; then
      continue
    fi

    if ! skill_has_yaml_frontmatter "${src_skill}"; then
      continue
    fi

    if skill_has_yaml_frontmatter "${dest_skill}"; then
      continue
    fi

    cp "${src_skill}" "${dest_skill}"
    echo "repaired invalid skill definition: ${dest_skill}" >&2
  done < <(find "${src_dir}" -mindepth 1 -maxdepth 1 -type d -print0)
}

ensure_home_agents_link() {
  local codex_home="${CODEX_HOME:-/root/.codex}"
  local codex_home_agents="${codex_home}/AGENTS.md"
  local root_agents="${HOME:-/root}/AGENTS.md"

  if [[ -f "${root_agents}" && ! -e "${codex_home_agents}" && ! -L "${root_agents}" ]]; then
    mkdir -p "${codex_home}"
    cp "${root_agents}" "${codex_home_agents}"
    echo "migrated file: ${root_agents} -> ${codex_home_agents}" >&2
  fi

  if [[ -e "${root_agents}" && ! -L "${root_agents}" ]]; then
    rm -f "${root_agents}"
  fi

  ln -sfn "${codex_home_agents}" "${root_agents}"
}

seed_codex_home_defaults() {
  local codex_home="${CODEX_HOME:-/root/.codex}"
  local defaults_dir="${CODEX_HOME_DEFAULTS_DIR:-/opt/codex-home-defaults}"

  seed_file_if_missing "${defaults_dir}/AGENTS.md" "${codex_home}/AGENTS.md"
  seed_children_if_missing "${defaults_dir}/skills" "${codex_home}/skills"
  repair_invalid_seeded_skills "${defaults_dir}/skills" "${codex_home}/skills"
  ensure_home_agents_link
}

mkdir -p "${CODEX_HOME:-/root/.codex}"
mkdir -p "${PLAYWRIGHT_AGENT_PROFILE_DIR:-/profiles/agent}"
mkdir -p "$(dirname "${SQLITE_PATH:-/data/app.sqlite}")"
mkdir -p "$(dirname "${PLAYWRIGHT_MCP_CONFIG:-/run/playwright/cli.config.json}")"

require_env SLACK_BOT_TOKEN
require_env SLACK_APP_TOKEN

prune_dangling_skill_symlinks
seed_codex_home_defaults

cat > "${PLAYWRIGHT_MCP_CONFIG:-/run/playwright/cli.config.json}" <<EOF
{
  "browser": {
    "browserName": "chromium",
    "userDataDir": "${PLAYWRIGHT_AGENT_PROFILE_DIR:-/profiles/agent}",
    "launchOptions": {
      "executablePath": "/usr/bin/chromium",
      "chromiumSandbox": false
    }
  }
}
EOF

exec "$@"
