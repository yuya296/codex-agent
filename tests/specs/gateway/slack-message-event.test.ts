import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDownloadedImagesToText, toSlackMessageEvent } from '../../../src/gateway/bolt.js';

test('Slack message event mapping turns threaded DM payloads into internal message events', () => {
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

test('Slack message event mapping ignores events that do not include identity fields', () => {
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

test('Slack message event mapping allows empty text when attached files are the real payload', () => {
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

test('Slack message event mapping accepts file_share DMs as message events', () => {
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

test('Slack message event mapping appends downloaded image paths as an attachment section', () => {
  assert.equal(
    appendDownloadedImagesToText('本文', [
      { path: '/tmp/weather.png', name: 'weather.png', mimetype: 'image/png' },
    ]),
    ['本文', '', '添付画像:', '- weather.png: /tmp/weather.png'].join('\n'),
  );
});
