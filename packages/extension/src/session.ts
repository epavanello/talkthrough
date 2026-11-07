/**
 * One review: the PR and its hunks, the Claude session that talks it through, the voice, the stage,
 * and the memory of what has been explained and what the person said is clear. Reviews are kept
 * (ReviewStore), listed on the start screen and resumed with their own Claude session; a window has
 * one open at a time.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CHOICES,
  EMPTY_STATE,
  isPreparing,
  kindOf,
  type Block,
  type ChangeScope,
  type ChatMessage,
  type Choice,
  type Cue,
  type Hotspot,
  type Hunk,
  type HunkState,
  type PrFile,
  type ReviewState,
  type ReviewSummary,
  type SessionStatus
} from '@talkthrough/shared';
import { changeCounts, changesHead, loadChanges, loadTour } from './changes';
import { checkoutHere, reviewWorktree } from './checkout';
import { ClaudeProcess, claudeArgs } from './claude';
import { cuesOf, parseReply } from './cues';
import { DELTA_TITLE, carryOver } from './delta';
import { hunksAt, indexPatch, parsePatch, renderPatch, type ParsedFile } from './patch';
import { Player, SaySpeaker } from './player';
import {
  commitsOf,
  commitsSince,
  currentHead,
  fileAt,
  isAtCommit,
  loadLocal,
  loadPr,
  markViewed,
  parsePrRef,
  prDiff,
  searchAt,
  type LoadedPr,
  type PrRef
} from './pr';
import { git, run } from './proc';
import { NEXT, kickoff, systemPrompt, updatePrompt } from './prompts';
import { checkRequirements } from './requirements';
import { ReviewStore } from './reviews';
import { Browser, browserBin, markOf, resolveUrl, type MarkKind } from './browser';
import { BrowserPanel } from './browserPanel';
import { ReviewServer, type ToolResult } from './server';
import { Stage } from './stage';
import { MirrorTerminal } from './terminal';
import {
  BROWSER_TOOLS,
  TOOLS,
  TOUR_TOOLS,
  mapProblems,
  tourMap,
  type MapInput,
  type TourInput
} from './tools';

type LocalInput = {
  kind: 'local';
  repo: string;
  base: string;
  head: string;
  number: number;
  title: string;
};
export type StartInput =
  | { kind: 'github'; pr: string; repo?: string }
  | LocalInput
  | { kind: 'changes'; scope: ChangeScope; repo?: string }
  | { kind: 'tour'; question: string; repo?: string };

export interface StartOptions {
  /** Run this instead of the installed CLI (tests). */
  claudeCommand?: string[];
  isSpeechOn?: boolean;
}

/** A review as kept: enough to list it, show it, and go on with its Claude session. */
interface SavedReview {
  id: string;
  /** The repository's git directory, shared by its worktrees: each of them lists the review. */
  commonDir: string;
  input: StartInput;
  loaded: LoadedPr;
  files: PrFile[];
  hunks: Record<string, Hunk>;
  coverage: Record<string, HunkState>;
  step: string[];
  blocks: Block[];
  hotspots: Hotspot[];
  messages: ChatMessage[];
  sessionId: string;
  model: string | null;
  updatedAt: number;
}

/** A review handed to a worktree's new window, which goes on with it. */
interface Handoff {
  folder: string;
  id: string;
  at: number;
}

const config = () => vscode.workspace.getConfiguration('talkthrough');

/** Claude's replies and dictation: the setting, else the language of VS Code's interface. */
const language = () =>
  config().get<string>('language', '').trim() ||
  new Intl.DisplayNames(['en'], { type: 'language' })
    .of(vscode.env.language.split('-')[0])
    ?.toLowerCase() ||
  'english';

/** How long Claude may take to take the first prompt before it is assumed to be asking something. */
const START_TIMEOUT = 25_000;
/** Waits before resuming again: Claude's session may still be closing in another window. */
const RETRIES = [1000, 2000, 4000, 8000];
const MAX_DIFF = 150_000;
const MAX_FILE_LINES = 1500;
const KEEP_MESSAGES = 300;
const MAX_TRAIL = 40;
/** How often an open review looks for new commits on its PR (and when the window gets focus). */
const HEAD_INTERVAL = 3 * 60_000;
/** workspaceState: the review this window has open. */
const OPEN_KEY = 'talkthrough.open';
/** globalState: a review handed to a worktree's window (`Handoff`). */
const HANDOFF_KEY = 'talkthrough.handoff';
/** Environment a nested Claude Code would mistake for being run by another Claude session. */
const INHERITED = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT'
];

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  mcp__talkthrough__pr_overview: () => 'Reading the overview',
  mcp__talkthrough__pr_diff: () => 'Reading the diff',
  mcp__talkthrough__pr_file: (input) => `Reading ${path.basename(String(input.path ?? ''))}`,
  mcp__talkthrough__pr_search: (input) => `Searching “${String(input.pattern ?? '').slice(0, 40)}”`,
  mcp__talkthrough__code_file: (input) => `Reading ${path.basename(String(input.path ?? ''))}`,
  mcp__talkthrough__code_search: (input) =>
    `Searching “${String(input.pattern ?? '').slice(0, 40)}”`,
  mcp__talkthrough__set_map: () => 'Drawing the map',
  mcp__talkthrough__set_tour: () => 'Drawing the tour',
  mcp__talkthrough__find_references: (input) =>
    `Looking for the references of ${input.symbol ?? 'a symbol'}`,
  mcp__talkthrough__mark_ok: () => 'Marking hunks as ok',
  mcp__talkthrough__review_state: () => 'Checking the review',
  Read: (input) => `Reading ${path.basename(String(input.file_path ?? ''))}`,
  Grep: (input) => `Searching “${String(input.pattern ?? '').slice(0, 40)}”`,
  Glob: () => 'Listing files',
  Bash: (input) => `Running ${String(input.command ?? '').slice(0, 50)}`
};

/** The last thing Claude said in a transcript, for a Stop hook that doesn't carry it. */
async function lastReplyIn(transcript: string) {
  try {
    const size = (await stat(transcript)).size;
    const length = Math.min(size, 1024 * 1024);
    const handle = await open(transcript, 'r');
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    await handle.close();
    const lines = buffer.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue;
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
        if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
        const text = (entry.message.content as { type: string; text?: string }[])
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('\n')
          .trim();
        if (text) return text;
      } catch {
        // A line cut by the window start
      }
    }
  } catch {
    // No transcript
  }
  return '';
}

function summaryOf(review: SavedReview): ReviewSummary {
  const ids = Object.keys(review.hunks);
  return {
    id: review.id,
    kind: kindOf(review.loaded.info),
    number: review.loaded.info.number,
    title: review.loaded.info.title,
    ok: ids.filter((id) => review.coverage[id] === 'ok').length,
    total: ids.length,
    updatedAt: review.updatedAt
  };
}

/** The repository's own git directory: the same from every worktree. */
const commonDirOf = async (repo: string) =>
  realpath(await git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'));

async function load(input: StartInput, repo: string) {
  if (input.kind === 'local') return loadLocal(repo, input);
  if (input.kind === 'changes') return loadChanges(repo, input.scope);
  if (input.kind === 'tour') return loadTour(repo, input.question);
  return loadPr(repo, await parsePrRef(repo, input.pr));
}

/** A review's id: one per PR, per scope of your own changes; each tour its own. */
function idOf(input: StartInput, commonDir: string, ref: PrRef | null) {
  if (input.kind === 'github' && ref)
    return `${commonDir}#${`${ref.owner}/${ref.name}`.toLowerCase()}#${ref.number}`;
  if (input.kind === 'local') return `${commonDir}#local#${input.number}`;
  if (input.kind === 'changes') return `${commonDir}#changes#${input.scope}`;
  return `${commonDir}#tour#${Date.now().toString(36)}`;
}

/** What a start or resume says it is doing first. */
const LOADING: Record<StartInput['kind'], string> = {
  github: 'Loading the pull request',
  local: 'Loading the pull request',
  changes: 'Reading your changes',
  tour: 'Starting the tour'
};

export class ReviewSession implements vscode.Disposable {
  state: ReviewState = structuredClone(EMPTY_STATE);
  /** Settles once the kept reviews are read and the window's open review is back. */
  readonly ready: Promise<void>;
  private review: { id: string; commonDir: string; input: StartInput } | null = null;
  private loaded: LoadedPr | null = null;
  private parsed: ParsedFile[] = [];
  /** Claude Code's id for the review's session: `--session-id` at first, `--resume` after. */
  private sessionId = '';
  private claude: ClaudeProcess | null = null;
  /** The command run in place of the installed CLI (tests). */
  private command: string[] | null = null;
  /** The running Claude's SessionStart hook arrived. */
  private hasStarted = false;
  /** The running Claude showed a dialog: its exit is an answer, not a resume to try again. */
  private hasAsked = false;
  /** The running Claude listed the stage's tools: a prompt before that would run without them. */
  private isListed = false;
  private listTimer: NodeJS.Timeout | undefined;
  /** The prompt on Claude's command line: shown as Talkthrough's, not the person's. */
  private autoPrompt: string | null = null;
  /** Bumped by every start, resume and stop: work for an older one stops where it is. */
  private run = 0;
  private readonly store: ReviewStore<SavedReview>;
  private readonly summaries = new Map<string, ReviewSummary & { commonDir: string }>();
  /** This window's repository; null without one. */
  private here: { repo: string; commonDir: string } | null = null;
  private readonly server: ReviewServer;
  private readonly player: Player;
  private readonly stage: Stage;
  private readonly mirror: MirrorTerminal;
  /** The app in a browser panel (agent-browser): null when off or not installed. */
  private browser: Browser | null = null;
  private readonly panel: BrowserPanel;
  /** The tools the running Claude has: the stage's, and the browser's when it is on. */
  private tools = TOOLS;
  private readonly listeners = new Set<() => void>();
  private notifyTimer: NodeJS.Timeout | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private screenTimer: NodeJS.Timeout | undefined;
  private dictationTimer: NodeJS.Timeout | undefined;
  private startTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private saving = Promise.resolve();
  private isDirty = false;
  private lastActivity = 0;
  private nextId = 1;
  /** What changed outside the conversation (Next, a checkout), told to Claude with the next prompt. */
  private pendingNotes: string[] = [];
  /** Dictation was stopped: the prompt that comes next was spoken. */
  private isAwaitingDictation = false;
  private isChecking = false;
  private isCheckingHead = false;
  private lastHeadCheck = 0;
  private readonly headTimer: NodeJS.Timeout;
  private readonly focus: vscode.Disposable;
  private viewed = new Set<string>();

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    log: vscode.LogOutputChannel
  ) {
    this.store = new ReviewStore(path.join(ctx.globalStorageUri.fsPath, 'reviews'));
    this.server = new ReviewServer({
      hook: (event, payload) => this.handleHook(event, payload),
      tools: () => this.tools,
      callTool: (name, args) => this.callTool(name, args),
      onListed: () => this.listed(),
      instructions:
        'The stage of a Talkthrough PR review: the PR, its hunks, the review map and the editor.'
    });
    this.player = new Player(
      new SaySpeaker(() => ({
        voice: config().get<string>('speech.voice', ''),
        rate: config().get<number>('speech.rate', 185)
      })),
      (cue) => this.runCue(cue),
      () => {
        this.state.player = { ...this.player.state };
        this.changed();
      }
    );
    this.stage = new Stage(() =>
      this.loaded ? { pr: this.loaded.info, files: this.state.files } : null
    );
    this.mirror = new MirrorTerminal(() => {
      this.state.isTerminalShown = this.mirror.isShown;
      this.changed();
    });
    this.panel = new BrowserPanel(
      ctx.extensionUri,
      () => this.browser,
      log,
      () => this.syncBrowser()
    );
    this.state.isSpeechOn = config().get<boolean>('speech.enabled', true);
    this.state.choices = { model: config().get('model', ''), effort: config().get('effort', '') };
    // New commits on the PR: looked for every few minutes, and when the window gets focus
    this.headTimer = setInterval(() => void this.checkHead(), HEAD_INTERVAL);
    this.focus = vscode.window.onDidChangeWindowState((window) => {
      if (!window.focused) return;
      if (Date.now() - this.lastHeadCheck > 30_000) void this.checkHead();
      void this.countChanges();
    });
    this.ready = this.init();
  }

  // ---- lifecycle

  private async init() {
    const repo = await findRepo().catch(() => null);
    this.here = repo ? { repo, commonDir: await commonDirOf(repo).catch(() => '') } : null;
    for (const review of await this.store.all())
      this.summaries.set(review.id, { ...summaryOf(review), commonDir: review.commonDir });
    const handoff = this.ctx.globalState.get<Handoff>(HANDOFF_KEY);
    const isHandedHere =
      Boolean(handoff && repo && Date.now() - handoff.at < 10 * 60_000) &&
      (await realpath(handoff!.folder).catch(() => 1)) === (await realpath(repo!).catch(() => 2));
    if (isHandedHere) await this.ctx.globalState.update(HANDOFF_KEY, undefined);
    const id = isHandedHere ? handoff!.id : this.ctx.workspaceState.get<string>(OPEN_KEY);
    const saved = id ? await this.store.get(id) : null;
    if (saved) this.show(saved);
    this.listReviews();
    void this.checkHead();
    void this.countChanges();
    if (!isHandedHere || !saved) return;
    void vscode.commands.executeCommand('talkthrough.chat.focus');
    const setup = config().get<string>('worktreeSetup', '').trim();
    if (setup)
      vscode.window.createTerminal({ name: 'Talkthrough setup', cwd: repo! }).sendText(setup);
    void this.resume();
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** Coalesces a burst of changes into one state message. */
  private changed() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      this.listeners.forEach((listener) => listener());
    }, 30);
  }

  /** Something worth keeping changed: the review is saved a moment later. */
  private touch() {
    this.isDirty = true;
    this.lastActivity = Date.now();
    this.saveTimer ??= setTimeout(() => this.save(), 1000);
    this.changed();
  }

  /** The server's address and token, for tests. */
  get endpoint() {
    return { port: this.server.port, token: this.server.token };
  }

  /** Saves the review now rather than a moment later. */
  flush() {
    this.save();
    return this.saving;
  }

  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (!this.review || !this.loaded || !this.isDirty) return;
    this.isDirty = false;
    const { files, hunks, coverage, step, blocks, hotspots, messages, model } = this.state;
    const review: SavedReview = {
      ...this.review,
      loaded: this.loaded,
      files,
      hunks,
      coverage,
      step,
      blocks,
      hotspots,
      messages: messages.slice(-KEEP_MESSAGES),
      sessionId: this.sessionId,
      model,
      updatedAt: this.lastActivity
    };
    this.summaries.set(review.id, { ...summaryOf(review), commonDir: review.commonDir });
    this.listReviews();
    this.saving = this.saving.then(() => this.store.save(review)).catch(() => {});
  }

  /** The reviews of this window's repository (all of them without one), most recent first. */
  private listReviews() {
    this.state.reviews = [...this.summaries.values()]
      .filter((review) => !this.here || review.commonDir === this.here.commonDir)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ commonDir: _, ...summary }) => summary);
    this.changed();
  }

  /** A review's state in place of the current one, keeping the window's (voice, model, lists). */
  private replaceState(fields: Partial<ReviewState>) {
    const { isSpeechOn, choices, reviews, changes, requirements } = this.state;
    this.state = {
      ...structuredClone(EMPTY_STATE),
      isSpeechOn,
      choices,
      reviews,
      changes,
      requirements,
      ...fields
    };
    this.changed();
  }

  /** What each scope of this window's own changes holds now, for the start screen. */
  async countChanges() {
    const repo = this.here?.repo;
    this.state.changes = repo ? await changeCounts(repo).catch(() => null) : null;
    this.changed();
  }

  /** A kept review as it was, waiting for Resume. */
  private show(saved: SavedReview, status: SessionStatus = 'paused') {
    this.review = { id: saved.id, commonDir: saved.commonDir, input: saved.input };
    this.loaded = saved.loaded;
    this.sessionId = saved.sessionId;
    this.parsed = [];
    this.pendingNotes = [];
    this.viewed = new Set(saved.loaded.viewedPaths);
    this.lastActivity = saved.updatedAt;
    const { files, hunks, coverage, step, blocks, hotspots, messages, model } = saved;
    this.replaceState({
      status,
      pr: saved.loaded.info,
      files,
      hunks,
      coverage,
      step,
      blocks,
      hotspots,
      // Parsed again: replies kept by an older version get today's reading of their cues
      messages: messages.map((message) =>
        message.role === 'claude' ? { ...message, sentences: parseReply(message.text) } : message
      ),
      model
    });
    this.nextId = 1 + Math.max(0, ...messages.map((message) => Number(message.id.slice(1)) || 0));
    void this.ctx.workspaceState.update(OPEN_KEY, saved.id);
  }

  private apply(options: StartOptions) {
    if (options.claudeCommand) this.command = options.claudeCommand;
    if (options.isSpeechOn !== undefined) this.state.isSpeechOn = options.isSpeechOn;
  }

  /** Starts a review of a PR; one kept for it goes on instead. */
  async start(input: StartInput, options: StartOptions = {}) {
    await this.ready;
    this.apply(options);
    await this.leave();
    const run = this.run;
    this.review = null;
    this.loaded = null;
    this.replaceState({ status: 'starting' });
    this.track(LOADING[input.kind]);
    try {
      const repo = input.repo ?? (await findRepo());
      const commonDir = await commonDirOf(repo);
      const ref = input.kind === 'github' ? await parsePrRef(repo, input.pr) : null;
      const id = idOf(input, commonDir, ref);
      const saved = await this.store.get(id);
      if (run !== this.run) return;
      if (saved) {
        this.show(saved, 'starting');
        return await this.resume();
      }
      const loaded = ref ? await loadPr(repo, ref) : await load(input, repo);
      const parsed = loaded.info.kind === 'tour' ? [] : parsePatch(await prDiff(loaded.info));
      if (input.kind === 'changes' && !parsed.length)
        throw new Error(
          input.scope === 'staged'
            ? 'No staged changes to review: stage some first.'
            : input.scope === 'uncommitted'
              ? 'No uncommitted changes to review.'
              : `Nothing on ${loaded.info.head} that ${loaded.info.base} doesn't have.`
        );
      if (run !== this.run) return;
      this.review = { id, commonDir, input: { ...input, repo } };
      this.loaded = loaded;
      this.parsed = parsed;
      this.sessionId = randomUUID();
      this.pendingNotes = [];
      this.viewed = new Set();
      this.nextId = 1;
      const { files, hunks } = indexPatch(parsed);
      Object.assign(this.state, { pr: loaded.info, files, hunks });
      this.state.coverage = this.withViewed({});
      void this.ctx.workspaceState.update(OPEN_KEY, id);
      this.touch();
      await this.server.listen();
      if (run === this.run) await this.launch(run, { prompt: kickoff(loaded.info, loaded.body) });
    } catch (error) {
      if (run === this.run) this.fail(error);
    }
  }

  /**
   * Goes on with the review's Claude session (`--resume`): its conversation, so Claude remembers the
   * PR. When the PR got new commits meanwhile, the hunks are read again and Claude redraws the map.
   */
  resume(options: StartOptions = {}) {
    return this.reopen(options, false);
  }

  /** A new Claude session on the same PR: it prepares again. The chat and the hunk states stay. */
  restart(options: StartOptions = {}) {
    return this.reopen(options, true);
  }

  private async reopen(options: StartOptions, isFresh: boolean) {
    await this.ready;
    if (!this.review || !this.loaded) return;
    this.apply(options);
    this.run++;
    await this.stopProcess();
    const run = this.run;
    const review = this.review;
    this.state.error = null;
    this.state.trail = [];
    this.setStatus('starting', null);
    this.track(
      review.input.kind === 'changes' ? 'Reading your changes' : 'Checking the pull request'
    );
    try {
      if (review.input.kind === 'tour') return await this.reopenTour(run, isFresh);
      // This window's checkout of the repository (a worktree, say), else where the review last ran
      const repo =
        this.here?.commonDir === review.commonDir ? this.here.repo : this.loaded.info.repo;
      const loaded = await load(review.input, repo);
      const parsed = parsePatch(await prDiff(loaded.info));
      if (run !== this.run) return;
      const hasMoved = loaded.info.headSha !== this.loaded.info.headSha;
      const commits = hasMoved
        ? await commitsSince(this.loaded, loaded.info.headSha).catch(() => null)
        : 0;
      if (run !== this.run) return;
      // On a new head, what didn't change keeps its state; Claude hears what moved
      let prompt = hasMoved ? this.moveTo(loaded, parsed, commits) : undefined;
      if (!hasMoved) {
        this.loaded = loaded;
        this.parsed = parsed;
        this.state.pr = loaded.info;
        this.state.coverage = this.withViewed(this.state.coverage);
      }
      if (isFresh) {
        Object.assign(this.state, { blocks: [], hotspots: [] });
        this.sessionId = randomUUID();
        this.pendingNotes = [];
        this.note('A new Claude session: it prepares the review again.');
        prompt = kickoff(loaded.info);
      }
      this.touch();
      await this.server.listen();
      if (run !== this.run) return;
      await this.launch(run, { isResume: !isFresh, prompt });
    } catch (error) {
      if (run === this.run) this.fail(error);
    }
  }

  /**
   * A tour goes on where it stopped: its stops stay on the code they were drawn on. A new Claude
   * session draws the tour again.
   */
  private async reopenTour(run: number, isFresh: boolean) {
    const loaded = this.loaded!;
    let prompt: string | undefined;
    if (isFresh) {
      Object.assign(this.state, {
        files: [],
        hunks: {},
        coverage: {},
        step: [],
        blocks: [],
        hotspots: []
      });
      this.sessionId = randomUUID();
      this.pendingNotes = [];
      this.note('A new Claude session: it draws the tour again.');
      prompt = kickoff(loaded.info, loaded.body);
    }
    this.touch();
    await this.server.listen();
    if (run !== this.run) return;
    await this.launch(run, { isResume: !isFresh, prompt });
  }

  /** Opens a kept review and goes on with its Claude session. */
  async openReview(id: string, options: StartOptions = {}) {
    await this.ready;
    const saved = await this.store.get(id);
    if (!saved) return;
    await this.leave();
    this.show(saved, 'starting');
    await this.resume(options);
  }

  /** Back to the start screen: Claude stops, the review is kept. */
  async close() {
    await this.ready;
    await this.leave();
    this.review = null;
    this.loaded = null;
    this.parsed = [];
    void this.ctx.workspaceState.update(OPEN_KEY, undefined);
    this.replaceState({ status: 'idle' });
    this.listReviews();
    void this.countChanges();
  }

  /** Forgets kept reviews; the open one among them closes first. */
  async drop(ids: string[]) {
    await this.ready;
    if (this.review && ids.includes(this.review.id)) await this.close();
    await this.saving;
    await Promise.all(ids.map((id) => this.store.remove(id)));
    ids.forEach((id) => this.summaries.delete(id));
    this.listReviews();
  }

  /** Saves the open review and stops its Claude; the state is the caller's to change. */
  private async leave() {
    this.run++;
    await this.stopProcess();
    await this.flush();
  }

  /** Saves a model or effort choice; a running session goes on with it (same conversation, relaunched). */
  async choose(setting: Choice, value: string) {
    await config().update(setting, value, vscode.ConfigurationTarget.Global);
    this.state.choices = { ...this.state.choices, [setting]: value };
    this.changed();
    if (!this.claude) return;
    const label = CHOICES[setting].find((one) => one.value === value)?.label ?? value;
    this.note(
      `Switching to ${value ? label : 'the default'}${setting === 'effort' ? ' effort' : ''}.`
    );
    this.run++;
    await this.stopProcess();
    const run = this.run;
    this.setStatus('starting', null);
    this.track('Restarting Claude');
    await this.launch(run, { isResume: true });
  }

  private async launch(run: number, mode: { isResume?: boolean; prompt?: string }, attempt = 0) {
    const command = this.command ?? [await resolveClaude()];
    const hasBrowser = Boolean(await this.browserReady());
    const pr = this.loaded!.info;
    const kind = kindOf(pr);
    const tools = kind === 'tour' ? TOUR_TOOLS : TOOLS;
    this.tools = hasBrowser ? [...tools, ...BROWSER_TOOLS] : tools;
    if (run !== this.run) return;
    const claude = new ClaudeProcess(
      this.ctx.asAbsolutePath(path.join('resources', 'ptybridge.py'))
    );
    this.claude = claude;
    this.hasStarted = false;
    this.isListed = false;
    clearTimeout(this.listTimer);
    this.listTimer = undefined;
    this.hasAsked = false;
    this.autoPrompt = mode.prompt ?? null;
    const startedAt = Date.now();
    claude.onOutput(() => this.watchScreen());
    claude.onExit((code) => this.exited(claude, code, run, mode, attempt, Date.now() - startedAt));
    const args = claudeArgs({
      port: this.server.port,
      token: this.server.token,
      language: language(),
      model: config().get<string>('model', ''),
      effort: config().get<string>('effort', ''),
      systemPrompt: systemPrompt(language(), hasBrowser, kind),
      name: `Talkthrough · ${kind === 'pr' ? `PR #${pr.number}: ` : kind === 'tour' ? 'Tour: ' : ''}${pr.title}`.slice(
        0,
        100
      ),
      sessionId: this.sessionId,
      resume: mode.isResume,
      prompt: mode.prompt,
      disabledPlugins: config().get<string[]>('disabledPlugins', ['earshot@earshot'])
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TALKTHROUGH_PORT: String(this.server.port),
      TALKTHROUGH_TOKEN: this.server.token,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Seven small tools: listed up front, so the first turn doesn't spend a step searching for them
      ENABLE_TOOL_SEARCH: 'false'
    };
    INHERITED.forEach((name) => delete env[name]);
    this.track(mode.isResume ? "Reopening Claude's session" : 'Starting Claude');
    claude.start([...command, ...args], pr.repo, env);
    void vscode.commands.executeCommand('setContext', 'talkthrough.active', true);
    clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      if (this.state.status === 'starting')
        this.waiting(
          'other',
          'Claude has not started yet: it may be asking something in its terminal.'
        );
    }, START_TIMEOUT);
  }

  /**
   * Claude is gone. A resume that ends before Claude starts is tried again a moment later: the
   * session may still be closing in another window. A dialog answered "no" is not retried.
   */
  private exited(
    claude: ClaudeProcess,
    code: number | null,
    run: number,
    mode: { isResume?: boolean; prompt?: string },
    attempt: number,
    ranFor: number
  ) {
    if (this.claude !== claude) return;
    this.claude = null;
    this.quiet();
    if (code === 127)
      return this.fail(
        new Error('Claude Code was not found: install it, or set talkthrough.claudePath.')
      );
    const isNotFound = /No conversation found/i.test(claude.screen);
    const hasFailedToResume = mode.isResume && !this.hasStarted && !this.hasAsked;
    if (hasFailedToResume && (isNotFound || ranFor < 20_000) && attempt < RETRIES.length) {
      this.setStatus('starting', null);
      this.track(
        `Waiting for Claude's session to be free (try ${attempt + 2} of ${RETRIES.length + 1})`
      );
      this.retryTimer = setTimeout(
        () => void this.launch(run, mode, attempt + 1),
        RETRIES[attempt]
      );
      return;
    }
    if (hasFailedToResume)
      return this.fail(
        new Error(
          `Claude could not reopen this review's session${isNotFound ? ': Claude Code has no conversation with its id' : ''}. Try again, or start a new Claude session: it prepares the review again, your chat and hunk states stay.`
        )
      );
    this.setStatus('ended', code ? `Claude exited with code ${code}` : null);
  }

  /** What a running Claude leaves behind: its voice, terminal, dictation and timers. */
  private quiet() {
    clearTimeout(this.startTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.dictationTimer);
    this.player.stop();
    this.mirror.close();
    this.state.isRecording = false;
    this.state.draft = '';
    this.state.dialog = null;
    this.isAwaitingDictation = false;
    void vscode.commands.executeCommand('setContext', 'talkthrough.active', false);
  }

  /** Stops Claude quietly (the caller says what comes next), and waits until it is gone. */
  private async stopProcess() {
    const claude = this.claude;
    this.claude = null;
    this.quiet();
    await claude?.dispose();
  }

  /** Ends the Claude session; the review stays, and Resume goes on with it later. */
  async end() {
    const wasRunning = Boolean(this.claude) || this.state.status === 'starting';
    this.run++;
    await this.stopProcess();
    if (wasRunning) this.setStatus('ended', null);
  }

  /** Before the extension host goes: the review saved and Claude gone. */
  async shutdown() {
    this.run++;
    this.panel.dispose();
    await Promise.all([this.flush(), this.stopProcess(), this.browser?.close()]);
  }

  dispose() {
    void this.shutdown();
    clearInterval(this.headTimer);
    this.focus.dispose();
    this.server.close();
    this.stage.dispose();
    this.mirror.dispose();
  }

  private fail(error: unknown) {
    this.state.error = (error as Error).message;
    this.setStatus('error', null);
  }

  private setStatus(status: SessionStatus, activity: string | null) {
    this.state.status = status;
    this.state.activity = activity;
    if (status !== 'waiting') this.state.dialog = null;
    this.changed();
  }

  /** What Claude (or the start) is doing: the header shows it, the trail keeps it. */
  private track(activity: string) {
    this.state.activity = activity;
    if (this.state.trail.at(-1) !== activity)
      this.state.trail = [...this.state.trail, activity].slice(-MAX_TRAIL);
    this.changed();
  }

  private waiting(dialog: 'trust' | 'other', reason: string) {
    this.hasAsked = true;
    this.state.dialog = dialog;
    this.state.status = 'waiting';
    this.state.activity = reason;
    this.changed();
  }

  /** Dialogs and dictation outcomes only show on Claude's screen. */
  private watchScreen() {
    clearTimeout(this.screenTimer);
    this.screenTimer = setTimeout(() => {
      const claude = this.claude;
      if (!claude) return;
      const screen = claude.screen.slice(-2000);
      const failure =
        screen.match(/Recording failed[^\n]*/)?.[0] ??
        (/No speech detected/i.test(screen) ? 'No speech detected' : null);
      if (failure) {
        claude.clearScreen();
        this.state.isRecording = false;
        this.isAwaitingDictation = false;
        this.state.draft = '';
        this.note(`${failure.trim()}.`);
        this.setStatus('ready', null);
        return;
      }
      if (/Voice: processing/i.test(screen) && this.isAwaitingDictation) this.track('Transcribing');
      // What is being dictated shows in Claude's prompt as it is heard
      if (this.state.isRecording || this.isAwaitingDictation) {
        const draft = this.heard(claude.promptText());
        if (draft !== this.state.draft) {
          this.state.draft = draft;
          this.changed();
        }
      }
      if (this.state.status === 'thinking' || this.state.status === 'recording') return;
      if (/trust this folder|one you trust/i.test(screen))
        this.waiting('trust', 'Claude asks whether you trust this folder.');
      else if (/Enter to confirm|Do you want to proceed|Esc to cancel/i.test(screen))
        this.waiting('other', 'Claude is asking something in its terminal.');
    }, 150);
  }

  /**
   * What dictation heard so far. Until it hears new words, Claude Code may show the last message
   * sent in its prompt: that is not what is being said.
   */
  private heard(text: string) {
    const words = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    const sent = [...this.state.messages].reverse().find((one) => one.role === 'user');
    return this.state.isRecording && sent && words(text) === words(sent.text) ? '' : text;
  }

  /** Answers Claude's trust dialog with its "yes" option, the way its menu takes keys. */
  trustFolder() {
    const claude = this.claude;
    if (!claude || this.state.dialog !== 'trust') return;
    const rows = claude.screenRows().map((row) => row.text);
    const selected = rows.findIndex((text) => /^\s*❯/.test(text));
    const yes = rows.findIndex((text) => /\bYes\b.*\b(trust|proceed)/i.test(text));
    if (selected < 0 || yes < 0) return this.showTerminal();
    claude.write((yes > selected ? '\x1b[B' : '\x1b[A').repeat(Math.abs(yes - selected)));
    setTimeout(() => claude.write('\r'), 200);
    claude.clearScreen();
    this.setStatus('starting', null);
    this.track('Starting Claude');
  }

  // ---- hooks: what Claude does

  private async handleHook(event: string, payload: Record<string, unknown>): Promise<unknown> {
    this.claude?.clearScreen();
    clearTimeout(this.startTimer);
    switch (event) {
      case 'session':
        this.hasStarted = true;
        if (typeof payload.session_id === 'string' && payload.session_id !== this.sessionId) {
          this.sessionId = payload.session_id;
          this.touch();
        }
        if (typeof payload.model === 'string' && payload.model !== this.state.model) {
          this.state.model = payload.model;
          this.touch();
        }
        this.readyWhenListed();
        this.changed();
        return undefined;
      case 'prompt':
        return this.onPrompt(String(payload.prompt ?? ''));
      case 'tool':
        this.state.status = 'thinking';
        this.track(this.describeTool(String(payload.tool_name ?? ''), payload.tool_input));
        return undefined;
      case 'stop':
        await this.onStop(payload);
        return undefined;
      default:
        return undefined;
    }
  }

  /**
   * With no prompt on its command line, a session that started takes the person's prompts once
   * Claude Code has listed the stage's tools: it connects them after SessionStart, and a prompt sent
   * meanwhile would run without them. 10 s at most.
   */
  private readyWhenListed() {
    const isStarting = this.state.status === 'starting' || this.state.status === 'waiting';
    if (!this.hasStarted || this.autoPrompt || !isStarting) return;
    if (this.isListed) return this.setStatus('ready', null);
    this.track('Connecting the review tools');
    this.listTimer ??= setTimeout(() => {
      this.listTimer = undefined;
      this.listed();
    }, 10_000);
  }

  private listed() {
    this.isListed = true;
    clearTimeout(this.listTimer);
    this.listTimer = undefined;
    // The tools count once Claude has read the answer
    setTimeout(() => this.readyWhenListed(), 300);
  }

  private describeTool(name: string, input: unknown) {
    const label = TOOL_LABELS[name];
    return label
      ? label((input as Record<string, unknown>) ?? {})
      : name.replace(/^mcp__\w+__/, '');
  }

  private onPrompt(prompt: string) {
    const isDictated = this.isAwaitingDictation || this.state.isRecording;
    const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
    const isAuto = this.autoPrompt !== null && flat(prompt) === flat(this.autoPrompt);
    if (isAuto) this.autoPrompt = null;
    // The steps of preparing go on from those of starting
    else this.state.trail = [];
    this.isAwaitingDictation = false;
    this.state.isRecording = false;
    this.state.draft = '';
    this.player.stop();
    this.addMessage('user', prompt, { isDictated, isAuto });
    this.setStatus('thinking', null);
    this.track('Thinking');
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: this.context(true)
      }
    };
  }

  private async onStop(payload: Record<string, unknown>) {
    let reply =
      typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
    if (!reply.trim() && typeof payload.transcript_path === 'string')
      reply = await lastReplyIn(payload.transcript_path);
    this.setStatus(this.state.isRecording ? 'recording' : 'ready', null);
    if (!reply.trim()) return;
    const message = this.addMessage('claude', reply);
    this.pinPages(message);
    this.explain(message);
    // Never talk over the person while they dictate: the cues still move the editor
    const isSilent = !this.state.isSpeechOn || this.state.isRecording;
    this.player.play(message, 0, isSilent);
  }

  /**
   * A reply's page cues keep the full address of the page they mean (`/events` on the page open
   * now): each link works on its own, after a reload too; the chat shows only the path.
   */
  private pinPages(message: ChatMessage) {
    // The page open now, else the last one the chat linked to
    const base =
      this.browser?.page?.url ??
      this.state.messages
        .flatMap((one) => one.sentences.flatMap((sentence) => sentence.parts))
        .map((part) => (part.type === 'cue' && part.cue.kind === 'page' ? part.cue.path : ''))
        .filter((path) => /^https?:/.test(path))
        .at(-1) ??
      null;
    for (const part of message.sentences.flatMap((sentence) => sentence.parts)) {
      if (part.type !== 'cue' || part.cue.kind !== 'page') continue;
      try {
        part.cue.path = resolveUrl(part.cue.path, base);
      } catch {
        // No page open to go from: the cue stays as written
      }
    }
  }

  private addMessage(
    role: ChatMessage['role'],
    text: string,
    flags: { isDictated?: boolean; isAuto?: boolean } = {}
  ) {
    const message: ChatMessage = {
      id: `m${this.nextId++}`,
      role,
      at: Date.now(),
      text,
      sentences:
        role === 'claude' ? parseReply(text) : [{ parts: [{ type: 'text', text: text.trim() }] }],
      ...(flags.isDictated ? { isDictated: true } : {}),
      ...(flags.isAuto ? { isAuto: true } : {})
    };
    this.state.messages = [...this.state.messages, message];
    this.touch();
    return message;
  }

  private note(text: string) {
    this.addMessage('note', text);
  }

  /** The hunks a reply showed are explained, and part of this step. */
  private explain(message: ChatMessage) {
    const step = new Set(this.state.step);
    for (const cue of cuesOf(message.sentences)) {
      if (cue.kind !== 'show') continue;
      for (const id of hunksAt(this.state.files, this.state.hunks, cue.path, cue.start, cue.end)) {
        if (this.state.coverage[id] === 'ok') continue;
        this.state.coverage[id] = 'explained';
        step.add(id);
      }
    }
    this.state.step = [...step];
    this.touch();
  }

  // ---- what Claude is told with each prompt

  private context(isPrompt = false) {
    const { coverage, hunks, step, blocks } = this.state;
    const isTour = kindOf(this.state.pr) === 'tour';
    const ids = Object.keys(hunks);
    const count = (state: HunkState) =>
      ids.filter((id) => (coverage[id] ?? 'todo') === state).length;
    const lines = [
      `${isTour ? 'Stops' : 'Hunks'}: ${count('ok')} ok, ${count('explained')} explained, ${count('todo')} todo, of ${ids.length}.`
    ];
    if (isPrompt) lines.push(...this.pendingNotes.splice(0));
    if (step.length)
      lines.push(
        `This step (explained, not ok yet): ${step.map((id) => this.describeHunk(id)).join('; ')}.`
      );
    const next = this.nextHunks();
    if (next) lines.push(`Next in logical order: ${next}.`);
    if (this.loaded) {
      const focus = this.stage.describeFocus({ pr: this.loaded.info, files: this.state.files });
      if (focus) lines.push(`Editor: ${focus}.`);
      if (!this.loaded.info.isLive)
        lines.push('The working tree is not what is under review: read its files with pr_file.');
    }
    if (!blocks.length)
      lines.push(
        isTour
          ? 'No tour yet: set_tour once you know the flow.'
          : 'No map yet: set_map once the diff is read.'
      );
    const page = this.browser?.page;
    if (page) {
      const marks = this.browser!.currentMarks.map(
        (mark) => `${mark.id} “${mark.label}” on ${mark.target}`
      );
      lines.push(
        `Browser panel: ${page.title || 'untitled'} at ${page.url}${marks.length ? `; marks: ${marks.join(', ')}` : ''}.`
      );
    }
    return `<talkthrough>\n${lines.join('\n')}\n</talkthrough>`;
  }

  private describeHunk(id: string) {
    const hunk = this.state.hunks[id];
    return hunk ? `${id} ${hunk.path} L${hunk.start}-${hunk.end}` : id;
  }

  /** The first block with hunks still to explain, and those hunks. */
  private nextHunks() {
    const { coverage, step } = this.state;
    const isOpen = (id: string) => (coverage[id] ?? 'todo') === 'todo' && !step.includes(id);
    const blocks = this.state.blocks.length
      ? this.state.blocks
      : this.state.files.map((file) => ({
          id: file.path,
          title: file.path,
          why: '',
          hunks: file.hunks
        }));
    const index = blocks.findIndex((block) => block.hunks.some(isOpen));
    if (index < 0) return null;
    const block = blocks[index];
    const open = block.hunks.filter(isOpen);
    const listed = open
      .slice(0, 8)
      .map((id) => this.describeHunk(id))
      .join('; ');
    const more = open.length > 8 ? ` and ${open.length - 8} more` : '';
    return this.state.blocks.length
      ? `block ${index + 1} of ${blocks.length} “${block.title}”: ${listed}${more}`
      : `${listed}${more}`;
  }

  // ---- tools

  private async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.loaded) return { text: 'No review is running.', isError: true };
    switch (name) {
      case 'pr_overview':
        return { text: await this.overview() };
      case 'pr_search':
      case 'code_search':
        return {
          text: await searchAt(
            this.loaded.info.repo,
            this.loaded.info.headSha,
            String(args.pattern ?? ''),
            {
              paths: Array.isArray(args.paths) ? args.paths.map(String) : [],
              ignoreCase: args.ignoreCase === true
            }
          )
        };
      case 'pr_diff':
        return { text: this.diff(Array.isArray(args.paths) ? args.paths.map(String) : []) };
      case 'pr_file':
      case 'code_file':
        return this.file(String(args.path ?? ''), Number(args.start) || 1, Number(args.end) || 0);
      case 'set_map':
        return this.setMap(args as unknown as MapInput);
      case 'set_tour':
        return this.setTour(args as unknown as TourInput);
      case 'find_references':
        return {
          text: await this.stage.references(
            String(args.path ?? ''),
            Number(args.line) || 1,
            typeof args.symbol === 'string' ? args.symbol : null
          )
        };
      case 'mark_ok':
        return this.markOk(Array.isArray(args.hunks) ? args.hunks.map(String) : []);
      case 'review_state':
        return { text: this.context() };
      default:
        if (name.startsWith('browser_')) return this.callBrowser(name, args);
        return { text: `Unknown tool ${name}`, isError: true };
    }
  }

  private async overview() {
    const { info, body, authorNotes } = this.loaded!;
    const isOwn = info.kind === 'changes';
    // Staged or uncommitted changes are one snapshot: no commits worth listing
    const commits = isOwn && info.base === 'HEAD' ? [] : await commitsOf(info).catch(() => []);
    const files = this.state.files.map((file) => {
      const from = file.previousPath ? ` from ${file.previousPath}` : '';
      const hunks = file.hunks.map((id) => {
        const hunk = this.state.hunks[id];
        return `${id} L${hunk.start}-${hunk.end}`;
      });
      return `- ${file.path}${from} (${file.changeType.toLowerCase()}, +${file.additions} −${file.deletions}): ${hunks.join(', ')}`;
    });
    if (isOwn)
      return [
        `${info.title}: the person's own changes, not a pull request yet.`,
        `Working tree: ${info.isLive ? 'the same as what is under review' : 'has other changes too (read the staged files with pr_file)'}.`,
        ...(commits.length ? ['', `Commits (${commits.length}):`, ...commits] : []),
        '',
        `Files (${files.length}) and their hunks:`,
        ...files
      ].join('\n');
    return [
      `PR #${info.number}: ${info.title}`,
      `${info.author ? `Author: ${info.author} · ` : ''}${info.base} ← ${info.head} · checkout at the PR head: ${info.isLive ? 'yes' : 'no'}`,
      info.url ?? '',
      '',
      'Description:',
      body.trim().slice(0, 8000) || '(none)',
      ...(authorNotes ? ['', 'Author notes:', authorNotes.slice(0, 8000)] : []),
      '',
      `Commits (${commits.length}):`,
      ...commits,
      '',
      `Files (${files.length}) and their hunks:`,
      ...files
    ].join('\n');
  }

  private diff(paths: string[]) {
    const wanted = new Set(paths);
    const indexes = this.parsed
      .map((file, index) =>
        wanted.size === 0 || wanted.has(file.path) || wanted.has(file.oldPath) ? index : -1
      )
      .filter((index) => index >= 0);
    if (!indexes.length) return `None of these paths is in the PR: ${paths.join(', ')}`;
    const text = renderPatch(
      indexes.map((index) => this.parsed[index]),
      indexes.map((index) => this.state.files[index]),
      this.state.hunks
    );
    if (text.length <= MAX_DIFF) return text;
    return `${text.slice(0, MAX_DIFF)}\n… cut at ${MAX_DIFF} characters: ask for the rest by paths.`;
  }

  private async file(filePath: string, start: number, end: number): Promise<ToolResult> {
    const text = await fileAt(this.loaded!.info.repo, this.loaded!.info.headSha, filePath);
    if (!text) return { text: `${filePath} does not exist here.`, isError: true };
    const lines = text.split('\n');
    const last = Math.min(end > 0 ? end : lines.length, start + MAX_FILE_LINES - 1, lines.length);
    const numbered = lines
      .slice(start - 1, last)
      .map((line, at) => `${String(start + at).padStart(5)}  ${line}`);
    const more = last < lines.length ? `\n… ${lines.length - last} more lines` : '';
    return { text: numbered.join('\n') + more };
  }

  private setMap(map: MapInput): ToolResult {
    if (!Array.isArray(map.blocks)) return { text: 'blocks is required.', isError: true };
    const problems = mapProblems(map, Object.keys(this.state.hunks));
    if (problems.length)
      return { text: `The map was not set:\n${problems.join('\n')}`, isError: true };
    this.state.blocks = map.blocks.map((block, index) => ({
      id: `B${index + 1}`,
      title: block.title,
      why: block.why ?? '',
      hunks: block.hunks
    }));
    this.state.hotspots = (map.hotspots ?? []).map((hotspot, index) => ({
      id: `S${index + 1}`,
      title: hotspot.title,
      detail: hotspot.detail,
      anchors: hotspot.anchors ?? []
    }));
    this.touch();
    return {
      text: `Map set: ${this.state.blocks.length} blocks, ${this.state.hotspots.length} hotspots.`
    };
  }

  /** A tour's stops, checked against the code: each one a range of lines in a file there. */
  private async setTour(tour: TourInput): Promise<ToolResult> {
    if (!Array.isArray(tour.blocks)) return { text: 'blocks is required.', isError: true };
    const { repo, headSha } = this.loaded!.info;
    const paths = [
      ...new Set(
        tour.blocks.flatMap((block) =>
          (Array.isArray(block.stops) ? block.stops : []).map((stop) =>
            String(stop.path ?? '').replace(/^\.?\//, '')
          )
        )
      )
    ];
    const lengths = new Map<string, number>();
    for (const filePath of paths) {
      const text = await fileAt(repo, headSha, filePath);
      if (text) lengths.set(filePath, text.split('\n').length);
    }
    const map = tourMap(tour, (filePath) => lengths.get(filePath) ?? null);
    if (map.problems.length)
      return { text: `The tour was not set:\n${map.problems.join('\n')}`, isError: true };
    // Drawn again: a stop on the same lines keeps its state
    const kept = new Map(
      Object.values(this.state.hunks).map((hunk) => [hunk.key, this.state.coverage[hunk.id]])
    );
    const coverage: Record<string, HunkState> = {};
    for (const hunk of Object.values(map.hunks)) coverage[hunk.id] = kept.get(hunk.key) ?? 'todo';
    Object.assign(this.state, {
      files: map.files,
      hunks: map.hunks,
      coverage,
      step: [],
      blocks: map.blocks,
      hotspots: (tour.hotspots ?? []).map((hotspot, index) => ({
        id: `S${index + 1}`,
        title: hotspot.title,
        detail: hotspot.detail,
        anchors: hotspot.anchors ?? []
      }))
    });
    this.touch();
    const count = Object.keys(map.hunks).length;
    return {
      text: `Tour set: ${map.blocks.length} blocks, ${count} stops (T1 to T${count}), ${this.state.hotspots.length} hotspots.`
    };
  }

  private markOk(ids: string[]): ToolResult {
    const known = ids.filter((id) => this.state.hunks[id]);
    for (const id of known) this.state.coverage[id] = 'ok';
    this.state.step = this.state.step.filter((id) => !known.includes(id));
    this.touch();
    void this.syncViewed();
    const unknown = ids.filter((id) => !this.state.hunks[id]);
    return {
      text: `${known.length} marked ok.${unknown.length ? ` Unknown: ${unknown.join(', ')}.` : ''}`
    };
  }

  // ---- memory

  /** Every hunk's state: as kept, and ok for the files already Viewed on GitHub. */
  private withViewed(kept: Record<string, HunkState>) {
    const coverage: Record<string, HunkState> = {};
    for (const id of Object.keys(this.state.hunks)) coverage[id] = kept[id] ?? 'todo';
    if (!config().get<boolean>('syncViewed', true)) return coverage;
    for (const file of this.state.files)
      if (this.loaded!.viewedPaths.includes(file.path)) {
        this.viewed.add(file.path);
        file.hunks.forEach((id) => (coverage[id] = 'ok'));
      }
    return coverage;
  }

  /** Files whose hunks are all ok become Viewed on GitHub. */
  private async syncViewed() {
    const at = this.loaded?.github;
    const prId = this.loaded?.prId;
    if (!at || !prId || !config().get<boolean>('syncViewed', true)) return;
    const done = this.state.files
      .filter((file) => !this.viewed.has(file.path))
      .filter((file) => file.hunks.every((id) => this.state.coverage[id] === 'ok'))
      .map((file) => file.path);
    if (!done.length) return;
    done.forEach((file) => this.viewed.add(file));
    try {
      await markViewed(at, prId, done);
    } catch (error) {
      done.forEach((file) => this.viewed.delete(file));
      this.note(`Could not mark as Viewed on GitHub: ${(error as Error).message}`);
    }
  }

  // ---- what the person does

  /** Input waits while Claude prepares: there is nothing to talk about before the map. */
  private isWaitingForMap() {
    if (!isPreparing(this.state)) return false;
    vscode.window.setStatusBarMessage('Talkthrough: Claude is still preparing the review.', 3000);
    return true;
  }

  send(text: string) {
    if (!text.trim() || this.isWaitingForMap()) return;
    if (!this.claude) return this.note('No Claude session is running: resume the review first.');
    this.player.stop();
    this.claude.submit(text);
  }

  toggleMic() {
    const claude = this.claude;
    // Talk again while Claude Code turns the last dictation into text would start another one
    if (this.isWaitingForMap() || this.isAwaitingDictation) return;
    if (!claude) return this.note('No Claude session is running: resume the review first.');
    this.player.stop();
    claude.toggleDictation(!this.state.isRecording);
    if (this.state.isRecording) {
      this.state.isRecording = false;
      this.isAwaitingDictation = true;
      this.setStatus('thinking', null);
      this.track('Transcribing');
      this.sendShortDictation();
    } else {
      this.state.isRecording = true;
      this.setStatus('recording', 'Listening');
    }
  }

  cancelMic() {
    const claude = this.claude;
    if (!claude || (!this.state.isRecording && !this.isAwaitingDictation)) return;
    claude.cancelDictation();
    clearTimeout(this.dictationTimer);
    this.state.isRecording = false;
    this.isAwaitingDictation = false;
    this.state.draft = '';
    this.setStatus('ready', null);
  }

  /**
   * Claude Code sends a dictation by itself only from three words on: a shorter one ("Fatto.") stays
   * in its prompt. Once the transcript is in and holds still, Enter sends it; with nothing heard in
   * 30 s, the chat is free again.
   */
  private sendShortDictation(started = Date.now(), last = '') {
    clearTimeout(this.dictationTimer);
    this.dictationTimer = setTimeout(() => {
      const claude = this.claude;
      if (!claude || !this.isAwaitingDictation) return;
      const text = claude.promptText();
      const isTranscribing = claude.isTranscribing();
      if (text && text === last && !isTranscribing) return claude.write('\r');
      if (!text && !isTranscribing && Date.now() - started > 30_000) {
        this.isAwaitingDictation = false;
        this.state.draft = '';
        this.note('Nothing was heard.');
        return this.setStatus('ready', null);
      }
      this.sendShortDictation(started, text);
    }, 700);
  }

  /** The diffs explained in this step are clear: they become ok, and Claude goes on. */
  next() {
    if (this.isWaitingForMap()) return;
    const ids = this.state.step.filter((id) => this.state.coverage[id] !== 'ok');
    ids.forEach((id) => (this.state.coverage[id] = 'ok'));
    this.state.step = [];
    this.pendingNotes.push(
      ids.length
        ? `The person pressed Next: ${ids.join(', ')} are now ok. Go on with the next block.`
        : 'The person pressed Next: go on with the next block.'
    );
    this.touch();
    void this.syncViewed();
    this.send(NEXT);
  }

  interrupt() {
    this.player.stop();
    if (!this.claude) return;
    this.claude.interrupt();
    this.isAwaitingDictation = false;
    this.state.isRecording = false;
    // An interrupted turn ends with no Stop hook: the chat says so itself
    if (this.state.status === 'thinking' || this.state.status === 'recording') {
      this.note('Interrupted.');
      this.setStatus('ready', null);
    }
  }

  /** Files counted as Viewed on GitHub: what a restart would unmark. */
  get viewedCount() {
    return this.viewed.size;
  }

  /** Every hunk back to todo and, with syncViewed, Viewed taken back on GitHub. */
  async reset() {
    if (!this.loaded) return;
    for (const id of Object.keys(this.state.hunks)) this.state.coverage[id] = 'todo';
    this.state.step = [];
    this.pendingNotes.push(
      'The person started the review over: every hunk is todo again. Start from the first block when asked.'
    );
    const files = [...this.viewed];
    this.viewed.clear();
    this.note('Started over: every hunk is to review again.');
    const { github: at, prId } = this.loaded;
    if (!at || !prId || !files.length || !config().get<boolean>('syncViewed', true)) return;
    try {
      await markViewed(at, prId, files, false);
    } catch (error) {
      this.note(`Could not unmark the Viewed files on GitHub: ${(error as Error).message}`);
    }
  }

  play(messageId: string, sentence: number) {
    const message = this.state.messages.find((one) => one.id === messageId);
    // With the voice off, a sentence clicked only replays its cues
    if (message?.role === 'claude') this.player.play(message, sentence, !this.state.isSpeechOn);
  }

  pauseResume() {
    if (this.state.player.isPlaying || this.state.isSpeechOn) this.player.toggle();
  }

  seek(delta: number) {
    this.player.seek(delta);
  }

  replayLast() {
    const last = [...this.state.messages].reverse().find((message) => message.role === 'claude');
    if (last) this.player.play(last, 0, !this.state.isSpeechOn);
  }

  stopSpeech() {
    this.player.stop();
  }

  setSpeech(isOn: boolean) {
    this.state.isSpeechOn = isOn;
    if (!isOn) this.player.stop();
    this.changed();
  }

  /** A cue: the editor's, or the browser panel's (page, mark). */
  async runCue(cue: Cue) {
    if (cue.kind !== 'page' && cue.kind !== 'mark') return this.stage.run(cue);
    // Paused, or after a reload: the browser comes back for a link clicked in the chat
    const browser = this.browser ?? (await this.browserReady());
    if (!browser) return;
    if (cue.kind === 'page') await browser.open(cue.path);
    else {
      const { kind, label } = markOf(cue.symbol ?? '');
      await browser.mark(cue.path, label, kind);
    }
    this.panel.show();
  }

  async showHunk(id: string) {
    const hunk = this.state.hunks[id];
    if (hunk)
      await this.stage.run({
        kind: 'show',
        path: hunk.path,
        start: hunk.start,
        end: hunk.end,
        symbol: null
      });
  }

  /** Marks hunks by hand: from the map, one hunk or a whole block, file or folder. */
  setHunks(ids: string[], state: HunkState) {
    const known = ids.filter((id) => this.state.hunks[id]);
    if (!known.length) return;
    known.forEach((id) => (this.state.coverage[id] = state));
    if (state === 'ok') this.state.step = this.state.step.filter((id) => !known.includes(id));
    this.touch();
    if (state === 'ok') void this.syncViewed();
  }

  showTerminal() {
    if (!this.claude) return this.note('No Claude session is running.');
    this.mirror.show(this.claude, `Claude · PR #${this.state.pr?.number ?? ''}`);
  }

  toggleTerminal() {
    if (!this.claude) return this.note('No Claude session is running.');
    this.mirror.toggle(this.claude, `Claude · PR #${this.state.pr?.number ?? ''}`);
  }

  // ---- the app in the browser panel

  /**
   * The repository's browser, when talkthrough.browser.enabled is on and agent-browser answers:
   * one session and profile per repository, so sign-ins stay between reviews.
   */
  private browserBin() {
    return browserBin(this.ctx.extensionPath, config().get<string>('browser.path', ''));
  }

  private async browserReady() {
    const key = this.review?.commonDir ?? this.loaded?.info.repo ?? 'default';
    if (!config().get<boolean>('browser.enabled', true)) {
      this.browser = null;
      return this.syncBrowser();
    }
    if (this.browser?.key !== key) {
      const browser = new Browser(
        {
          bin: this.browserBin(),
          key,
          storage: path.join(this.ctx.globalStorageUri.fsPath, 'browser')
        },
        () => this.syncBrowser()
      );
      this.browser = (await browser.version()) ? browser : null;
    }
    this.syncBrowser();
    return this.browser;
  }

  /** The panel's state in the review's, for the side bar. */
  private syncBrowser() {
    const browser = this.browser;
    this.state.browser = browser
      ? {
          isShown: this.panel.isShown,
          page: browser.page,
          marks: browser.currentMarks.map(({ id, label, kind }) => ({ id, label, kind }))
        }
      : null;
    this.panel.update();
    this.changed();
    return null;
  }

  async toggleBrowser() {
    if (!(await this.browserReady()))
      return this.note('The browser panel needs agent-browser: see the start screen.');
    this.panel.toggle();
  }

  private async callBrowser(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const browser = this.browser;
    if (!browser) return { text: 'The browser panel is off.', isError: true };
    const text = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value : undefined;
    const describe = async () => {
      const page = browser.page;
      return `${page?.title || 'untitled'} at ${page?.url ?? 'no page'}\n\n${await browser.snapshot()}`;
    };
    switch (name) {
      case 'browser_open':
        await browser.open(String(args.url ?? ''));
        this.panel.show();
        return { text: await describe() };
      case 'browser_snapshot':
        return {
          text: await browser.snapshot({ all: args.all === true, selector: text(args.selector) })
        };
      case 'browser_act':
        await browser.act(String(args.action ?? ''), text(args.target), text(args.value));
        return { text: await describe() };
      case 'browser_look':
        return {
          text: `${browser.page?.title || 'untitled'} at ${browser.page?.url ?? 'no page'}`,
          image: { data: await browser.screenshot(args.full === true), mimeType: 'image/jpeg' }
        };
      case 'browser_eval':
        return {
          text: JSON.stringify(await browser.evaluate(String(args.script ?? ''))) ?? 'undefined'
        };
      case 'browser_mark': {
        if (args.clear === true) {
          await browser.clearMarks();
          return { text: 'Marks cleared.' };
        }
        const target = text(args.target);
        if (!target)
          return { text: 'A target is needed: an @ref or a CSS selector.', isError: true };
        const kind = (
          ['change', 'action', 'note'].includes(String(args.kind)) ? args.kind : 'change'
        ) as MarkKind;
        const mark = await browser.mark(target, String(args.label ?? ''), kind);
        this.panel.show();
        return { text: `Mark ${mark.id} on ${mark.target}.` };
      }
      default:
        return { text: `Unknown tool ${name}`, isError: true };
    }
  }

  // ---- new commits on the PR

  /** Whether the PR moved past the head under review: the panel then offers to update. */
  async checkHead() {
    const review = this.review;
    const loaded = this.loaded;
    if (!review || !loaded || this.isCheckingHead) return;
    if (['idle', 'starting', 'error'].includes(this.state.status)) return;
    this.isCheckingHead = true;
    this.lastHeadCheck = Date.now();
    try {
      const { input } = review;
      // A tour stays on the code it was drawn on
      if (input.kind === 'tour') return;
      const sha =
        input.kind === 'changes'
          ? await changesHead(loaded.info.repo, input.scope)
          : await currentHead(loaded, input.kind === 'local' ? input.head : '');
      if (this.loaded !== loaded || sha === this.state.newHead?.sha) return;
      if (sha === loaded.info.headSha) {
        if (this.state.newHead) ((this.state.newHead = null), this.changed());
        return;
      }
      const commits = input.kind === 'changes' ? null : await commitsSince(loaded, sha);
      if (this.loaded !== loaded) return;
      this.state.newHead = { sha, commits };
      this.changed();
    } catch {
      // Offline, or gh signed out: the next check tries again
    } finally {
      this.isCheckingHead = false;
    }
  }

  /**
   * The review on the PR's new head: hunks whose change is the same keep their state and block, the
   * new or changed ones gather in a block of their own. Answers what Claude is told about it.
   */
  private moveTo(loaded: LoadedPr, parsed: ParsedFile[], commits: number | null) {
    const from = this.loaded!.info.headSha;
    const hasMap = this.state.blocks.length > 0;
    const { files, hunks } = indexPatch(parsed);
    const { coverage, blocks, step, changed } = carryOver(this.state, hunks);
    this.loaded = loaded;
    this.parsed = parsed;
    // GitHub drops a file's Viewed mark when it changes: the marks come again with the PR
    this.viewed.clear();
    Object.assign(this.state, { pr: loaded.info, files, hunks, step, blocks, newHead: null });
    this.state.coverage = this.withViewed(coverage);
    const isOwn = kindOf(loaded.info) === 'changes';
    const what = isOwn
      ? 'Your changes moved'
      : commits === null
        ? 'The PR was rewritten'
        : `${commits} new commit${commits === 1 ? '' : 's'}`;
    this.note(
      changed.length
        ? `${what}: ${changed.length} new or changed hunk${changed.length === 1 ? '' : 's'}, in “${DELTA_TITLE}”. The others kept their state.`
        : `${what}: no hunk changed.`
    );
    return updatePrompt({
      commits,
      from,
      to: loaded.info.headSha,
      changed: changed.map((id) => this.describeHunk(id)),
      hasMap,
      isOwn
    });
  }

  /**
   * Brings the review to the PR's new head, in the same Claude session: told what moved, it explains
   * only that. A stopped session goes on with --resume, which does the same as it reopens.
   */
  async update() {
    await this.ready;
    const claude = this.claude;
    if (!this.review || !this.loaded) return;
    if (!claude) return this.resume();
    if (this.state.status !== 'ready') {
      vscode.window.setStatusBarMessage("Talkthrough: update once Claude's turn ends.", 3000);
      return;
    }
    this.setStatus('thinking', null);
    this.track('Checking the pull request');
    try {
      const loaded = await load(this.review.input, this.loaded.info.repo);
      const parsed = parsePatch(await prDiff(loaded.info));
      if (this.claude !== claude) return;
      if (loaded.info.headSha === this.loaded.info.headSha) {
        this.state.newHead = null;
        return this.setStatus('ready', null);
      }
      const commits = await commitsSince(this.loaded, loaded.info.headSha).catch(() => null);
      const prompt = this.moveTo(loaded, parsed, commits);
      this.touch();
      this.autoPrompt = prompt;
      claude.submit(prompt);
    } catch (error) {
      this.setStatus('ready', null);
      this.note(`Could not update the review: ${(error as Error).message}`);
    }
  }

  async checkRequirements() {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      const browser = config().get<boolean>('browser.enabled', true) ? this.browserBin() : null;
      this.state.requirements = await checkRequirements(await resolveClaude(), browser);
      this.changed();
    } finally {
      this.isChecking = false;
    }
  }

  // ---- the checkout at the PR head

  /** A worktree at the PR head, opened in a new window that goes on with the review. */
  async openWorktree() {
    if (!this.review || !this.loaded || kindOf(this.loaded.info) !== 'pr') return;
    const folder = await reviewWorktree(this.loaded, this.review.commonDir);
    await this.ctx.globalState.update(HANDOFF_KEY, {
      folder,
      id: this.review.id,
      at: Date.now()
    } satisfies Handoff);
    this.note(`The review goes on in the window of its worktree, ${folder}.`);
    await this.end();
    await this.flush();
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), {
      forceNewWindow: true
    });
  }

  /** Checks the PR out here (after asking): diffs then open on the real files. */
  async checkoutPr() {
    if (!this.loaded || kindOf(this.loaded.info) !== 'pr') return;
    if (!(await checkoutHere(this.loaded, () => this.openWorktree()))) return;
    const pr = this.loaded.info;
    pr.isLive = await isAtCommit(pr.repo, pr.headSha);
    this.state.pr = { ...pr };
    if (!pr.isLive)
      return this.note(
        'The checkout moved, but not to the PR head: diffs stay on read-only copies.'
      );
    this.pendingNotes.push('The checkout is now at the PR head: Read and Grep see the PR files.');
    this.note(`Checked out PR #${pr.number}: diffs open on your files, with live errors.`);
  }
}

/**
 * The CLI to run: the setting when it is a path, else the one on the editor's PATH, else the
 * native installer's `~/.local/bin/claude` (an editor started from the Dock may not have it on PATH).
 */
async function resolveClaude() {
  const configured = config().get<string>('claudePath', 'claude') || 'claude';
  if (configured.includes('/')) return configured;
  const found = (await run('which', [configured], { allowFailure: true })).stdout.trim();
  const installed = path.join(homedir(), '.local', 'bin', 'claude');
  return found || (existsSync(installed) ? installed : configured);
}

/** The repository of the active file, else of the first workspace folder. */
export async function findRepo() {
  const active = vscode.window.activeTextEditor?.document.uri;
  const folder =
    (active?.scheme === 'file' ? vscode.workspace.getWorkspaceFolder(active) : undefined) ??
    vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('Open the repository of the pull request first.');
  return git(folder.uri.fsPath, 'rev-parse', '--show-toplevel');
}
