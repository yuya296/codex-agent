import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResults, type CheckResult } from '../src/cli/doctor-lib.js';

test('doctor-lib: summarizeResults counts statuses', () => {
  const input: CheckResult[] = [
    { id: 'a', label: 'A', status: 'ok', detail: '' },
    { id: 'b', label: 'B', status: 'ok', detail: '' },
    { id: 'c', label: 'C', status: 'warn', detail: '' },
    { id: 'd', label: 'D', status: 'fail', detail: '' },
  ];

  const summary = summarizeResults(input);
  assert.deepEqual(summary, { ok: 2, warn: 1, fail: 1 });
});
