/**
 * Types shared by the extension host and the webview: the review's state, as the host sends it,
 * and the RPC the webview calls.
 */

/** A hunk of the PR diff. Lines are the PR head's (the base's for a deleted file). */
export interface Hunk {
  /** `H1`, `H2`…, in diff order. */
  id: string;
  path: string;
  /** First and last changed line: where the hunk's additions are, or where its deletions were. */
  start: number;
  end: number;
  /** The `@@ … @@` line's trailing context, often the enclosing function. */
  header: string;
  additions: number;
  deletions: number;
  /** What it changes, hashed: the same change keeps its key on a new head, where ids shift. */
  key: string;
}

/**
 * - `todo`: not talked about yet
 * - `explained`: Claude showed and explained it
 * - `ok`: the person said it is clear (Next, or "ok" by voice)
 */
export type HunkState = 'todo' | 'explained' | 'ok';

export type ChangeType = 'ADDED' | 'DELETED' | 'MODIFIED' | 'RENAMED';

export interface PrFile {
  path: string;
  previousPath: string | null;
  changeType: ChangeType;
  additions: number;
  deletions: number;
  hunks: string[];
}

export interface PrInfo {
  number: number;
  title: string;
  url: string | null;
  author: string | null;
  base: string;
  head: string;
  headSha: string;
  mergeBase: string;
  /** The local repository the review runs in. */
  repo: string;
  /** The checkout's HEAD is the PR head: diffs open on the real files, with live diagnostics. */
  isLive: boolean;
}

/** A group of hunks that belong together, in the order of the application flow. */
export interface Block {
  id: string;
  title: string;
  why: string;
  hunks: string[];
}

/** A related problem worth exploring, found while preparing. */
export interface Hotspot {
  id: string;
  title: string;
  detail: string;
  /** `path#L10-20` */
  anchors: string[];
}

export type CueKind = 'show' | 'open' | 'refs';

/** A stage direction inside a reply: `[[show src/a.ts#L10-20]]`. */
export interface Cue {
  kind: CueKind;
  path: string;
  start: number | null;
  end: number | null;
  symbol: string | null;
}

/** A piece of a sentence: words to read, a cue fired where it stands, or code (shown, never read). */
export type Part =
  | { type: 'text'; text: string }
  | { type: 'cue'; cue: Cue }
  | { type: 'code'; lang: string; code: string };

/** The unit the player reads, highlights and seeks to. */
export interface Sentence {
  parts: Part[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'claude' | 'note';
  at: number;
  /** What was typed or dictated; Claude's raw reply, cues included. */
  text: string;
  /** Claude's reply split for the player; a single text sentence otherwise. */
  sentences: Sentence[];
  isDictated?: boolean;
  /** Sent by Talkthrough rather than the person: the kickoff, the news of new commits. */
  isAuto?: boolean;
}

export interface PlayerState {
  messageId: string | null;
  sentence: number;
  isPlaying: boolean;
}

export type SessionStatus =
  /** No review open: the start screen. */
  | 'idle'
  /** Loading the PR, or starting Claude. */
  | 'starting'
  /** Claude asks something in its own terminal (a trust or permission dialog). */
  | 'waiting'
  | 'ready'
  | 'thinking'
  | 'recording'
  | 'ended'
  /** A review kept from an earlier window: Resume goes on with its Claude session. */
  | 'paused'
  | 'error';

/** A review kept across windows, as the start screen lists it. */
export interface ReviewSummary {
  id: string;
  number: number;
  title: string;
  /** Hunks marked ok, of all of them. */
  ok: number;
  total: number;
  /** When it last changed, in ms. */
  updatedAt: number;
}

/** GitHub's lists of open pull requests: review requested from me, assigned, mine, all. */
export type PullFilter = 'review' | 'assigned' | 'mine' | 'open';

export interface PullItem {
  number: number;
  title: string;
  url: string;
  author: string | null;
  isDraft: boolean;
  /** In ms. */
  updatedAt: number;
  head: string;
  additions: number;
  deletions: number;
}

export type PullList =
  | { status: 'ok'; items: PullItem[] }
  /** No GitHub repository here: `message` says why. */
  | { status: 'none'; message: string }
  | { status: 'error'; message: string };

/** What a review needs on this machine, checked on the start screen. */
export interface Requirement {
  name: string;
  state: 'ok' | 'warn' | 'missing';
  /** What was found, or what is wrong. */
  detail: string;
  /** A command that fixes it, typed into a terminal for the person to run. */
  fix?: string;
  url?: string;
}

export interface ReviewState {
  status: SessionStatus;
  error: string | null;
  /** What Claude is doing right now, in a few words. */
  activity: string | null;
  /** What Claude did in this turn, oldest first: the progress while it prepares. */
  trail: string[];
  /** The dialog Claude shows in its terminal while `waiting`. */
  dialog: 'trust' | 'other' | null;
  pr: PrInfo | null;
  files: PrFile[];
  hunks: Record<string, Hunk>;
  coverage: Record<string, HunkState>;
  /** Hunks explained since the last Next: what Next marks ok. */
  step: string[];
  blocks: Block[];
  hotspots: Hotspot[];
  messages: ChatMessage[];
  player: PlayerState;
  isSpeechOn: boolean;
  isRecording: boolean;
  /** What is being dictated, as Claude's prompt shows it live. */
  draft: string;
  /** The model the session runs (`claude-opus-5-5`), as Claude Code reports it. */
  model: string | null;
  /** The `talkthrough.model` and `talkthrough.effort` choices ('' for Claude Code's default). */
  choices: Record<Choice, string>;
  isTerminalShown: boolean;
  /** The PR moved past the head under review: its new head, and how many commits (null: rewritten). */
  newHead: { sha: string; commits: number | null } | null;
  /** The reviews kept for this repository, most recent first (the open one included). */
  reviews: ReviewSummary[];
  /** Null until checked. */
  requirements: Requirement[] | null;
}

/** The keyboard shortcuts, as package.json binds them (a test keeps the two the same). */
export const SHORTCUTS: { command: string; key: string; label: string }[] = [
  {
    command: 'talkthrough.toggleMic',
    key: 'ctrl+alt+space',
    label: 'Talk, then send what you said'
  },
  { command: 'talkthrough.next', key: 'ctrl+alt+right', label: 'Next: this step is clear' },
  { command: 'talkthrough.pauseResume', key: 'ctrl+alt+p', label: 'Pause or resume the voice' },
  { command: 'talkthrough.replay', key: 'ctrl+alt+r', label: "Replay Claude's last reply" }
];

/**
 * What the header picks, by setting: Claude Code's model aliases (the latest of each family) and
 * effort levels, both per session (`--model`, `--effort`): your own defaults stay as they are.
 */
export const CHOICES = {
  model: [
    { value: '', label: 'Default' },
    { value: 'fable', label: 'Fable' },
    { value: 'opus', label: 'Opus' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' }
  ],
  effort: [
    { value: '', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
    { value: 'max', label: 'Max' }
  ]
};

export type Choice = keyof typeof CHOICES;

export const EMPTY_STATE: ReviewState = {
  status: 'idle',
  error: null,
  activity: null,
  trail: [],
  dialog: null,
  pr: null,
  files: [],
  hunks: {},
  coverage: {},
  step: [],
  blocks: [],
  hotspots: [],
  messages: [],
  player: { messageId: null, sentence: 0, isPlaying: false },
  isSpeechOn: true,
  isRecording: false,
  draft: '',
  model: null,
  choices: { model: '', effort: '' },
  isTerminalShown: false,
  newHead: null,
  reviews: [],
  requirements: null
};

/** A PR that has no map yet while Claude is busy: it is still preparing, and input waits. */
export const isPreparing = (state: ReviewState) =>
  !state.blocks.length && (state.status === 'starting' || state.status === 'thinking');

/** What the webview can ask the extension host. */
export interface HostApi {
  getState(): Promise<ReviewState>;
  /** A PR number or URL; empty asks for one. A PR with a kept review goes on with it. */
  start(pr: string): Promise<void>;
  /** The open pull requests of a list, narrowed by search text. */
  listPulls(filter: PullFilter, text: string): Promise<PullList>;
  /** Opens a kept review and goes on with its Claude session. */
  openReview(id: string): Promise<void>;
  /** Forgets a kept review (asks first unless every hunk is ok). */
  dropReview(id: string): Promise<void>;
  /** Back to the start screen: Claude stops, the review is kept. */
  closeReview(): Promise<void>;
  checkRequirements(): Promise<void>;
  /** Types a command into a new terminal, for the person to run. */
  runInTerminal(command: string): Promise<void>;
  stop(): Promise<void>;
  /** Goes on with the review's Claude session. */
  resume(): Promise<void>;
  /** A new Claude session on the same PR (it prepares again). */
  restart(): Promise<void>;
  /** Brings the review to the PR's new head: only what changed is to review again. */
  update(): Promise<void>;
  /** Answers Claude's trust dialog: this folder is trusted. */
  trustFolder(): Promise<void>;
  /** A worktree at the PR head, opened in a new window where the review goes on. */
  openWorktree(): Promise<void>;
  /** Checks the PR's branch out in this window (asks first). */
  checkoutPr(): Promise<void>;
  /** A model or an effort level ('' for the default); a running session goes on with it. */
  choose(setting: Choice, value: string): Promise<void>;
  send(text: string): Promise<void>;
  toggleMic(): Promise<void>;
  /** The diffs of this step are clear: mark them ok and go on. */
  next(): Promise<void>;
  /** Stops Claude's current turn (Esc in its terminal). */
  interrupt(): Promise<void>;
  play(messageId: string, sentence: number): Promise<void>;
  pauseResume(): Promise<void>;
  /** Previous (-1) or next (+1) sentence. */
  seek(delta: number): Promise<void>;
  replayLast(): Promise<void>;
  stopSpeech(): Promise<void>;
  setSpeech(isOn: boolean): Promise<void>;
  runCue(cue: Cue): Promise<void>;
  showHunk(id: string): Promise<void>;
  setHunks(ids: string[], state: HunkState): Promise<void>;
  /** Every hunk back to todo (after asking): the review starts over. */
  reset(): Promise<void>;
  showTerminal(): Promise<void>;
  /** Shows Claude's terminal, or hides it when shown. */
  toggleTerminal(): Promise<void>;
  openUrl(url: string): Promise<void>;
}

export type HostEvent = { event: 'state'; state: ReviewState };

export interface RpcRequest {
  id: number;
  method: keyof HostApi;
  args: unknown[];
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: string;
}
