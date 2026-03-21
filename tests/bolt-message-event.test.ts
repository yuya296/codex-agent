import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDownloadedImagesToText, toSlackMessageEvent } from '../src/gateway/bolt.js';

test('toSlackMessageEvent maps threaded dm payload', () => {
  assert.deepEqual(
    toSlackMessageEvent({
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: 'hello',
      ts: '100.2',
      thread_ts: '100.1',
      parent_user_id: 'U2',
      channel_type: 'im',
    }),
    {
      team_id: 'T1',
      channel_id: 'D1',
      user_id: 'U1',
      text: 'hello',
      ts: '100.2',
      thread_ts: '100.1',
      parent_user_id: 'U2',
      assistant_thread: undefined,
      channel_type: 'im',
      subtype: undefined,
    },
  );
});

test('toSlackMessageEvent returns null when required identity fields are missing', () => {
  assert.equal(
    toSlackMessageEvent({
      channel: 'D1',
      text: 'hello',
      ts: '100.2',
      channel_type: 'im',
    }),
    null,
  );
});

test('toSlackMessageEvent allows empty text for file downloads', () => {
  assert.deepEqual(
    toSlackMessageEvent({
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      ts: '100.2',
      channel_type: 'im',
    }),
    {
      team_id: 'T1',
      channel_id: 'D1',
      user_id: 'U1',
      text: '',
      ts: '100.2',
      thread_ts: undefined,
      parent_user_id: undefined,
      assistant_thread: undefined,
      channel_type: 'im',
      subtype: undefined,
    },
  );
});

test('toSlackMessageEvent maps file_share dm payload', () => {
  assert.deepEqual(
    toSlackMessageEvent({
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: 'photo',
      ts: '100.2',
      subtype: 'file_share',
      channel_type: 'im',
    }),
    {
      team_id: 'T1',
      channel_id: 'D1',
      user_id: 'U1',
      text: 'photo',
      ts: '100.2',
      thread_ts: undefined,
      parent_user_id: undefined,
      assistant_thread: undefined,
      channel_type: 'im',
      subtype: 'file_share',
    },
  );
});

test('appendDownloadedImagesToText appends downloaded image paths to text', () => {
  assert.equal(
    appendDownloadedImagesToText('本文', [
      { path: '/tmp/weather.png', name: 'weather.png', mimetype: 'image/png' },
    ]),
    ['本文', '', '添付画像:', '- weather.png: /tmp/weather.png'].join('\n'),
  );
});
