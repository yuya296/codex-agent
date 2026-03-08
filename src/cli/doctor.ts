import { runDoctorChecks, summarizeResults } from './doctor-lib.js';

const ICONS = {
  ok: '[OK]',
  warn: '[WARN]',
  fail: '[FAIL]',
} as const;

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
} as const;

const COLOR_BY_STATUS = {
  ok: ANSI.green,
  warn: ANSI.yellow,
  fail: ANSI.red,
} as const;

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function colorize(text: string, color: string, bold = false): string {
  if (!supportsColor()) {
    return text;
  }
  const prefix = bold ? `${ANSI.bold}${color}` : color;
  return `${prefix}${text}${ANSI.reset}`;
}

async function main(): Promise<void> {
  const results = await runDoctorChecks();

  // eslint-disable-next-line no-console
  console.log(colorize('codex-agent doctor', ANSI.cyan, true));

  for (const result of results) {
    const icon = colorize(ICONS[result.status], COLOR_BY_STATUS[result.status], true);
    // eslint-disable-next-line no-console
    console.log(`${icon} ${result.label}: ${result.detail}`);
  }

  const summary = summarizeResults(results);
  const summaryText = `summary: ok=${summary.ok}, warn=${summary.warn}, fail=${summary.fail}`;
  const summaryColor = summary.fail > 0 ? ANSI.red : summary.warn > 0 ? ANSI.yellow : ANSI.green;
  // eslint-disable-next-line no-console
  console.log(colorize(summaryText, summaryColor, true));

  if (summary.fail > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[FAIL] doctor failed: ${String(error)}`);
  process.exitCode = 1;
});
