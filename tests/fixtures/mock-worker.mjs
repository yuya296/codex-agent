import readline from 'node:readline';

let threadCount = 0;
let turnCount = 0;
let approvalCount = 0;
let serverRequestId = 0;

const pendingApprovalRequests = new Map();
const loadedThreads = new Set();

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

function sendError(id, message) {
  process.stdout.write(
    `${JSON.stringify({
      id,
      error: { code: -32601, message },
    })}\n`,
  );
}

function notify(method, params) {
  process.stdout.write(`${JSON.stringify({ method, params })}\n`);
}

function request(method, params) {
  const id = serverRequestId++;
  process.stdout.write(`${JSON.stringify({ id, method, params })}\n`);
  return id;
}

function extractText(params) {
  const input = params?.input;
  if (!Array.isArray(input) || input.length === 0) {
    return '';
  }
  const first = input[0];
  if (first && typeof first === 'object' && typeof first.text === 'string') {
    return first.text;
  }
  return '';
}

function turnCompleted(threadId, turnId) {
  notify('turn/completed', {
    turn: {
      id: turnId,
      items: [],
      status: 'completed',
      error: null,
    },
  });
}

function turnFailed(threadId, turnId, message) {
  notify('turn/completed', {
    turn: {
      id: turnId,
      items: [],
      status: 'failed',
      error: {
        message,
        codexErrorInfo: null,
        additionalDetails: null,
      },
    },
  });
}

function emitAgentMessage(threadId, turnId, text, phase = 'commentary') {
  notify('item/completed', {
    threadId,
    turnId,
    item: {
      type: 'agentMessage',
      id: `item-${Math.random().toString(16).slice(2)}`,
      text,
      phase,
    },
  });
}

function emitAgentMessageDelta(threadId, turnId, text) {
  notify('item/agentMessage/delta', {
    threadId,
    turnId,
    itemId: `item-${Math.random().toString(16).slice(2)}`,
    delta: text,
  });
}

function normalizeDecisionLabel(decision) {
  if (decision === 'accept' || decision === 'approved') {
    return 'approve';
  }
  return 'reject';
}

rl.on('line', (line) => {
  if (!line.trim()) {
    return;
  }

  const msg = JSON.parse(line);
  if ('jsonrpc' in msg) {
    if (typeof msg.id === 'undefined') {
      return;
    }
    sendError(msg.id, 'jsonrpc header must be omitted on wire');
    return;
  }

  // Client notification
  if (msg.method && typeof msg.id === 'undefined') {
    if (msg.method === 'initialized') {
      return;
    }
    return;
  }

  // Client request
  if (msg.method && typeof msg.id !== 'undefined') {
    const { id, method, params } = msg;

    if (method === 'initialize') {
      sendResponse(id, { userAgent: 'mock-worker' });
      return;
    }

    if (method === 'thread/start') {
      threadCount += 1;
      const threadId = `thread-${threadCount}`;
      loadedThreads.add(threadId);
      sendResponse(id, {
        thread: {
          id: threadId,
        },
      });
      return;
    }

    if (method === 'thread/resume') {
      const threadId = params?.threadId;
      if (typeof threadId !== 'string' || !threadId) {
        sendError(id, 'threadId is required');
        return;
      }

      loadedThreads.add(threadId);
      sendResponse(id, {
        thread: {
          id: threadId,
        },
      });
      return;
    }

    if (method === 'turn/start') {
      turnCount += 1;
      const turnId = `turn-${turnCount}`;
      const threadId = params?.threadId;
      if (!loadedThreads.has(threadId)) {
        sendError(id, `thread is not loaded: ${String(threadId)}`);
        return;
      }
      const text = extractText(params);

      sendResponse(id, {
        turn: {
          id: turnId,
        },
      });

      if (text.includes('[APPROVAL]')) {
        approvalCount += 1;
        const approvalId = `approval-${approvalCount}`;
        const requestId = request('item/commandExecution/requestApproval', {
          threadId,
          turnId,
          itemId: `cmd-${approvalCount}`,
          approvalId,
          reason: 'need approval',
          command: 'echo test',
        });
        pendingApprovalRequests.set(requestId, {
          threadId,
          turnId,
          approvalId,
        });
        return;
      }

      if (text.includes('[APPROVAL_NO_IDS]')) {
        approvalCount += 1;
        const approvalId = `approval-${approvalCount}`;
        const requestId = request('item/commandExecution/requestApproval', {
          itemId: `cmd-${approvalCount}`,
          approvalId,
          reason: 'need approval',
          command: ['/bin/bash', '-lc', 'playwright-cli --version'],
        });
        pendingApprovalRequests.set(requestId, {
          threadId,
          turnId,
          approvalId,
        });
        return;
      }

      if (text.includes('[REQUEST_USER_INPUT]')) {
        request('item/tool/requestUserInput', {
          threadId,
          turnId,
          itemId: `tool-${turnCount}`,
          questions: [
            {
              id: 'location',
              header: 'Location',
              question: 'Where should I look?',
              options: [
                {
                  label: 'Tokyo',
                  description: 'Use Tokyo as the target.',
                },
              ],
            },
          ],
        });
        return;
      }

      if (text.includes('[ELICIT_APPROVAL]')) {
        const requestId = request('mcpServer/elicitation/request', {
          threadId,
          turnId,
          elicitationId: `elicitation-${turnCount}`,
          message: 'Allow Linear MCP Server to run tool "linear mcp server_save_project"?',
          requestedSchema: {
            type: 'object',
            properties: {
              allow: {
                type: 'boolean',
                title: 'Allow',
              },
            },
            required: ['allow'],
          },
        });
        pendingApprovalRequests.set(requestId, {
          threadId,
          turnId,
          approvalId: `elicitation-${turnCount}`,
          kind: 'elicitation',
        });
        return;
      }

      if (text.includes('[ELICIT_COMPLEX]')) {
        request('mcpServer/elicitation/request', {
          threadId,
          turnId,
          elicitationId: `elicitation-${turnCount}`,
          message: 'Project name is required.',
          requestedSchema: {
            type: 'object',
            properties: {
              projectName: {
                type: 'string',
                title: 'Project Name',
              },
            },
            required: ['projectName'],
          },
        });
        return;
      }

      if (text.includes('[ELICIT_URL]')) {
        request('mcpServer/elicitation/request', {
          threadId,
          turnId,
          elicitationId: `elicitation-url-${turnCount}`,
          mode: 'url',
          message: 'Open the browser flow to continue.',
          url: 'https://example.com/oauth',
        });
        return;
      }

      if (text.includes('[ELICIT_MULTI_BOOLEAN]')) {
        request('mcpServer/elicitation/request', {
          threadId,
          turnId,
          elicitationId: `elicitation-multi-${turnCount}`,
          message: 'Choose approval options.',
          requestedSchema: {
            type: 'object',
            properties: {
              allow: {
                type: 'boolean',
                title: 'Allow',
              },
              remember: {
                type: 'boolean',
                title: 'Remember',
              },
            },
            required: ['allow'],
          },
        });
        return;
      }

      if (text.includes('[STALL]')) {
        emitAgentMessage(threadId, turnId, `processing:${text}`, 'commentary');
        return;
      }

      if (text.includes('[DELTA]')) {
        emitAgentMessageDelta(threadId, turnId, '調査しています');
        emitAgentMessageDelta(threadId, turnId, '。');
        emitAgentMessage(threadId, turnId, 'done:delta', 'final_answer');
        turnCompleted(threadId, turnId);
        return;
      }

      if (text.includes('[SOFT_ERROR]')) {
        notify('error', { message: 'Reconnecting... 2/5' });
        emitAgentMessage(threadId, turnId, 'done:[SOFT_ERROR]', 'final_answer');
        turnCompleted(threadId, turnId);
        return;
      }

      if (text.includes('[FAIL]')) {
        turnFailed(threadId, turnId, 'mock-failure');
        return;
      }

      emitAgentMessage(threadId, turnId, `processing:${text}`, 'commentary');
      emitAgentMessage(threadId, turnId, `done:${text}`, 'final_answer');
      turnCompleted(threadId, turnId);
      return;
    }

    if (method === 'turn/steer') {
      sendResponse(id, {
        turnId: params?.expectedTurnId,
      });
      return;
    }

    sendError(id, `method not found: ${method}`);
    return;
  }

  // Server-request response from client (approval answer)
  if (typeof msg.id !== 'undefined') {
    const pending = pendingApprovalRequests.get(msg.id);
    if (!pending) {
      return;
    }

    pendingApprovalRequests.delete(msg.id);

    const decision = pending.kind === 'elicitation'
      ? msg?.result?.action
      : msg?.result?.decision;
    const label = normalizeDecisionLabel(decision);

    emitAgentMessage(pending.threadId, pending.turnId, `approval:${label}`, 'commentary');
    emitAgentMessage(pending.threadId, pending.turnId, `approval-complete:${label}`, 'final_answer');
    turnCompleted(pending.threadId, pending.turnId);
  }
});
