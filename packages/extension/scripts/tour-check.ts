/**
 * Checks a tour against the real Claude Code CLI, outside VS Code: Claude explores a repository with
 * the tour's tools (on the real code), draws its stops with set_tour, then explains the first block.
 *
 *   pnpm tour-check [repo] [question]   (repo: one Claude Code already trusts; default: this one)
 *
 * Runs two turns on Haiku: the preparation, then "Next".
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadTour } from '../src/changes';
import { ClaudeProcess, claudeArgs } from '../src/claude';
import { fileAt, searchAt } from '../src/pr';
import { kickoff, systemPrompt } from '../src/prompts';
import { ReviewServer } from '../src/server';
import { TOUR_TOOLS, tourMap, type TourInput } from '../src/tools';

const repo = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url));
const question = process.argv[3] ?? 'How does voice dictation work, from the Talk button on?';
const bridge = fileURLToPath(new URL('../resources/ptybridge.py', import.meta.url));
const loaded = await loadTour(repo, question);
const { headSha } = loaded.info;
const events: string[] = [];
const replies: string[] = [];
let stops: Record<string, { path: string; start: number; end: number }> = {};
const log = (line: string) => {
  events.push(line);
  console.log(`  · ${line}`);
};

const server = new ReviewServer({
  tools: () => TOUR_TOOLS,
  onListed: () => log('mcp tools/list'),
  hook: async (event, payload) => {
    if (event === 'prompt') log(`hook prompt: ${String(payload.prompt).slice(0, 60)}`);
    if (event === 'stop') {
      const reply = String(payload.last_assistant_message ?? '');
      log(`hook stop: ${reply.slice(0, 120).replace(/\n/g, ' ')}`);
      replies.push(reply);
    }
    return undefined;
  },
  callTool: async (name, args) => {
    log(`mcp ${name} ${JSON.stringify(args).slice(0, 100)}`);
    if (name === 'code_search')
      return {
        text: await searchAt(repo, headSha, String(args.pattern ?? ''), {
          paths: Array.isArray(args.paths) ? args.paths.map(String) : [],
          ignoreCase: args.ignoreCase === true
        })
      };
    if (name === 'code_file') {
      const text = await fileAt(repo, headSha, String(args.path ?? ''));
      if (!text) return { text: `${String(args.path)} does not exist here.`, isError: true };
      const start = Number(args.start) || 1;
      const lines = text.split('\n');
      const end = Math.min(Number(args.end) || lines.length, start + 400);
      return {
        text: lines
          .slice(start - 1, end)
          .map((line, at) => `${String(start + at).padStart(5)}  ${line}`)
          .join('\n')
      };
    }
    if (name === 'set_tour') {
      const tour = args as unknown as TourInput;
      const lengths = new Map<string, number>();
      for (const block of tour.blocks ?? [])
        for (const stop of block.stops ?? []) {
          const text = await fileAt(repo, headSha, String(stop.path).replace(/^\.?\//, ''));
          if (text) lengths.set(String(stop.path).replace(/^\.?\//, ''), text.split('\n').length);
        }
      const map = tourMap(tour, (path) => lengths.get(path) ?? null);
      if (map.problems.length) return { text: map.problems.join('\n'), isError: true };
      stops = map.hunks;
      return {
        text: `Tour set: ${map.blocks.length} blocks, ${Object.keys(map.hunks).length} stops.`
      };
    }
    return { text: 'ok' };
  }
});

const has = (prefix: string) => events.some((event) => event.startsWith(prefix));
const waitFor = async (check: () => boolean, what: string, timeout: number) => {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};

await server.listen();
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
const claude = new ClaudeProcess(bridge);
console.log(`claude in ${repo}, tour: ${question}`);
claude.start(
  [
    'claude',
    ...claudeArgs({
      port: server.port,
      token: server.token,
      language: 'italian',
      model: 'haiku',
      effort: '',
      systemPrompt: systemPrompt('italian', false, 'tour'),
      name: 'Talkthrough · Tour (tour-check)',
      sessionId: randomUUID(),
      disabledPlugins: ['earshot@earshot'],
      prompt: kickoff(loaded.info, question)
    })
  ],
  repo,
  env
);
let failed = false;
try {
  await waitFor(() => replies.length >= 1, 'the preparation reply', 300_000);
  console.log('\n→ submitting "Next"');
  claude.submit('Next');
  await waitFor(() => replies.length >= 2, 'the reply to Next', 180_000);
} catch (error) {
  console.log(`\n✗ ${(error as Error).message}. Screen:\n${claude.screen.slice(-1500)}`);
  failed = true;
} finally {
  await claude.dispose();
  server.close();
}

const shown = [...(replies[1] ?? '').matchAll(/\[\[show ([^#\]\s]+)/g)].map((match) => match[1]);
const checks: [string, boolean][] = [
  ['The kickoff asks for a tour', has('hook prompt: Prepare a tour')],
  ['MCP code_search called', has('mcp code_search')],
  ['MCP set_tour accepted', Object.keys(stops).length > 0],
  ['The Next reply shows code', shown.length > 0],
  [
    'What it shows is a stop of the tour',
    shown.some((path) => Object.values(stops).some((stop) => stop.path === path))
  ]
];
console.log('\nStops:');
Object.entries(stops).forEach(([id, stop]) =>
  console.log(`  ${id} ${stop.path} L${stop.start}-${stop.end}`)
);
console.log('\nResults:');
for (const [label, isOk] of checks) console.log(`  ${isOk ? '✓' : '✗'} ${label}`);
console.log('\nReplies:');
replies.forEach((reply, index) => console.log(`  ${index + 1}. ${reply}`));
process.exit(failed || checks.some(([, isOk]) => !isOk) ? 1 : 0);
