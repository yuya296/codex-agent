FROM node:24-trixie

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bubblewrap \
    chromium \
    gh \
    jq \
    ripgrep \
    sqlite3 \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@latest @playwright/cli

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY AGENTS.md ./
COPY .codex ./.codex
COPY src ./src
COPY docs ./docs
COPY tests ./tests
COPY README.md ./
COPY docker/codex-home-defaults /opt/codex-home-defaults

COPY docker/entrypoint.sh /usr/local/bin/codex-agent-entrypoint
RUN chmod +x /usr/local/bin/codex-agent-entrypoint

ENTRYPOINT ["codex-agent-entrypoint"]
CMD ["npm", "start"]
