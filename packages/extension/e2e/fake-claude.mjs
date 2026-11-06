#!/usr/bin/env node
/**
 * Plays Claude Code for the e2e tests. It takes the same arguments as the real CLI, runs the hook
 * commands from --settings with the hook input on stdin (so curl and the extension's server are the
 * real ones), calls the MCP server from --mcp-config, and answers what is typed into its terminal:
 * a line and Enter is a prompt, Space on an empty line starts dictation and Space again sends it.
 *
 * Like the real one, it draws its screen with cursor moves between words. Test switches:
 * - FAKE_CLAUDE_FAILS: a file holding a count; while above 0, a resume finds no conversation.
 * - FAKE_CLAUDE_TRUST: a file; while missing, the folder isn't trusted and a trust dialog shows.
 * - FAKE_CLAUDE_LIST_DELAY: ms before the MCP tools are listed, after SessionStart.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const WITH_VALUE = new Set([
  '--settings',
  '--mcp-config',
  '--permission-mode',
  '--append-system-prompt',
  '--model',
  '--resume',
  '--session-id',
  '--name',
  '--effort'
]);
const flags = {};
const positional = [];
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (WITH_VALUE.has(arg)) flags[arg] = process.argv[++index];
  else if (arg.startsWith('--')) flags[arg] = true;
  else positional.push(arg);
}
const settings = JSON.parse(flags['--settings']);
const mcp = JSON.parse(flags['--mcp-config']).mcpServers.talkthrough;
const resume = flags['--resume'] ?? null;
const sessionId = resume ?? flags['--session-id'] ?? 'fake-session';
const model =
  (flags['--model'] ? `claude-${flags['--model']}-fake` : 'claude-default-fake') +
  (flags['--effort'] ? `@${flags['--effort']}` : '');
const firstPrompt = positional.at(-1) ?? null;
const RULE = '─'.repeat(60);
/** Words apart the way Claude Code draws them: the cursor jumps to each word's column. */
const drawn = (line) => {
  let column = 1;
  return line
    .split(' ')
    .map((word, index) => {
      const at = index ? `\x1b[${column}G` : '';
      column += word.length + 1;
      return at + word;
    })
    .join('');
};
const write = (line) => process.stdout.write(`${drawn(line)}\r\n`);

function runHook(event, input) {
  const commands = (settings.hooks[event] ?? []).flatMap((group) =>
    group.hooks.map((hook) => hook.command)
  );
  return Promise.all(
    commands.map(
      (command) =>
        new Promise((resolve) => {
          const child = spawn('sh', ['-c', command], { env: process.env });
          let out = '';
          child.stdout.on('data', (data) => (out += data));
          child.on('close', () => resolve(out));
          child.stdin.end(
            JSON.stringify({ hook_event_name: event, session_id: sessionId, ...input })
          );
        })
    )
  );
}

let nextId = 1;
async function rpc(method, params) {
  const response = await fetch(mcp.url, {
    method: 'POST',
    headers: {
      ...mcp.headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
  });
  return response.json();
}

async function tool(name, args = {}) {
  await runHook('PreToolUse', { tool_name: `mcp__talkthrough__${name}`, tool_input: args });
  const reply = await rpc('tools/call', { name, arguments: args });
  return reply.result?.content?.[0]?.text ?? '';
}

/** What a first turn does: read the PR, draw the map. */
async function prepare() {
  const overview = await tool('pr_overview');
  const byFile = [...overview.matchAll(/^- (\S+).*: (.+)$/gm)].map((match) => ({
    path: match[1],
    hunks: [...match[2].matchAll(/\bH\d+\b/g)].map((id) => id[0])
  }));
  await tool('set_map', {
    blocks: [
      {
        title: 'Price rounding',
        why: 'Prices round up',
        hunks: byFile.filter((f) => f.path.includes('price')).flatMap((f) => f.hunks)
      },
      {
        title: 'Everything else',
        why: 'The rest',
        hunks: byFile.filter((f) => !f.path.includes('price')).flatMap((f) => f.hunks)
      }
    ],
    hotspots: [
      {
        title: 'Callers of resolvePrice',
        detail: 'orders.ts still expects rounding',
        anchors: ['src/orders.ts#L3']
      }
    ]
  });
}

/** A resumed session was prepared before. */
let isPrepared = Boolean(resume);
/** The turn running now: Esc cancels it, as in Claude Code (no Stop hook, the prompt back in the input). */
let running = null;

async function turn(prompt) {
  const [context = ''] = await runHook('UserPromptSubmit', { prompt });
  if (/slow|lent/i.test(prompt)) {
    const isCancelled = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      running = { prompt, cancel: () => (clearTimeout(timer), resolve(true)) };
    });
    running = null;
    if (isCancelled) return;
  }
  let reply;
  if (!isPrepared || prompt.includes('set_map')) {
    isPrepared = true;
    await prepare();
    reply = 'La PR arrotonda i prezzi per eccesso. La mappa ha due blocchi.';
  } else if (prompt === 'Avanti' || prompt === 'Next') {
    reply =
      '[[show src/price.ts#L2-2]] Qui resolvePrice usa Math.ceil. [[open src/orders.ts#L3]] Il controller la chiama prima di salvare.';
  } else {
    reply = `Hai chiesto: ${prompt}. ${context.includes('<talkthrough>') ? 'Ho il contesto.' : 'Niente contesto.'}`;
  }
  await runHook('Stop', { last_assistant_message: reply, stop_hook_active: false });
}

let queue = Promise.resolve();
const enqueue = (prompt) =>
  (queue = queue.then(() => turn(prompt)).catch((error) => process.stdout.write(`${error}\r\n`)));

/** Claude Code's trust dialog: ❯ marks the option Enter picks. */
function trustDialog() {
  return new Promise((resolve) => {
    let selected = 0;
    const draw = () => {
      write('Is this a project you created or one you trust?');
      write(`${selected === 0 ? '❯' : ' '} No, exit`);
      write(`${selected === 1 ? '❯' : ' '} Yes, I trust this folder`);
      write('Enter to confirm · Esc to cancel');
    };
    draw();
    const onKeys = (data) => {
      if (data.includes('\x1b[B')) selected = 1;
      if (data.includes('\x1b[A')) selected = 0;
      if (data.includes('\x1b[A') || data.includes('\x1b[B')) draw();
      if (!data.includes('\r')) return;
      process.stdin.off('data', onKeys);
      resolve(selected === 1);
    };
    process.stdin.on('data', onKeys);
  });
}

process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');

const fails = process.env.FAKE_CLAUDE_FAILS;
if (resume && fails && Number(readFileSync(fails, 'utf8')) > 0) {
  writeFileSync(fails, String(Number(readFileSync(fails, 'utf8')) - 1));
  write(`No conversation found with session ID: ${resume}`);
  process.exit(1);
}
const trust = process.env.FAKE_CLAUDE_TRUST;
if (trust && !existsSync(trust)) {
  if (!(await trustDialog())) process.exit(1);
  writeFileSync(trust, 'trusted');
}

let buffer = '';
let isRecording = false;
process.stdin.on('data', (data) => {
  for (const char of data.replace(/\x1b\[20[01]~/g, '')) {
    if (char === '\r') {
      const prompt = buffer.trim();
      buffer = '';
      if (prompt) enqueue(prompt);
    } else if (char === ' ' && buffer === '') {
      isRecording = !isRecording;
      write(isRecording ? 'Voice: listening' : 'Voice: processing…');
      // What Claude Code does while dictating: the words show in its prompt box
      if (isRecording) process.stdout.write(`${RULE}\r\n❯ parole dettate dal test\r\n${RULE}\r\n`);
      if (!isRecording) enqueue('Domanda dettata sul prezzo');
    } else if (char === '\x15') {
      buffer = '';
    } else if (char === '\x1b') {
      if (running) {
        buffer = running.prompt;
        running.cancel();
        write('Interrupted by user');
      }
    } else buffer += char;
  }
});

await runHook('SessionStart', { source: resume ? 'resume' : 'startup', model });
// Like Claude Code: the MCP servers connect after SessionStart, and their tools are listed
await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'fake', version: '0' }
});
await new Promise((resolve) =>
  setTimeout(resolve, Number(process.env.FAKE_CLAUDE_LIST_DELAY ?? 0))
);
await rpc('tools/list', {});
write('fake claude ready');
if (firstPrompt) enqueue(firstPrompt);
