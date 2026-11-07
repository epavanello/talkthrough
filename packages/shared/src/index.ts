/**
 * Types shared by the extension host and the webview: the review's state, as the host sends it,
 * and the RPC the webview calls.
 */

/**
 * A hunk of the PR diff. Lines are the PR head's (the base's for a deleted file). In a tour, a stop:
 * lines Claude picked, `header` their title, no additions or deletions.
 */
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

/**
 * What a review is about: a pull request, the person's own changes (not a PR yet), or a tour of how
 * something works (no diff: Claude picks the stops).
 */
export type ReviewKind = 'pr' | 'changes' | 'tour';

/** Your own changes: staged ones, everything uncommitted, or the whole branch against its base. */
export type ChangeScope = 'staged' | 'uncommitted' | 'branch';

/** How many files each scope of your own changes holds now: what the start screen offers. */
export interface LocalChanges {
  staged: number;
  uncommitted: number;
  branch: number;
  /** What the branch is compared with; null without main or master. */
  base: string | null;
}

export interface PrInfo {
  /** Missing in reviews kept by 0.4: a pull request. */
  kind?: ReviewKind;
  /** 0 when it is not a pull request. */
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

/** show, open and refs act on code; page opens the app in the browser panel, mark points at it. */
export type CueKind = 'show' | 'open' | 'refs' | 'page' | 'mark';

/**
 * A stage direction inside a reply: `[[show src/a.ts#L10-20]]`, `[[page /events/42]]`,
 * `[[mark @e3 The new guard]]`.
 */
export interface Cue {
  kind: CueKind;
  /** A repository path; page: a URL or path; mark: an @ref or a CSS selector. */
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
  kind?: ReviewKind;
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
  /** Not needed to review: shown with the others, never alone. */
  isOptional?: boolean;
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
  /** The browser panel: null without agent-browser, or with talkthrough.browser.enabled off. */
  browser: { isShown: boolean; page: BrowserPage | null; marks: BrowserMark[] } | null;
  /** The reviews kept for this repository, most recent first (the open one included). */
  reviews: ReviewSummary[];
  /** This window's repository's own changes; null without a repository. */
  changes: LocalChanges | null;
  /** Null until checked. */
  requirements: Requirement[] | null;
}

/**
 * The keyboard shortcuts, as package.json binds them (a test keeps the two the same); `mac` when a
 * Mac's differs.
 */
export const SHORTCUTS: { command: string; key: string; mac?: string; label: string }[] = [
  // Claude Code's own; not where it means something else (an editor you type in, the terminal)
  {
    command: 'talkthrough.toggleMic',
    key: 'ctrl+d',
    mac: 'cmd+d',
    label: 'Talk, then send what you said'
  },
  { command: 'talkthrough.next', key: 'ctrl+alt+right', label: 'Next: this step is clear' },
  { command: 'talkthrough.pauseResume', key: 'ctrl+alt+p', label: 'Pause or resume the voice' },
  { command: 'talkthrough.replay', key: 'ctrl+alt+r', label: "Replay Claude's last reply" },
  { command: 'talkthrough.browser', key: 'ctrl+alt+b', label: 'Show or hide the browser panel' }
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
  browser: null,
  reviews: [],
  changes: null,
  requirements: null
};

export const kindOf = (pr: { kind?: ReviewKind } | null) => pr?.kind ?? 'pr';

/** A review as a sentence names it: `the review of PR #943`, `the tour “How sign-up works”`. */
export function reviewName(review: { kind?: ReviewKind; number: number; title: string }) {
  const kind = kindOf(review);
  if (kind === 'tour') return `the tour “${review.title}”`;
  if (kind === 'changes')
    return `the review of ${review.title[0].toLowerCase()}${review.title.slice(1)}`;
  return `the review of PR #${review.number}`;
}

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
  /** A review of your own changes; one kept for the same scope goes on with them. */
  reviewChanges(scope: ChangeScope): Promise<void>;
  /** A guided tour of how something works, from a question ("how does sign-up work?"). */
  startTour(question: string): Promise<void>;
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
  /** Shows the browser panel, or hides it when shown. */
  toggleBrowser(): Promise<void>;
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
  /** Drops the dictation under way: nothing is sent. */
  cancelMic(): Promise<void>;
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

export interface BrowserPage {
  url: string;
  title: string;
}

/** A labelled box Claude drew on the page: what the PR changed, what to do, or a note. */
export interface BrowserMark {
  id: string;
  label: string;
  kind: 'change' | 'action' | 'note';
}

/** Input the person gives the page in the panel, as agent-browser's stream takes it. */
export type BrowserInput =
  | {
      type: 'input_mouse';
      eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
      x: number;
      y: number;
      button?: 'left' | 'right' | 'middle' | 'none';
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | {
      type: 'input_keyboard';
      eventType: 'keyDown' | 'rawKeyDown' | 'keyUp' | 'char';
      key?: string;
      code?: string;
      text?: string;
      /** What Chrome acts on for keys that edit or move (arrows, Backspace, Tab…). */
      windowsVirtualKeyCode?: number;
      modifiers?: number;
    };

/** A key as the webview's KeyboardEvent has it; `keyCode` is Chromium's Windows virtual key code. */
export interface KeyPress {
  key: string;
  code: string;
  keyCode: number;
  /** Alt 1, Ctrl 2, Meta 4, Shift 8: CDP's bits. */
  modifiers: number;
}

/**
 * A key, for the page: a printable one (Enter too) is a keyDown carrying its text, the others a
 * rawKeyDown with their virtual key code, which is what moves the caret or deletes in Chrome.
 */
export function keyInput(press: KeyPress, isUp = false): BrowserInput {
  const { key, code, keyCode: windowsVirtualKeyCode, modifiers } = press;
  if (isUp)
    return {
      type: 'input_keyboard',
      eventType: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
      modifiers
    };
  const isCommand = (modifiers & 0b110) !== 0;
  const text = key === 'Enter' ? '\r' : key.length === 1 && !isCommand ? key : undefined;
  return {
    type: 'input_keyboard',
    eventType: text ? 'keyDown' : 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
    ...(text ? { text } : {})
  };
}

/**
 * ⌘ with ← → and Backspace on macOS, as keys Chrome acts on: Home, End, and Shift+Home then
 * Backspace (it moves by words with ⌥ itself, not by lines with ⌘).
 */
export function macKeys(press: KeyPress): KeyPress[] {
  const META = 4;
  if (!(press.modifiers & META)) return [press];
  const modifiers = press.modifiers & ~META;
  if (press.key === 'ArrowLeft') return [{ key: 'Home', code: 'Home', keyCode: 36, modifiers }];
  if (press.key === 'ArrowRight') return [{ key: 'End', code: 'End', keyCode: 35, modifiers }];
  if (press.key === 'Backspace')
    return [
      { key: 'Home', code: 'Home', keyCode: 36, modifiers: 8 },
      { ...press, modifiers: 0 }
    ];
  return [press];
}

/** Editing the person asks of the page with ⌘ (Ctrl): Chrome on macOS has no keys for these. */
export type BrowserEdit = 'selectAll' | 'copy' | 'cut' | 'undo' | 'redo';

/** What the browser panel's webview can ask the extension host. */
export interface BrowserApi {
  /** Starts the browser and its live view if needed; the page and marks. */
  connect(): Promise<{ page: BrowserPage | null; marks: BrowserMark[] }>;
  navigate(url: string): Promise<void>;
  go(action: 'back' | 'forward' | 'reload'): Promise<void>;
  input(event: BrowserInput): Promise<void>;
  /** The viewport, in CSS pixels at the panel's pixel ratio: the page fits the panel, sharp. */
  resize(width: number, height: number, scale: number): Promise<void>;
  /** Pasted or composed text, typed into the focused field. */
  insertText(text: string): Promise<void>;
  /** Select all, undo, redo; copy and cut put the page's selection on the clipboard. */
  edit(command: BrowserEdit): Promise<void>;
  showMark(id: string): Promise<void>;
  clearMarks(): Promise<void>;
}

export type HostEvent =
  | { event: 'state'; state: ReviewState }
  /** A frame of the browser's live view: a JPEG and the viewport it shows. */
  | { event: 'frame'; data: string; width: number; height: number }
  | { event: 'browser'; page: BrowserPage | null; marks: BrowserMark[]; isLive: boolean }
  /** What the browser just did, in a few words. */
  | { event: 'activity'; text: string };

export interface RpcRequest {
  id: number;
  /** A method of HostApi, or of BrowserApi for the browser panel. */
  method: string;
  args: unknown[];
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: string;
}
