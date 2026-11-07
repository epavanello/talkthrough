/**
 * The review's Claude Code session: the installed `claude` CLI (your own sign-in), interactive, in a
 * pseudo-terminal the extension types into. That is what lets the chat's microphone reuse Claude's
 * own dictation: in tap mode, Space starts recording and Space again stops and sends. What Claude
 * says comes back through hooks (see server.ts), not by reading the screen. vscode-free.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as headless from '@xterm/headless';

// A CommonJS bundle: its classes sit on the default export once bundled for Node
const { Terminal } = ((headless as { default?: typeof headless }).default ??
  headless) as typeof headless;
type HeadlessTerminal = InstanceType<typeof Terminal>;

export interface LaunchOptions {
  port: number;
  token: string;
  /** Claude Code's `language` setting: replies and dictation. */
  language: string;
  model: string;
  /** Claude Code's effort level for this session ('' for its default). */
  effort: string;
  systemPrompt: string;
  /** The session's display name, in Claude Code's and the desktop app's session lists. */
  name: string;
  /** A new session's id (`--session-id`), or the one to go on with (`resume`). */
  sessionId: string;
  /** Goes on with `sessionId` (`--resume`): its conversation, Claude's memory of the review. */
  resume?: boolean;
  /** A prompt sent as the session starts: the kickoff, or what changed while it was closed. */
  prompt?: string;
  /** Plugins turned off in this session (a voice plugin would read the replies a second time). */
  disabledPlugins: string[];
}

/** The hook events the extension listens to, by the path they post to. */
export const HOOKS = {
  SessionStart: 'session',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'tool',
  Stop: 'stop'
} as const;

/**
 * Read-only review: what the session may use without asking (dontAsk denies the rest). No shell:
 * the PR is someone else's text, and a git flag can write files or run a pager. The stage's tools
 * search and read the PR head; Grep and Glob are for CLIs that still have them.
 */
const ALLOWED_TOOLS = ['mcp__talkthrough', 'Read', 'Grep', 'Glob'];

/** The hook command: posts the hook's input to the extension; curl prints the answer back. */
const hookCommand = (path: string) =>
  `curl -sS --max-time 15 -H "Authorization: Bearer $TALKTHROUGH_TOKEN" ` +
  `-H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:$TALKTHROUGH_PORT/hook/${path}"`;

export function claudeArgs(options: LaunchOptions) {
  const settings = {
    language: options.language,
    voice: { enabled: true, mode: 'tap' },
    enabledPlugins: Object.fromEntries(options.disabledPlugins.map((plugin) => [plugin, false])),
    hooks: Object.fromEntries(
      Object.entries(HOOKS).map(([event, path]) => [
        event,
        [{ hooks: [{ type: 'command', command: hookCommand(path) }] }]
      ])
    ),
    permissions: { allow: ALLOWED_TOOLS, deny: ['Edit', 'Write', 'NotebookEdit'] }
  };
  const mcp = {
    mcpServers: {
      talkthrough: {
        type: 'http',
        url: `http://127.0.0.1:${options.port}/mcp`,
        headers: { Authorization: `Bearer ${options.token}` }
      }
    }
  };
  return [
    '--settings',
    JSON.stringify(settings),
    '--mcp-config',
    JSON.stringify(mcp),
    '--strict-mcp-config',
    '--permission-mode',
    'dontAsk',
    '--append-system-prompt',
    options.systemPrompt,
    '--name',
    options.name,
    ...(options.model ? ['--model', options.model] : []),
    ...(options.effort ? ['--effort', options.effort] : []),
    ...(options.resume ? ['--resume', options.sessionId] : ['--session-id', options.sessionId]),
    ...(options.prompt ? [options.prompt] : [])
  ];
}

/**
 * The prompt's text on a screen: the row that starts with ❯ in the input box (between two rules),
 * and the rows it wraps onto. Dim hints in an empty prompt ("Try …", "Listening") are not text.
 */
export function promptIn(rows: { text: string; isDim: boolean }[]) {
  const isRule = (text: string) => /^\s*─{8,}/.test(text);
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (!/^\s*❯/.test(row.text) || !isRule(rows[index - 1]?.text ?? '')) continue;
    if (row.isDim && /^\s*❯\s*(Try "|Listening)/.test(row.text)) return '';
    const lines = [row.text.replace(/^\s*❯\s?/, '')];
    for (let next = index + 1; next < rows.length && !isRule(rows[next].text); next++)
      lines.push(rows[next].text);
    return lines
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

/** Whether dictation is still being turned into text: the footer, below the input box, says so. */
export function isTranscribingIn(rows: { text: string }[]) {
  let end = rows.length - 1;
  while (end >= 0 && !/^\s*─{8,}/.test(rows[end].text)) end--;
  return rows.slice(end + 1).some((row) => /Voice: processing/.test(row.text));
}

const ANSI =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[=>()][0-9A-Za-z]?|\x1b./g;
/** Cursor moves Claude Code draws spaces and line breaks with: `No\x1b[4Gconversation`. */
const SIDEWAYS = /\x1b\[\d*[CG]/g;
const DOWN = /\x1b\[\d*(?:;\d*)?[ABEFHf]/g;

/** Output as plain text: cursor moves become the spaces and line breaks they stand for. */
export const plain = (data: string) =>
  data.replace(SIDEWAYS, ' ').replace(DOWN, '\n').replace(ANSI, '').replace(/\r/g, '\n');
/** Output kept for the mirror terminal and for reading the screen, at most. */
const KEEP = 256 * 1024;
const SCREEN_KEEP = 8 * 1024;

/** One interactive `claude`, through ptybridge.py. */
export class ClaudeProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  /** Settles once the bridge, and with it Claude, is gone. */
  private exited: Promise<void> = Promise.resolve();
  private readonly outputListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(code: number | null) => void>();
  /** Claude's screen as a terminal would draw it: what the prompt holds is read from it. */
  private terminal: HeadlessTerminal = new Terminal({
    cols: 120,
    rows: 40,
    allowProposedApi: true
  });
  /** Raw output, for a mirror terminal opened later. */
  output = '';
  /** Output as plain text, to notice dialogs and dictation results. */
  screen = '';

  constructor(
    private readonly bridge: string,
    private readonly python = 'python3'
  ) {}

  /** The emulated screen's rows: their text, and whether their first word (after a ❯) is dim. */
  screenRows() {
    const buffer = this.terminal.buffer.active;
    return Array.from({ length: this.terminal.rows }, (_, y) => {
      const line = buffer.getLine(buffer.viewportY + y);
      const text = line?.translateToString(true) ?? '';
      const marker = text.indexOf('❯');
      const from = marker >= 0 ? marker + 1 : 0;
      const offset = text.slice(from).search(/\S/);
      const first = offset < 0 ? -1 : from + offset;
      return { text, isDim: first >= 0 && Boolean(line?.getCell(first)?.isDim()) };
    });
  }

  /** What is typed or dictated in Claude's prompt now ('' when empty or showing its placeholder). */
  promptText() {
    return promptIn(this.screenRows());
  }

  isTranscribing() {
    return isTranscribingIn(this.screenRows());
  }

  start(command: string[], cwd: string, env: NodeJS.ProcessEnv, cols = 120, rows = 40) {
    const child = spawn(this.python, [this.bridge, String(cols), String(rows), '--', ...command], {
      cwd,
      env
    });
    this.child = child;
    this.exited = new Promise((resolve) => child.once('close', () => resolve()));
    this.terminal.dispose();
    this.terminal = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 0 });
    const take = (data: string) => {
      this.terminal.write(data);
      this.output = (this.output + data).slice(-KEEP);
      this.screen = (this.screen + plain(data)).slice(-SCREEN_KEEP);
      this.outputListeners.forEach((listener) => listener(data));
    };
    child.stdout.setEncoding('utf8').on('data', take);
    child.stderr.setEncoding('utf8').on('data', take);
    child.stdin.on('error', () => {});
    const exit = (code: number | null) => {
      if (this.child !== child) return;
      this.child = null;
      this.exitListeners.forEach((listener) => listener(code));
    };
    child.on('exit', exit);
    child.on('error', (error) => {
      take(`\r\n${error.message}\r\n`);
      exit(null);
    });
  }

  write(data: string) {
    this.child?.stdin.write(data);
  }

  /** Ctrl+U: empties Claude's prompt. */
  clearInput() {
    this.write('\x15');
  }

  /** Types `text` into an empty prompt and sends it. */
  submit(text: string) {
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return;
    this.clearInput();
    // Several lines go in as one paste, so their line breaks don't send early
    setTimeout(() => this.write(clean.includes('\n') ? `\x1b[200~${clean}\x1b[201~` : clean), 40);
    setTimeout(() => this.write('\r'), 120);
  }

  /**
   * Space, in tap mode: starts dictation, or stops it and sends what was said (from three words on:
   * a shorter transcript stays in the prompt). It starts only on an empty prompt (elsewhere it is a
   * space), so starting empties it first.
   */
  toggleDictation(isStarting: boolean) {
    if (!isStarting) return this.write(' ');
    this.clearInput();
    setTimeout(() => this.write(' '), 60);
  }

  /** Esc while dictating: Claude Code drops the recording and puts the prompt back as it was. */
  cancelDictation() {
    this.write('\x1b');
    setTimeout(() => this.clearInput(), 300);
  }

  /** Esc: stops Claude's turn. */
  interrupt() {
    this.write('\x1b');
    // An interrupted turn puts its prompt back in the input: the next message would join it
    setTimeout(() => this.clearInput(), 400);
  }

  resize(cols: number, rows: number) {
    this.terminal.resize(cols, rows);
    this.write(`\x1b]777;resize;${cols};${rows}\x07`);
  }

  /** Forgets what the screen showed so far, after it has been read. */
  clearScreen() {
    this.screen = '';
  }

  onOutput(listener: (data: string) => void) {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onExit(listener: (code: number | null) => void) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /** Hangs Claude up (the bridge kills whatever lingers); settles once it is gone, 5 s at most. */
  dispose() {
    this.child?.kill('SIGTERM');
    this.child = null;
    return Promise.race([
      this.exited,
      new Promise<void>((resolve) => setTimeout(resolve, 5000).unref())
    ]);
  }
}
