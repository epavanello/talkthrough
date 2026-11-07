/**
 * The app under review, in a browser Claude drives and the person watches: agent-browser (Vercel's
 * browser CLI for agents) running Chrome headless, one session per repository with a profile of its
 * own, so sign-ins stay and nothing touches the person's everyday browser. Downloads and uploads are
 * denied by policy, and page text comes wrapped as untrusted content. vscode-free.
 */
import { createHash } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { run } from './proc';

/** What a mark says: a part the PR changed, something to do there, or a remark. */
export type MarkKind = 'change' | 'action' | 'note';

export interface Mark {
  id: string;
  target: string;
  label: string;
  kind: MarkKind;
  /**
   * A CSS selector for the element, found as the mark is drawn: an @ref holds only until the next
   * snapshot (the page changes, the browser restarts), this holds as long as the page is the same.
   */
  selector?: string;
}

/** The page, as the panel and Claude's context show it. */
export interface PageInfo {
  url: string;
  title: string;
}

interface Answer<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const COLORS: Record<MarkKind, string> = { change: '#2f81f7', action: '#1a7f37', note: '#bf8700' };

/**
 * The agent-browser to run: `configured` (talkthrough.browser.path) when set, else the binary this
 * platform's .vsix carries in `bin/`, else agent-browser on the PATH.
 */
export function browserBin(extensionPath: string, configured = '') {
  if (configured.trim()) return configured.trim();
  const isWindows = process.platform === 'win32';
  const bundled = path.join(
    extensionPath,
    'bin',
    isWindows ? 'agent-browser.exe' : 'agent-browser'
  );
  if (!existsSync(bundled)) return 'agent-browser';
  try {
    if (!isWindows) accessSync(bundled, constants.X_OK);
  } catch {
    // Unpacked without its file mode; if this fails too, version() reports it as not installed
    try {
      chmodSync(bundled, 0o755);
    } catch {}
  }
  return bundled;
}

/** A mark cue's label, with its kind in front when given: `action: Click here`. */
export function markOf(text: string): { kind: MarkKind; label: string } {
  const match = text.match(/^(change|action|note):\s*(.*)$/i);
  return match
    ? { kind: match[1].toLowerCase() as MarkKind, label: match[2] }
    : { kind: 'change', label: text };
}

/** A command the stream reports, as the panel says it: `click @e3`, `open /events/42`. */
export function describeCommand(message: { action?: string; params?: Record<string, unknown> }) {
  const params = message.params ?? {};
  const target = params.url ?? params.selector ?? params.key ?? params.text ?? '';
  return `${message.action ?? 'command'}${target ? ` ${String(target).slice(0, 80)}` : ''}`;
}

/** Commands the panel's own plumbing sends: not worth showing as activity. */
export const QUIET = new Set([
  'stream_status',
  'stream_enable',
  'get_url',
  'get_title',
  'url',
  'title',
  'viewport',
  'launch'
]);

/** A relative URL (`/events/42`) on the current page's origin; absolute ones as they are. */
export function resolveUrl(url: string, current: string | null) {
  const value = url.trim();
  // localhost:5173 would read as a scheme: a host first
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(value)) return `http://${value}`;
  if (/^[a-z][\w+.-]*:/i.test(value)) return value;
  if (!current || !/^https?:/.test(current)) throw new Error(`Not a full URL: ${url}`);
  return new URL(value, current).toString();
}

/**
 * The script that draws a mark: a labelled box around a part of the page, in document coordinates
 * so it scrolls with it (kept within the page's width: it never makes the page scroll), on a layer
 * that never takes clicks. It follows the element under it as the page moves, hides while that is
 * hidden, and goes once it leaves the page (a client-side route change, a closed dialog). The label goes in as text, never HTML. Chrome places it with CSS anchor
 * positioning: above the box, else below, on the side with the most room, inside the viewport.
 */
export function markScript(
  mark: Mark,
  box: { x: number; y: number; width: number; height: number },
  number: number
) {
  const spec = JSON.stringify({ ...mark, ...box, number, color: COLORS[mark.kind] });
  return `(() => {
  const m = ${spec};
  const layerId = '__talkthrough_marks';
  let layer = document.getElementById(layerId);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = layerId;
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    const style = document.createElement('style');
    style.textContent = '@keyframes __talkthrough_pulse{0%{box-shadow:0 0 0 0 var(--c)}100%{box-shadow:0 0 0 14px transparent}}';
    layer.appendChild(style);
    document.documentElement.appendChild(layer);
  }
  layer.querySelector('[data-mark="' + m.id + '"]')?.remove();
  // A box in document coordinates around a part of the viewport, within the page's width
  const place = (mark, box) => {
    const pageWidth = Math.max(document.documentElement.clientWidth, document.documentElement.scrollWidth);
    const left = Math.max(0, box.x + scrollX - 4), top = Math.max(0, box.y + scrollY - 4);
    const size = { left, top, width: Math.min(box.x + scrollX + box.width + 4, pageWidth) - left, height: box.height + 8 };
    for (const [name, value] of Object.entries(size))
      if (mark.style[name] !== value + 'px') mark.style[name] = value + 'px';
  };
  // The element under the box: the mark follows it as the page moves, and goes when it goes
  let target = document.elementFromPoint(m.x + m.width / 2, m.y + m.height / 2);
  for (let node = target; node && node !== document.documentElement; node = node.parentElement) {
    const r = node.getBoundingClientRect();
    if (Math.abs(r.x - m.x) + Math.abs(r.y - m.y) + Math.abs(r.width - m.width) + Math.abs(r.height - m.height) < 4) {
      target = node;
      break;
    }
  }
  const el = document.createElement('div');
  el.dataset.mark = m.id;
  el.style.cssText = 'position:absolute;box-sizing:border-box;border-radius:6px;border:2px ' + (m.kind === 'change' ? 'dashed' : 'solid') + ' ' + m.color + ';background:' + m.color + '14;--c:' + m.color + '88;anchor-name:--talkthrough-' + m.id;
  place(el, m);
  if (target) {
    const r = target.getBoundingClientRect();
    el.__talkthrough = { target, dx: m.x - r.x, dy: m.y - r.y, dw: m.width - r.width, dh: m.height - r.height };
  }
  if (!layer.__talkthroughTimer)
    layer.__talkthroughTimer = setInterval(() => {
      const marks = layer.querySelectorAll('[data-mark]');
      if (!layer.isConnected || !marks.length) {
        clearInterval(layer.__talkthroughTimer);
        layer.__talkthroughTimer = 0;
        return;
      }
      for (const mark of marks) {
        const follow = mark.__talkthrough;
        if (!follow) continue;
        if (!follow.target.isConnected) {
          mark.remove();
          continue;
        }
        const r = follow.target.getBoundingClientRect();
        const isShown = r.width > 0 || r.height > 0;
        mark.style.display = isShown ? '' : 'none';
        if (isShown) place(mark, { x: r.x + follow.dx, y: r.y + follow.dy, width: r.width + follow.dw, height: r.height + follow.dh });
      }
    }, 300);
  if (m.kind === 'action') el.style.animation = '__talkthrough_pulse 1.4s ease-out infinite';
  const tag = document.createElement('div');
  tag.textContent = m.number + '  ' + m.label;
  const isAnchored = CSS.supports('position-area', 'top') && CSS.supports('position-try-order', 'most-width');
  tag.style.cssText = (isAnchored
    ? 'position:fixed;position-anchor:--talkthrough-' + m.id + ';position-area:top span-right;position-try-fallbacks:flip-inline,flip-block,flip-block flip-inline;position-try-order:most-width;margin:4px 0;box-sizing:border-box;max-width:min(420px,100%)'
    : 'position:absolute;left:-2px;' + (m.y < 34 ? 'top:calc(100% + 4px)' : 'bottom:calc(100% + 4px)') + ';max-width:420px') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 8px;border-radius:4px;font:600 12px/1.5 system-ui,sans-serif;color:#fff;background:' + m.color + ';box-shadow:0 1px 3px #0004';
  el.appendChild(tag);
  layer.appendChild(el);
  // The element as a selector that outlives the snapshot: an id, else a path of nth-of-type steps
  // from the nearest one (no spaces: it goes back into a cue)
  if (!target) return null;
  const isOnly = (selector, element) => {
    try {
      const all = document.querySelectorAll(selector);
      return all.length === 1 && all[0] === element;
    } catch {
      return false;
    }
  };
  const steps = [];
  for (let node = target; node && node.nodeType === 1; node = node.parentElement) {
    if (node.id && /^[A-Za-z][\\w-]*$/.test(node.id) && !/^L\\d/.test(node.id) && isOnly('#' + node.id, node)) {
      steps.unshift('#' + node.id);
      break;
    }
    if (node === document.documentElement) {
      steps.unshift('html');
      break;
    }
    let index = 1;
    for (let other = node.previousElementSibling; other; other = other.previousElementSibling)
      if (other.localName === node.localName) index++;
    steps.unshift(node.localName + ':nth-of-type(' + index + ')');
  }
  const selector = steps.join('>');
  return /^\\S+$/.test(selector) && isOnly(selector, target) ? selector : null;
})()`;
}

const CLEAR_MARKS = `(() => { document.getElementById('__talkthrough_marks')?.remove(); return true; })()`;
const scrollToMark = (id: string) =>
  `(() => { const el = document.querySelector('[data-mark=${JSON.stringify(id)}]'); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return Boolean(el); })()`;

export interface BrowserOptions {
  /** The agent-browser CLI. */
  bin: string;
  /** A key for the repository: one browser session and profile each. */
  key: string;
  /** Where profiles, the policy and screenshots go. */
  storage: string;
}

export class Browser {
  readonly session: string;
  readonly key: string;
  private readonly profile: string;
  private readonly policy: string;
  private isPrepared = false;
  private marks: Mark[] = [];
  page: PageInfo | null = null;

  constructor(
    private readonly options: BrowserOptions,
    private readonly onChange: () => void = () => {}
  ) {
    this.key = options.key;
    const hash = createHash('sha1').update(options.key).digest('hex').slice(0, 12);
    this.session = `review-${hash}`;
    this.profile = path.join(options.storage, 'profiles', hash);
    this.policy = path.join(options.storage, 'policy.json');
  }

  get currentMarks() {
    return this.marks;
  }

  /** The CLI's version, or null when it isn't installed. */
  async version() {
    const result = await run(this.options.bin, ['--version'], { allowFailure: true }).catch(
      () => null
    );
    return result?.code === 0 ? result.stdout.trim().replace(/^agent-browser\s+/, '') : null;
  }

  private async prepare() {
    if (this.isPrepared) return;
    await mkdir(this.profile, { recursive: true });
    await writeFile(
      this.policy,
      JSON.stringify({ default: 'allow', deny: ['download', 'upload'] })
    );
    this.isPrepared = true;
  }

  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      AGENT_BROWSER_NAMESPACE: 'talkthrough',
      AGENT_BROWSER_SESSION: this.session,
      AGENT_BROWSER_PROFILE: this.profile,
      AGENT_BROWSER_ACTION_POLICY: this.policy,
      AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
      AGENT_BROWSER_MAX_OUTPUT: '30000',
      AGENT_BROWSER_IDLE_TIMEOUT: '2h',
      // Sharp frames: the live view's come at Chrome's own pixel ratio (an emulated one doesn't
      // change them), and the stream would cap them at the viewport's CSS width
      AGENT_BROWSER_ARGS: [process.env.AGENT_BROWSER_ARGS, '--force-device-scale-factor=2']
        .filter(Boolean)
        .join('\n'),
      AGENT_BROWSER_STREAM_MAX_WIDTH: '4096',
      AGENT_BROWSER_STREAM_MAX_HEIGHT: '4096',
      AGENT_BROWSER_STREAM_QUALITY: '85',
      ...(existsSync(CHROME) && !process.env.AGENT_BROWSER_EXECUTABLE_PATH
        ? { AGENT_BROWSER_EXECUTABLE_PATH: CHROME }
        : {})
    };
  }

  /** One agent-browser command, its JSON answer's data. */
  async command<T = Record<string, unknown>>(args: string[]): Promise<T> {
    await this.prepare();
    const { stdout, stderr } = await run(this.options.bin, [...args, '--json'], {
      env: this.env(),
      allowFailure: true
    });
    const line = stdout
      .trim()
      .split('\n')
      .reverse()
      .find((text) => text.startsWith('{'));
    let answer: Answer<T>;
    try {
      answer = JSON.parse(line ?? '') as Answer<T>;
    } catch {
      throw new Error(
        (stderr || stdout).trim().split('\n').pop() || `agent-browser ${args[0]} failed`
      );
    }
    if (!answer.success) throw new Error(answer.error ?? `agent-browser ${args[0]} failed`);
    return answer.data as T;
  }

  /** Reads the current page's address and title. */
  async refresh() {
    try {
      const [url, title] = await Promise.all([
        this.command<{ url: string }>(['get', 'url']),
        this.command<{ title: string }>(['get', 'title'])
      ]);
      this.page = { url: url.url, title: title.title };
    } catch {
      this.page = null;
    }
    await this.syncMarks();
    this.onChange();
    // A client-side route swaps the page's elements a moment later
    if (this.marks.length)
      setTimeout(() => void this.syncMarks().then(() => this.onChange()), 1000);
    return this.page;
  }

  /** The marks the page still shows: one goes with its element, all go with the page. */
  private async syncMarks() {
    if (!this.marks.length) return;
    const ids = await this.evaluate(
      `[...document.querySelectorAll('#__talkthrough_marks [data-mark]')].filter((el) => !el.__talkthrough || el.__talkthrough.target.isConnected).map((el) => el.dataset.mark)`
    ).catch(() => null);
    if (Array.isArray(ids)) this.marks = this.marks.filter((mark) => ids.includes(mark.id));
  }

  /** Opens a page; the one already open stays as it is, marks included (a cue played again). */
  async open(url: string) {
    const target = resolveUrl(url, this.page?.url ?? null);
    if (this.page && target === this.page.url) return this.page;
    let page: PageInfo;
    try {
      page = await this.command<PageInfo>(['open', target]);
    } catch (error) {
      const message = (error as Error).message;
      if (
        /ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/i.test(message)
      )
        throw new Error(
          `Nothing answers at ${target}: check the port in the repository's dev setup (its dev script, framework config, .env), and if it is right, the app's server is not running. Ask the person to start it.`
        );
      throw error;
    }
    this.marks = [];
    this.page = { url: page.url, title: page.title };
    this.onChange();
    return this.page;
  }

  /** The page's elements with refs (@e1) for actions and marks; `all` for the whole tree. */
  async snapshot(options: { all?: boolean; selector?: string } = {}) {
    const args = ['snapshot', ...(options.all ? [] : ['-i']), '-c'];
    if (options.selector) args.push('-s', options.selector);
    const data = await this.command<{ snapshot: string; origin?: string }>(args);
    return data.snapshot;
  }

  /** click, fill, type, press, select, hover, check, uncheck, scroll, back, forward, reload, wait. */
  async act(action: string, target?: string, value?: string) {
    const needsTarget = [
      'click',
      'dblclick',
      'fill',
      'type',
      'select',
      'hover',
      'check',
      'uncheck',
      'focus'
    ];
    if (needsTarget.includes(action) && !target)
      throw new Error(`${action} needs a target (@ref or selector).`);
    const args: Record<string, string[]> = {
      press: ['press', value ?? target ?? ''],
      scroll: ['scroll', ...(value ?? 'down').split(/\s+/)],
      back: ['back'],
      forward: ['forward'],
      reload: ['reload'],
      wait: ['wait', target ?? value ?? '1000']
    };
    await this.command(
      args[action] ?? [action, target ?? '', ...(value !== undefined ? [value] : [])]
    );
    return this.refresh();
  }

  /** The page as an image Claude can look at. */
  async screenshot(full = false) {
    const file = path.join(this.options.storage, `shot-${Date.now()}.jpg`);
    await this.command([
      'screenshot',
      file,
      ...(full ? ['--full'] : []),
      '--screenshot-format',
      'jpeg',
      '--screenshot-quality',
      '70'
    ]);
    try {
      return (await readFile(file)).toString('base64');
    } finally {
      await rm(file, { force: true });
    }
  }

  async evaluate(script: string) {
    const data = await this.command<{ result?: unknown }>(['eval', script]);
    return data.result;
  }

  /** Draws a mark on an element (`@e5` or a CSS selector), scrolled into view. */
  async mark(target: string, label: string, kind: MarkKind = 'change') {
    await this.command(['scrollintoview', target]).catch(() => {});
    const box = await this.command<{ x: number; y: number; width: number; height: number }>([
      'get',
      'box',
      target
    ]);
    // The same element again: by its @ref, or by the selector a replay has in its place
    const existing = this.marks.findIndex(
      (one) => one.target === target || one.selector === target
    );
    const id = existing >= 0 ? this.marks[existing].id : `m${this.marks.length + 1}`;
    const mark: Mark = { id, target, label, kind };
    if (existing >= 0) this.marks[existing] = mark;
    else this.marks.push(mark);
    const selector = await this.evaluate(markScript(mark, box, this.marks.indexOf(mark) + 1));
    if (typeof selector === 'string') mark.selector = selector;
    this.onChange();
    return mark;
  }

  async clearMarks() {
    this.marks = [];
    await this.evaluate(CLEAR_MARKS).catch(() => {});
    this.onChange();
  }

  async showMark(id: string) {
    await this.evaluate(scrollToMark(id));
  }

  /** The port of the session's live stream (frames out, input in). */
  async streamPort() {
    const data = await this.command<{ enabled: boolean; port: number | null }>([
      'stream',
      'status'
    ]);
    if (data.enabled && data.port) return data.port;
    const enabled = await this.command<{ port: number }>(['stream', 'enable']);
    return enabled.port;
  }

  /** The viewport, to fit the panel. */
  /** The viewport, in CSS pixels; `scale` is the panel's pixel ratio (2 on a Retina display). */
  async resize(width: number, height: number, scale = 1) {
    const ratio = Math.min(Math.max(Math.round(scale * 100) / 100, 1), 3);
    await this.command([
      'set',
      'viewport',
      String(Math.round(width)),
      String(Math.round(height)),
      String(ratio)
    ]);
  }

  /** What is selected on the page: in the focused field, or the page's text. */
  async selectedText() {
    const text = await this.evaluate(`(() => {
      const field = document.activeElement;
      if (field && typeof field.selectionStart === 'number' && typeof field.value === 'string')
        return field.value.slice(field.selectionStart, field.selectionEnd);
      return String(getSelection() ?? '');
    })()`);
    return typeof text === 'string' ? text : '';
  }

  /** Select all, undo, redo, or delete the selection (a cut, once copied): the page's own editing. */
  async execCommand(command: 'selectAll' | 'undo' | 'redo' | 'delete') {
    await this.evaluate(`document.execCommand(${JSON.stringify(command)})`);
  }

  async insertText(text: string) {
    await this.command(['keyboard', 'inserttext', text]);
  }

  async close() {
    if (!this.isPrepared) return;
    await this.command(['close']).catch(() => {});
    this.page = null;
    this.marks = [];
  }
}
