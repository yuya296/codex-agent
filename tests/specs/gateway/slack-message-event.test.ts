import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import {
  appendDownloadedImagesToText,
  buildSlackMessageEvent,
  toSlackMessageEvent,
} from '../../../src/gateway/slack-message-event.js';

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

test('Slack message event mapping can fill team_id from the outer event envelope', async () => {
  const event = await buildSlackMessageEvent({
    channel: 'D1',
    user: 'U1',
    text: 'hello',
    ts: '100.2',
    channel_type: 'im',
  }, 'xoxb-test', { team_id: 'T1' });

  assert.deepEqual(event, {
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: 'hello',
    ts: '100.2',
    thread_ts: undefined,
    parent_user_id: undefined,
    assistant_thread: undefined,
    channel_type: 'im',
    subtype: undefined,
    temporary_directory: undefined,
  });
});

test('Slack message event mapping appends downloaded image paths as an attachment section', () => {
  assert.equal(
    appendDownloadedImagesToText('本文', [
      { path: '/tmp/weather.png', name: 'weather.png', mimetype: 'image/png' },
    ]),
    ['本文', '', '添付画像:', '- weather.png: /tmp/weather.png'].join('\n'),
  );
});

test('Slack message event mapping falls back to the base text when image download throws', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;

  try {
    const event = await buildSlackMessageEvent({
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: 'この画像見える？',
      ts: '100.2',
      channel_type: 'im',
      files: [
        {
          id: 'F1',
          name: 'image.png',
          mimetype: 'image/png',
          url_private_download: 'https://files.example/image.png',
        },
      ],
    }, 'xoxb-test');

    assert.deepEqual(event, {
      team_id: 'T1',
      channel_id: 'D1',
      user_id: 'U1',
      text: 'この画像見える？',
      ts: '100.2',
      thread_ts: undefined,
      parent_user_id: undefined,
      assistant_thread: undefined,
      channel_type: 'im',
      subtype: undefined,
      temporary_directory: undefined,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slack message event mapping continues when one attached image download fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('bad.png')) {
      throw new Error('boom');
    }

    return new Response('image-bytes', {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
    });
  }) as typeof fetch;

  try {
    const event = await buildSlackMessageEvent({
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: '確認して',
      ts: '100.2',
      channel_type: 'im',
      files: [
        {
          id: 'F1',
          name: 'bad.png',
          mimetype: 'image/png',
          url_private_download: 'https://files.example/bad.png',
        },
        {
          id: 'F2',
          name: 'good.png',
          mimetype: 'image/png',
          url_private_download: 'https://files.example/good.png',
        },
      ],
    }, 'xoxb-test');

    assert.equal(event?.text.includes('good.png'), true);
    assert.equal(event?.text.includes('bad.png'), false);
    assert.match(event?.text ?? '', /添付画像:/u);
    assert.ok(event?.temporary_directory);
    await rm(event?.temporary_directory ?? '', { recursive: true, force: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
