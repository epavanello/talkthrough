/**
 * Stands in for the extension host so the chat runs in a plain browser
 * (`pnpm --filter @talkthrough/webview dev:browser`): RPC calls are logged, and `?scene=` picks
 * what to show — `home`, `setup` (requirements missing), `preparing`, `review` (default), `update`, `trust`,
 * `error` — with `&theme=light` for a light theme and `&width=280` for a narrow side bar.
 */
import {
  EMPTY_STATE,
  type Cue,
  type PullItem,
  type ReviewState,
  type RpcRequest,
  type Sentence
} from '@talkthrough/shared';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'review';
const MINUTE = 60_000;
const now = Date.now();

const cue = (
  kind: Cue['kind'],
  path: string,
  start: number | null,
  end = start,
  symbol: string | null = null
) => ({
  type: 'cue' as const,
  cue: { kind, path, start, end, symbol }
});
const text = (words: string) => ({ type: 'text' as const, text: words });
const say = (...parts: Sentence['parts']): Sentence => ({ parts });

const pr = {
  number: 943,
  title: 'Admin chat: refresh a cached row when reopening it from the table',
  url: 'https://github.com/acme/shop/pull/943',
  author: 'emanuele',
  base: 'master',
  head: 'claude/thread-inbox-visibility',
  headSha: '77c73ca5',
  mergeBase: '50ad6968',
  repo: '/repo',
  isLive: false
};

const review: ReviewState = {
  ...EMPTY_STATE,
  status: 'ready',
  pr,
  files: [
    {
      path: 'packages/shared/src/chat/threads.ts',
      previousPath: null,
      changeType: 'MODIFIED',
      additions: 18,
      deletions: 4,
      hunks: ['H1', 'H2']
    },
    {
      path: 'packages/web/src/routes/admin/chat/+page.svelte',
      previousPath: null,
      changeType: 'MODIFIED',
      additions: 9,
      deletions: 2,
      hunks: ['H3']
    },
    {
      path: 'packages/web/messages/it.json',
      previousPath: null,
      changeType: 'MODIFIED',
      additions: 2,
      deletions: 0,
      hunks: ['H4']
    }
  ],
  hunks: {
    H1: {
      id: 'H1',
      path: 'packages/shared/src/chat/threads.ts',
      start: 40,
      end: 58,
      header: 'export async function getThread(',
      additions: 12,
      deletions: 3,
      key: 'k1'
    },
    H2: {
      id: 'H2',
      path: 'packages/shared/src/chat/threads.ts',
      start: 120,
      end: 126,
      header: 'function cacheKey(',
      additions: 6,
      deletions: 1,
      key: 'k2'
    },
    H3: {
      id: 'H3',
      path: 'packages/web/src/routes/admin/chat/+page.svelte',
      start: 88,
      end: 97,
      header: '',
      additions: 9,
      deletions: 2,
      key: 'k3'
    },
    H4: {
      id: 'H4',
      path: 'packages/web/messages/it.json',
      start: 210,
      end: 211,
      header: '',
      additions: 2,
      deletions: 0,
      key: 'k4'
    }
  },
  coverage: { H1: 'ok', H2: 'explained', H3: 'todo', H4: 'todo' },
  step: ['H2'],
  blocks: [
    {
      id: 'B1',
      title: 'Thread cache in shared',
      why: 'Rows are cached by thread id and refreshed on reopen',
      hunks: ['H1', 'H2']
    },
    {
      id: 'B2',
      title: 'Admin table reopens the row',
      why: 'The page asks for a fresh row',
      hunks: ['H3']
    },
    { id: 'B3', title: 'Translations', why: 'New labels', hunks: ['H4'] }
  ],
  hotspots: [
    {
      id: 'S1',
      title: 'Other callers of getThread still read the cache',
      detail: 'Two server routes call getThread without fresh: true',
      anchors: ['packages/web/src/routes/api/chat/+server.ts#L30']
    }
  ],
  messages: [
    {
      id: 'm1',
      role: 'user',
      at: now - 14 * MINUTE,
      text: 'Prepare the review of PR #943: Admin chat: refresh a cached row when reopening it from the table',
      isAuto: true,
      sentences: [say(text('Prepare the review of PR #943'))]
    },
    {
      id: 'm2',
      role: 'claude',
      at: now - 13 * MINUTE,
      text: '',
      sentences: [
        say(
          text(
            'This PR makes a conversation reopened from the admin table always show its latest state.'
          )
        ),
        say(
          text('I split it into three blocks, and found one thing worth checking in the callers.')
        )
      ]
    },
    {
      id: 'm3',
      role: 'user',
      at: now - 12 * MINUTE,
      text: 'Next',
      sentences: [say(text('Next'))]
    },
    {
      id: 'm4',
      role: 'claude',
      at: now - 12 * MINUTE,
      text: '',
      sentences: [
        say(
          cue('show', 'packages/shared/src/chat/threads.ts', 40, 58),
          text('Here getThread takes a `fresh` flag that skips the cache.')
        ),
        say(
          cue('show', 'packages/shared/src/chat/threads.ts', 120, 126),
          text(
            'The cache key now includes the company, so two admins never see the rows of the other.'
          )
        ),
        say(
          cue('refs', 'packages/shared/src/chat/threads.ts', 40, 40, 'getThread'),
          text('Want to see who else calls it?')
        )
      ]
    },
    {
      id: 'm5',
      role: 'user',
      at: now - 11 * MINUTE,
      text: 'Yes, who else calls it? And does the orders controller still go through the cache?',
      isDictated: true,
      sentences: [say(text('Yes, who else calls it?'))]
    },
    { id: 'm6', role: 'note', at: now - 10 * MINUTE, text: 'No speech detected.', sentences: [] }
  ],
  player: { messageId: 'm4', sentence: 1, isPlaying: true },
  model: 'claude-opus-5-5',
  isSpeechOn: true,
  reviews: [],
  requirements: []
};

const reviews = [
  { id: 'r1', number: 943, title: pr.title, ok: 1, total: 4, updatedAt: now - 10 * MINUTE },
  {
    id: 'r2',
    number: 922,
    title: 'Billing: retry failed webhooks with backoff',
    ok: 9,
    total: 9,
    updatedAt: now - 26 * 60 * MINUTE
  },
  {
    id: 'r3',
    number: 918,
    title: 'Search: index product variants by locale',
    ok: 3,
    total: 17,
    updatedAt: now - 3 * 24 * 60 * MINUTE
  }
];

const SCENES: Record<string, Partial<ReviewState>> = {
  home: { ...EMPTY_STATE, reviews, requirements: [] },
  setup: {
    ...EMPTY_STATE,
    requirements: [
      {
        name: 'Claude Code',
        state: 'warn',
        detail: 'Your sign-in expires in 2 days.',
        fix: 'claude auth login'
      },
      { name: 'GitHub CLI', state: 'missing', detail: 'Not signed in.', fix: 'gh auth login' },
      { name: 'Python 3', state: 'ok', detail: 'Python 3.9.6' }
    ]
  },
  preparing: {
    ...review,
    status: 'thinking',
    activity: 'Reading threads.ts',
    coverage: {},
    step: [],
    blocks: [],
    hotspots: [],
    messages: review.messages.slice(0, 1),
    player: { messageId: null, sentence: 0, isPlaying: false },
    trail: [
      'Loading the pull request',
      'Starting Claude',
      'Thinking',
      'Reading the overview',
      'Reading the diff',
      'Reading threads.ts'
    ]
  },
  review,
  update: { ...review, newHead: { sha: 'a1b2c3d4', commits: 3 }, pr: { ...pr, isLive: true } },
  trust: {
    ...review,
    status: 'waiting',
    dialog: 'trust',
    activity: 'Claude asks whether you trust this folder.',
    pr: { ...pr, isLive: true }
  },
  error: {
    ...review,
    status: 'error',
    error:
      "Claude could not reopen this review's session. Try again, or start a new Claude session: it prepares the review again, your chat and hunk states stay.",
    pr: { ...pr, isLive: true }
  }
};

const state = { ...review, ...SCENES[scene], reviews } as ReviewState;
if (scene === 'setup') state.reviews = [];

const PULLS: PullItem[] = [
  {
    number: 951,
    title: 'Checkout: show the shipping estimate before the address step',
    url: 'https://github.com/acme/shop/pull/951',
    author: 'ada',
    isDraft: false,
    updatedAt: now - 35 * MINUTE,
    head: 'feat/shipping-estimate',
    additions: 214,
    deletions: 37
  },
  {
    number: 943,
    title: pr.title,
    url: pr.url,
    author: 'emanuele',
    isDraft: false,
    updatedAt: now - 3 * 60 * MINUTE,
    head: pr.head,
    additions: 29,
    deletions: 6
  },
  {
    number: 940,
    title: 'Deps: bump the Svelte group',
    url: 'https://github.com/acme/shop/pull/940',
    author: 'dependabot',
    isDraft: true,
    updatedAt: now - 2 * 24 * 60 * MINUTE,
    head: 'dependabot/npm/svelte',
    additions: 88,
    deletions: 91
  }
];

const answer = (request: RpcRequest) => {
  if (request.method === 'getState') return state;
  if (request.method === 'listPulls') {
    const [filter, words] = request.args as [string, string];
    const items =
      filter === 'mine'
        ? []
        : PULLS.filter((one) => one.title.toLowerCase().includes(words.toLowerCase()));
    return { status: 'ok', items };
  }
  return undefined;
};

const vscode = {
  postMessage(message: RpcRequest) {
    // Like VS Code's: the message is cloned, so a Svelte proxy in it throws here too
    const request = structuredClone(message);
    console.log('rpc', request.method, ...request.args);
    const delay = request.method === 'listPulls' ? 400 : 0;
    setTimeout(() => window.postMessage({ id: request.id, result: answer(request) }, '*'), delay);
  },
  getState: () => undefined,
  setState: () => {}
};
(window as unknown as { acquireVsCodeApi: () => typeof vscode }).acquireVsCodeApi = () => vscode;

if (params.get('theme') === 'light') {
  // VS Code puts its theme's variables on <html>, and the theme's kind on <body>
  document.documentElement.dataset.theme = 'light';
  document.body.className = 'vscode-light';
}
const width = params.get('width');
if (width) document.getElementById('app')!.style.width = `${width}px`;
