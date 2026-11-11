/**
 * Stands in for the extension host so the chat runs in a plain browser
 * (`pnpm --filter @talkthrough/webview dev:browser`): RPC calls are logged, and `?scene=` picks
 * what to show — `home`, `setup` (requirements missing), `preparing`, `review` (default), `update`,
 * `browser` (the browser panel), `trust`, `recording` (dictation), `tour`, `thinking`,
 * `error` — with `&theme=light` for a light theme, `&width=280` for a narrow side bar and
 * `&voice=off` for the voice turned off.
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
  player: {
    messageId: 'm4',
    sentence: 1,
    isPlaying: true,
    progress: 0.4,
    isWaiting: false,
    isSentenceBySentence: false
  },
  model: 'claude-opus-5-5',
  isSpeechOn: true,
  reviews: [],
  requirements: []
};

const reviews: ReviewState['reviews'] = [
  { id: 'r1', number: 943, title: pr.title, ok: 1, total: 4, updatedAt: now - 10 * MINUTE },
  {
    id: 'r4',
    kind: 'tour',
    number: 0,
    title: 'How does the sign-up form work?',
    ok: 1,
    total: 4,
    updatedAt: now - 2 * 60 * MINUTE
  },
  {
    id: 'r5',
    kind: 'changes',
    number: 0,
    title: 'Staged changes on feat/checkout-estimate',
    ok: 0,
    total: 6,
    updatedAt: now - 5 * 60 * MINUTE
  },
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
  home: {
    ...EMPTY_STATE,
    reviews,
    requirements: [],
    changes: { staged: 0, uncommitted: 3, branch: 5, base: 'main' }
  },
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
    player: {
      messageId: null,
      sentence: 0,
      isPlaying: false,
      progress: 0,
      isWaiting: false,
      isSentenceBySentence: false
    },
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
  tour: {
    ...review,
    pr: {
      ...pr,
      kind: 'tour',
      number: 0,
      title: 'How does the sign-up form work?',
      url: null,
      isLive: true
    },
    files: [
      { path: 'src/routes/signup/+page.svelte', hunks: ['T1'] },
      { path: 'src/routes/signup/+page.server.ts', hunks: ['T2', 'T3'] },
      { path: 'src/lib/server/mail.ts', hunks: ['T4'] }
    ].map((file) => ({
      ...file,
      previousPath: null,
      changeType: 'MODIFIED' as const,
      additions: 0,
      deletions: 0
    })),
    hunks: Object.fromEntries(
      (
        [
          ['T1', 'src/routes/signup/+page.svelte', 12, 48, 'The form'],
          ['T2', 'src/routes/signup/+page.server.ts', 8, 30, 'Validates the fields'],
          ['T3', 'src/routes/signup/+page.server.ts', 32, 55, 'Creates the user'],
          ['T4', 'src/lib/server/mail.ts', 5, 22, 'Sends the confirmation']
        ] as const
      ).map(([id, path, start, end, header]) => [
        id,
        { id, path, start, end, header, additions: 0, deletions: 0, key: id }
      ])
    ),
    messages: [
      ...review.messages.slice(0, 2),
      {
        id: 'm9',
        role: 'claude',
        at: now - 2 * MINUTE,
        text: 'The action validates the fields, then creates the user.',
        sentences: [
          {
            parts: [
              { type: 'text', text: 'The action validates the fields, then creates the user.' },
              {
                type: 'cue',
                cue: {
                  kind: 'choice',
                  path: 'Show',
                  start: null,
                  end: null,
                  symbol: 'the email step'
                }
              },
              {
                type: 'cue',
                cue: { kind: 'choice', path: 'Is', start: null, end: null, symbol: 'it tested?' }
              }
            ]
          }
        ]
      }
    ],
    coverage: { T1: 'ok', T2: 'explained', T3: 'todo', T4: 'todo' },
    step: ['T2'],
    blocks: [
      { id: 'B1', title: 'The page', why: 'Where it starts', hunks: ['T1'] },
      { id: 'B2', title: 'The action', why: 'What the server does', hunks: ['T2', 'T3'] },
      { id: 'B3', title: 'The email', why: 'After sign-up', hunks: ['T4'] }
    ],
    hotspots: [
      {
        id: 'S1',
        title: 'No rate limit on sign-up',
        detail: 'The action creates users without a limit per address.',
        anchors: ['src/routes/signup/+page.server.ts#L32-55']
      }
    ]
  },
  thinking: { ...review, status: 'thinking', activity: 'Searching “getThread”' },
  recording: {
    ...review,
    status: 'recording',
    activity: 'Listening',
    isRecording: true,
    draft: 'E il controller degli ordini passa ancora dalla cache'
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
if (params.get('voice') === 'off') state.isSpeechOn = false;

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

/** The browser panel's scene (`?scene=browser`): a fake page of the app, with two marks. */
const BROWSER_PAGE = {
  url: 'http://localhost:5173/events/42/reschedule',
  title: 'Reschedule · Pack'
};
const BROWSER_MARKS = [
  {
    id: 'm1',
    label: 'Changed: only the mentor or the manager reschedules',
    kind: 'change' as const
  },
  { id: 'm2', label: 'Pick a new slot, then confirm', kind: 'action' as const }
];

function drawPage() {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 640;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f6f7f9';
  g.fillRect(0, 0, 1000, 640);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 1000, 56);
  g.fillStyle = '#111827';
  g.font = '600 18px system-ui';
  g.fillText('Pack', 24, 35);
  g.font = '600 26px system-ui';
  g.fillText('Reschedule your session', 48, 120);
  g.font = '15px system-ui';
  g.fillStyle = '#4b5563';
  g.fillText('Mentoring with Ada Lovelace · 45 minutes', 48, 150);
  const slots = ['Tue 12 · 09:00', 'Tue 12 · 11:30', 'Wed 13 · 15:00', 'Thu 14 · 10:00'];
  slots.forEach((slot, index) => {
    g.fillStyle = index === 1 ? '#e0ecff' : '#ffffff';
    g.fillRect(48 + index * 200, 190, 180, 56);
    g.strokeStyle = index === 1 ? '#2f81f7' : '#d1d5db';
    g.strokeRect(48 + index * 200, 190, 180, 56);
    g.fillStyle = '#111827';
    g.fillText(slot, 66 + index * 200, 223);
  });
  g.fillStyle = '#111827';
  g.fillRect(48, 290, 200, 44);
  g.fillStyle = '#ffffff';
  g.font = '600 15px system-ui';
  g.fillText('Confirm reschedule', 76, 318);
  // The marks, as the page draws them
  const mark = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    text: string,
    dashed: boolean
  ) => {
    g.setLineDash(dashed ? [6, 4] : []);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
    g.setLineDash([]);
    g.font = '600 12px system-ui';
    const width = g.measureText(text).width + 16;
    g.fillStyle = color;
    g.fillRect(x - 2, y - 24, width, 20);
    g.fillStyle = '#ffffff';
    g.fillText(text, x + 6, y - 10);
  };
  mark(44, 286, 208, 52, '#2f81f7', '1  Changed: only the mentor or the manager reschedules', true);
  mark(244, 186, 188, 64, '#1a7f37', '2  Pick a new slot, then confirm', false);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

if (scene === 'browser') {
  document.body.dataset.view = 'browser';
  setTimeout(() => {
    const send = (event: unknown) => window.postMessage(event, '*');
    send({ event: 'browser', page: BROWSER_PAGE, marks: BROWSER_MARKS, isLive: true });
    send({ event: 'frame', data: drawPage(), width: 1000, height: 640 });
    send({ event: 'activity', text: 'click @e7' });
  }, 300);
}

const answer = (request: RpcRequest) => {
  if (request.method === 'getState') return state;
  if (request.method === 'connect') return { page: BROWSER_PAGE, marks: BROWSER_MARKS };
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
