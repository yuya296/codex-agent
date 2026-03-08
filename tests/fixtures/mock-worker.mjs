import readline from 'node:readline';

let threadCount = 0;
let turnCount = 0;
let approvalCount = 0;
let serverRequestId = 10_000;

const pendingApprovalRequests = new Map();

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function sendError(id, message) {
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message },
    })}\n`,
  );
}

function notify(method, params) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function request(method, params) {
  const id = serverRequestId++;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
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
    threadId,
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
    threadId,
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
      sendResponse(id, {
        thread: {
          id: `thread-${threadCount}`,
        },
      });
      return;
    }

    if (method === 'turn/start') {
      turnCount += 1;
      const turnId = `turn-${turnCount}`;
      const threadId = params?.threadId;
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

    const decision = msg?.result?.decision;
    const label = normalizeDecisionLabel(decision);

    emitAgentMessage(pending.threadId, pending.turnId, `approval:${label}`, 'commentary');
    emitAgentMessage(pending.threadId, pending.turnId, `approval-complete:${label}`, 'final_answer');
    turnCompleted(pending.threadId, pending.turnId);
  }
});
