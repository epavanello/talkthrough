/**
 * Checks the review session against the real Claude Code CLI, outside VS Code: interactive `claude`
 * in the pseudo-terminal, its hooks and the MCP tools on the local server, a tiny fake PR.
 *
 *   pnpm cli-check [cwd]     (cwd: a folder Claude Code already trusts; default: this repository)
 *
 * Runs two short turns on Haiku: the preparation, then "Next". Then it types into the prompt
 * (read back from the emulated screen), and resumes the session by its id (no turn: no cost).
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ClaudeProcess, claudeArgs } from '../src/claude';
import { systemPrompt } from '../src/prompts';
import { ReviewServer } from '../src/server';
import { BROWSER_TOOLS, TOOLS, mapProblems, type MapInput } from '../src/tools';

const cwd = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url));
const bridge = fileURLToPath(new URL('../resources/ptybridge.py', import.meta.url));
const events: string[] = [];
const replies: string[] = [];
let map: MapInput | null = null;
const log = (line: string) => {
  events.push(line);
  console.log(`  · ${line}`);
};

const DIFF = `## src/price.ts · modified · +2 −1
### H1 · head L13-14 · export function resolvePrice(order: Order) {
 const c = 3;
-  return round(total);
+  const rounded = Math.ceil(total);
+  return rounded;
 const d = 4;
`;

const server = new ReviewServer({
  // The browser's tools too: Claude Code drops a server whose tool schemas it rejects
  tools: () => [...TOOLS, ...BROWSER_TOOLS],
  onListed: () => log('mcp tools/list'),
  hook: async (event, payload) => {
    if (event === 'prompt') {
      log(`hook prompt: ${String(payload.prompt).slice(0, 60)}`);
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext:
            '<talkthrough>\nHunks: 0 ok, 0 explained, 1 todo, of 1.\n</talkthrough>'
        }
      };
    }
    if (event === 'tool') log(`hook tool: ${String(payload.tool_name)}`);
    if (event === 'session')
      log(`hook session: ${String(payload.source)} ${String(payload.session_id)}`);
    if (event === 'stop') {
      const reply = String(payload.last_assistant_message ?? '');
      log(`hook stop: ${reply.slice(0, 120).replace(/\n/g, ' ')}`);
      replies.push(reply);
    }
    return undefined;
  },
  callTool: async (name, args) => {
    log(`mcp ${name} ${JSON.stringify(args).slice(0, 100)}`);
    if (name === 'pr_overview')
      return {
        text: 'PR #1: Round prices up\nmain ← fix/rounding · checkout at the PR head: yes\n\nDescription:\nPrices are rounded up instead of to the nearest.\n\nFiles (1) and their hunks:\n- src/price.ts (modified, +2 −1): H1 L13-14'
      };
    if (name === 'pr_diff') return { text: DIFF };
    if (name === 'set_map') {
      const problems = mapProblems(args as unknown as MapInput, ['H1']);
      if (problems.length) return { text: problems.join('\n'), isError: true };
      map = args as unknown as MapInput;
      return { text: `Map set: ${map.blocks.length} blocks.` };
    }
    if (name === 'pr_file')
      return { text: '   13    const rounded = Math.ceil(total);\n   14    return rounded;' };
    return { text: 'ok' };
  }
});

const has = (prefix: string) => events.some((event) => event.startsWith(prefix));

const waitFor = async (
  check: () => boolean,
  what: string,
  timeout: number,
  claude: ClaudeProcess
) => {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) {
      console.log(`\n✗ timed out waiting for ${what}. Screen:\n${claude.screen.slice(-1500)}`);
      throw new Error(`timed out: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};

await server.listen();
const claude = new ClaudeProcess(bridge);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  TALKTHROUGH_PORT: String(server.port),
  TALKTHROUGH_TOKEN: server.token,
  TERM: 'xterm-256color'
};
for (const name of [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT'
])
  delete env[name];
const sessionId = randomUUID();
const options = {
  port: server.port,
  token: server.token,
  language: 'italian',
  model: 'haiku',
  effort: '',
  systemPrompt: systemPrompt('italian', true),
  name: 'Talkthrough · PR #1: Round prices up (cli-check)',
  sessionId,
  disabledPlugins: ['earshot@earshot']
};
console.log(`claude in ${cwd}, server on ${server.port}, session ${sessionId}`);
claude.start(['claude', ...claudeArgs(options)], cwd, env);
let failed = false;
let typed = '';
let resumed: ClaudeProcess | null = null;
try {
  // As the extension does: the kickoff once Claude has listed the stage's tools
  await waitFor(() => has('mcp tools/list'), 'the tools listed', 60_000, claude);
  await new Promise((resolve) => setTimeout(resolve, 300));
  claude.submit('Prepare the review of PR #1: Round prices up');
  await waitFor(() => replies.length >= 1, 'the preparation reply', 180_000, claude);
  console.log('\n→ submitting "Next"');
  claude.submit('Next');
  await waitFor(() => replies.length >= 2, 'the reply to Next', 120_000, claude);
  console.log('\n→ typing into the prompt, not sent');
  claude.write('prova di lettura');
  await waitFor(
    () => claude.promptText() === 'prova di lettura',
    'the typed words on the screen',
    10_000,
    claude
  );
  typed = claude.promptText();
  claude.clearInput();
  console.log('\n→ resuming the session in a new process');
  await claude.dispose();
  resumed = new ClaudeProcess(bridge);
  resumed.start(['claude', ...claudeArgs({ ...options, effort: 'high', resume: true })], cwd, env);
  const process2 = resumed;
  await waitFor(
    () => has(`hook session: resume ${sessionId}`),
    'the resumed session',
    60_000,
    process2
  );
} catch {
  failed = true;
} finally {
  await claude.dispose();
  await resumed?.dispose();
  server.close();
}

const checks: [string, boolean][] = [
  ['SessionStart hook with our session id', has(`hook session: startup ${sessionId}`)],
  ['UserPromptSubmit hook with the kickoff', has('hook prompt: Prepare the review')],
  ['UserPromptSubmit hook with the typed Next', has('hook prompt: Next')],
  ['PreToolUse hook', has('hook tool')],
  ['MCP tools listed at startup', has('mcp tools/list')],
  ['MCP pr_overview called', has('mcp pr_overview')],
  ['MCP set_map accepted', map !== null],
  [
    'Stop hook carries the reply',
    replies.length >= 2 && replies.every((reply) => reply.trim().length > 0)
  ],
  ['The Next reply has a show cue', /\[\[show [^\]]+\]\]/.test(replies[1] ?? '')],
  ['Typed words read back from the prompt box', typed === 'prova di lettura'],
  [
    'Resumed by id, with --effort: SessionStart with source resume, same id',
    has(`hook session: resume ${sessionId}`)
  ]
];
console.log('\nResults:');
for (const [label, isOk] of checks) console.log(`  ${isOk ? '✓' : '✗'} ${label}`);
console.log('\nReplies:');
replies.forEach((reply, index) => console.log(`  ${index + 1}. ${reply}`));
process.exit(failed || checks.some(([, isOk]) => !isOk) ? 1 : 0);
