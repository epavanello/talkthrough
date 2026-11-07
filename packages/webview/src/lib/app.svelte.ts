import {
  EMPTY_STATE,
  SHORTCUTS,
  isPreparing,
  type HunkState,
  type PullFilter,
  type ReviewState
} from '@talkthrough/shared';
import { host, onHostEvent, vscode } from './rpc';

/** How the map lists the hunks: blocks in logical order, a folder tree, or a flat list of files. */
export type MapView = 'flow' | 'tree' | 'list';

/** What the webview keeps across reloads (`vscode.setState`). */
interface Saved {
  mapView?: MapView;
  pullFilter?: PullFilter;
}

/** The review as the host last sent it, plus what only the webview cares about. */
class App {
  state = $state<ReviewState>(EMPTY_STATE);
  isMapOpen = $state(true);
  #saved = $state<Saved>(vscode.getState<Saved>() ?? {});

  constructor() {
    onHostEvent((event) => {
      if (event.event === 'state') this.state = event.state;
    });
    // The browser panel mounts the same bundle: it has no review state to ask for
    if (document.body.dataset.view !== 'browser')
      void host.getState().then((state) => (this.state = state));
  }

  #remember(fields: Saved) {
    this.#saved = { ...this.#saved, ...fields };
    vscode.setState(this.#saved);
  }

  get mapView() {
    return this.#saved.mapView ?? 'flow';
  }

  set mapView(view: MapView) {
    this.#remember({ mapView: view });
  }

  /** The start screen's list of pull requests. */
  get pullFilter() {
    return this.#saved.pullFilter ?? 'review';
  }

  set pullFilter(filter: PullFilter) {
    this.#remember({ pullFilter: filter });
  }

  /** Claude runs, or is starting. */
  get isRunning() {
    return ['starting', 'waiting', 'ready', 'thinking', 'recording'].includes(this.state.status);
  }

  /** Claude studies the PR: no map yet, input waits. */
  get isPreparing() {
    return isPreparing(this.state);
  }

  /** Whether typing, talking and Next reach Claude now. */
  get canTalk() {
    return ['ready', 'thinking', 'recording'].includes(this.state.status) && !this.isPreparing;
  }

  stateOf(id: string): HunkState {
    return this.state.coverage[id] ?? 'todo';
  }

  /** A group of hunks as one: ok when all are, explained when any was talked about. */
  groupState(ids: string[]): HunkState {
    if (ids.length && ids.every((id) => this.stateOf(id) === 'ok')) return 'ok';
    return ids.some((id) => this.stateOf(id) !== 'todo') ? 'explained' : 'todo';
  }

  get counts() {
    const ids = Object.keys(this.state.hunks);
    return {
      total: ids.length,
      ok: ids.filter((id) => this.stateOf(id) === 'ok').length,
      explained: ids.filter((id) => this.stateOf(id) === 'explained').length
    };
  }
}

export const app = new App();

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const MAC_KEYS: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' };
const NAMES: Record<string, string> = { right: '→', left: '←', space: 'Space', enter: 'Enter' };

/** A keybinding as this platform writes it: `ctrl+alt+space` is ⌃⌥Space on a Mac. */
export function keyLabel(key: string) {
  const parts = key
    .split('+')
    .map((part) => NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part));
  if (IS_MAC) return parts.map((part) => MAC_KEYS[part] ?? part).join('');
  return parts.map((part) => part[0].toUpperCase() + part.slice(1)).join('+');
}

/** A shortcut's key on this platform. */
export const keyOf = (shortcut: (typeof SHORTCUTS)[number]) =>
  (IS_MAC && shortcut.mac) || shortcut.key;

/** The key of a command's shortcut, as this platform writes it. */
export function shortcutOf(command: string) {
  const shortcut = SHORTCUTS.find((one) => one.command === command);
  return shortcut ? keyLabel(keyOf(shortcut)) : '';
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000]
];

/** `3 hr. ago`, `yesterday`, `now`. */
export function ago(at: number, now = Date.now()) {
  for (const [unit, size] of UNITS) {
    const count = Math.round((at - now) / size);
    if (count <= -1) return RELATIVE.format(count, unit);
  }
  return 'now';
}

/** `943`, `#943` or a pull request URL: something to start a review of right away. */
export const isPrRef = (text: string) =>
  /^#?\d+$/.test(text.trim()) || /github\.[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(text);
