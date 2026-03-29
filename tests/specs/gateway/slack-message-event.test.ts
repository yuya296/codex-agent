import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { appendDownloadedFilesToText, buildSlackMessageEvent, toSlackMessageEvent } from '../../../src/gateway/bolt.js';

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
    attachment_warnings: undefined,
    downloaded_files_count: 0,
    temporary_directory: undefined,
  });
});

test('Slack message event mapping appends downloaded file paths as an attachment section', () => {
  assert.equal(
    appendDownloadedFilesToText('本文', [
      { path: '/tmp/weather.png', name: 'weather.png', mimetype: 'image/png' },
    ]),
    ['本文', '', '添付ファイル:', '- weather.png: /tmp/weather.png'].join('\n'),
  );
});

test('Slack message event mapping appends text attachment previews to the message', () => {
  assert.equal(
    appendDownloadedFilesToText('本文', [
      {
        path: '/tmp/notes.txt',
        name: 'notes.txt',
        mimetype: 'text/plain',
        preview: '1行目\n2行目',
      },
    ]),
    ['本文', '', '添付ファイル:', '- notes.txt: /tmp/notes.txt', '', '添付ファイル内容:', '- notes.txt', '1行目\n2行目'].join('\n'),
  );
});

test('Slack message event mapping downloads PDF and text attachments to the temporary directory', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response('file-bytes', {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
      },
    });
  }) as typeof fetch;

  try {
    const event = await buildSlackMessageEvent({
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: 'この添付を見て',
      ts: '100.2',
      channel_type: 'im',
      files: [
        {
          id: 'F1',
          name: 'spec.pdf',
          mimetype: 'application/pdf',
          url_private_download: 'https://files.example/spec.pdf',
        },
        {
          id: 'F2',
          name: 'notes.txt',
          mimetype: 'text/plain',
          url_private_download: 'https://files.example/notes.txt',
        },
      ],
    }, 'xoxb-test');

    assert.equal(event?.text.includes('添付ファイル:'), true);
    assert.equal(event?.text.includes('spec.pdf'), true);
    assert.equal(event?.text.includes('notes.txt'), true);
    assert.equal(event?.attachment_warnings, undefined);
    assert.equal(event?.downloaded_files_count, 2);
    assert.ok(event?.temporary_directory);
    await rm(event?.temporary_directory ?? '', { recursive: true, force: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slack message event mapping includes text file previews when downloadable text is attached', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response('申請期限は4月1日です。', {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
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
          name: 'notes.txt',
          mimetype: 'text/plain',
          url_private_download: 'https://files.example/notes.txt',
        },
      ],
    }, 'xoxb-test');

    assert.match(event?.text ?? '', /添付ファイル内容:/u);
    assert.match(event?.text ?? '', /申請期限は4月1日です。/u);
    await rm(event?.temporary_directory ?? '', { recursive: true, force: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Slack message event mapping returns attachment warnings for unsupported and oversized files', async () => {
  const event = await buildSlackMessageEvent({
    team: 'T1',
    channel: 'D1',
    user: 'U1',
    text: '',
    ts: '100.2',
    channel_type: 'im',
    files: [
      {
        id: 'F1',
        name: 'archive.zip',
        mimetype: 'application/zip',
        size: 1024,
        url_private_download: 'https://files.example/archive.zip',
      },
      {
        id: 'F2',
        name: 'big.pdf',
        mimetype: 'application/pdf',
        size: 11 * 1024 * 1024,
        url_private_download: 'https://files.example/big.pdf',
      },
    ],
  }, 'xoxb-test');

  assert.equal(event?.text, '');
  assert.equal(event?.downloaded_files_count, 0);
  assert.equal(event?.temporary_directory, undefined);
  assert.equal(event?.attachment_warnings?.length, 2);
  assert.match(event?.attachment_warnings?.[0] ?? '', /archive\.zip/u);
  assert.match(event?.attachment_warnings?.[0] ?? '', /未対応/u);
  assert.match(event?.attachment_warnings?.[1] ?? '', /big\.pdf/u);
  assert.match(event?.attachment_warnings?.[1] ?? '', /サイズ上限/u);
});

test('Slack message event mapping continues when one attached file download fails', async () => {
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
    assert.match(event?.text ?? '', /添付ファイル:/u);
    assert.equal(event?.attachment_warnings?.length, 1);
    assert.match(event?.attachment_warnings?.[0] ?? '', /bad\.png/u);
    assert.ok(event?.temporary_directory);
    await rm(event?.temporary_directory ?? '', { recursive: true, force: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
