/**
 * Reads Claude's replies aloud a sentence at a time, firing each cue where it stands, so the editor
 * changes as the voice gets there. Pause and resume where it was, previous or next sentence, replay.
 * vscode-free.
 */
import { spawn } from 'node:child_process';
import type { ChatMessage, Cue, PlayerState, Sentence } from '@talkthrough/shared';
import { codeRefs, speakable } from './cues';

export interface Speaker {
  /**
   * Resolves once the words are said, or as soon as `signal` aborts. `onWord` gets the offset in
   * `text` of each word as the voice says it.
   */
  speak(text: string, signal: AbortSignal, onWord?: (offset: number) => void): Promise<void>;
}

/** A short system sound: a reply came while the window was away (macOS; elsewhere, nothing). */
export function ping() {
  if (process.platform !== 'darwin') return;
  spawn('afplay', ['/System/Library/Sounds/Ping.aiff'], { stdio: 'ignore' }).on('error', () => {});
}

/** The words `say -i` highlights (reverse video), as it says them. */
const SAID = /\x1b\[7m([^\x1b]*)\x1b/g;

/**
 * macOS `say`, the text on stdin (so nothing in it reads as an option). `-i` highlights each word as
 * it is said, even on a pipe: that is where the voice is.
 */
export class SaySpeaker implements Speaker {
  constructor(private readonly options: () => { voice: string; rate: number }) {}

  speak(text: string, signal: AbortSignal, onWord?: (offset: number) => void) {
    return new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const { voice, rate } = this.options();
      const args = ['-i', '-r', String(rate), ...(voice ? ['-v', voice] : [])];
      // -i draws for a terminal, and refuses to without TERM
      const child = spawn('say', args, { env: { ...process.env, TERM: 'xterm-256color' } });
      let output = '';
      let cursor = 0;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data: string) => {
        output += data;
        let end = 0;
        for (const match of output.matchAll(SAID)) {
          end = match.index + match[0].length;
          const at = text.indexOf(match[1], cursor);
          if (!match[1] || at < 0) continue;
          cursor = at + match[1].length;
          onWord?.(at);
        }
        output = output.slice(end);
      });
      const stop = () => child.kill('SIGTERM');
      signal.addEventListener('abort', stop, { once: true });
      const done = () => {
        signal.removeEventListener('abort', stop);
        resolve();
      };
      child.on('close', done);
      child.on('error', done);
      child.stdin.on('error', () => {});
      child.stdin.end(text);
    });
  }
}

/**
 * A sentence as the voice says it: its words in one piece (one `say`, so a cue in the middle doesn't
 * break the sentence's intonation), and each cue at the offset in them where it stands. A path in
 * code that is a file of the repository (`paths`) opens beside as the voice says it, as a cue would.
 */
function spokenOf(sentence: Sentence, paths: string[] = []) {
  let text = '';
  const cues: { cue: Cue; at: number }[] = [];
  for (const part of sentence.parts) {
    if (part.type === 'cue') cues.push({ cue: part.cue, at: text.length });
    else if (part.type === 'text') {
      const words = speakable(part.text);
      if (!words) continue;
      const start = text ? text.length + 1 : 0;
      for (const ref of codeRefs(part.text)) {
        if (!paths.includes(ref.path)) continue;
        const before = speakable(part.text.slice(0, ref.index));
        const cue: Cue = {
          kind: 'open',
          path: ref.path,
          start: ref.line,
          end: ref.line,
          symbol: null
        };
        cues.push({
          cue,
          at: Math.min(start + before.length + (before ? 1 : 0), start + words.length)
        });
      }
      text += (text ? ' ' : '') + words;
    }
  }
  return { text, cues };
}

/** How far `offset` is through the sentence's spoken words, 0 to 1. */
function progressAt(sentence: Sentence, offset: number) {
  const { text } = spokenOf(sentence);
  return text.length ? Math.min(1, offset / text.length) : 0;
}

/** The word before the one at `offset`: a resume starts there, so no word is cut in half. */
function wordBefore(words: string, offset: number) {
  const before = words.slice(0, offset).trimEnd();
  return Math.max(0, before.search(/\S+$/));
}

export class Player {
  private controller: AbortController | null = null;
  private message: ChatMessage | null = null;
  /** The last play only fired cues (voice off): resume and seek do the same. */
  private isSilent = false;
  /** Where the voice is in the current sentence's spoken words; a pause keeps it. */
  private place = 0;
  /** How far `place` is through the sentence, 0 to 1. */
  private progress = 0;
  /** Replies that came while the voice was saying another: each is read once the one before ends. */
  private queue: { message: ChatMessage; isSilent: boolean }[] = [];
  state: PlayerState = {
    messageId: null,
    sentence: 0,
    isPlaying: false,
    progress: 0,
    isWaiting: false,
    isSentenceBySentence: false
  };

  /**
   * `onChange`: the state changed (a sentence, play or pause). `onProgress`: the voice moved on a
   * word, many times a second: kept apart so a word doesn't send the whole review state.
   */
  constructor(
    private readonly speaker: Speaker,
    private readonly runCue: (cue: Cue) => Promise<void>,
    private readonly onChange: () => void,
    private readonly onProgress: (progress: number) => void = () => {}
  ) {}

  /** Reads `message` from sentence `from` (at `place` in it); `isSilent` only fires its cues. */
  play(message: ChatMessage, from = 0, isSilent = false, place = 0) {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.message = message;
    this.isSilent = isSilent;
    void this.read(
      message,
      Math.max(0, Math.min(from, message.sentences.length - 1)),
      controller,
      isSilent,
      place
    );
  }

  /**
   * A new reply: read now, or, while the voice is saying another, once it ends, so Next never cuts
   * the voice short.
   */
  enqueue(message: ChatMessage, isSilent = false) {
    if (this.state.isPlaying && !isSilent) this.queue.push({ message, isSilent });
    else this.play(message, 0, isSilent);
  }

  private async read(
    message: ChatMessage,
    from: number,
    controller: AbortController,
    isSilent: boolean,
    start: number
  ) {
    const { signal } = controller;
    for (let index = from; index < message.sentences.length; index++) {
      if (signal.aborted) return;
      const sentence = message.sentences[index];
      const { text, cues } = spokenOf(sentence, message.paths);
      const first = index === from ? start : 0;
      this.place = first;
      this.progress = progressAt(sentence, first);
      this.set({
        messageId: message.id,
        sentence: index,
        isPlaying: !isSilent,
        progress: this.progress,
        // Until the first word of this play
        isWaiting: !isSilent && (index === from || this.state.isWaiting),
        isSentenceBySentence: this.state.isSentenceBySentence
      });
      // A resume goes on from its place: the cues before it already fired
      const pending = cues.filter((one) => one.at >= first);
      // In order, one after the other; a cue inside the sentence doesn't hold the voice
      let chain = Promise.resolve();
      const fire = (upTo: number) => {
        while (pending.length && pending[0].at <= upTo) {
          const { cue } = pending.shift()!;
          chain = chain.then(() => (signal.aborted ? undefined : this.runCue(cue).catch(() => {})));
        }
        return chain;
      };
      const rest = text.slice(first);
      if (isSilent || !rest.trim()) await fire(Infinity);
      else {
        // The cues before the first word open the sentence: the editor changes, then the voice
        await fire(first + rest.search(/\S/));
        if (signal.aborted) return;
        await this.speaker.speak(rest, signal, (said) => {
          if (signal.aborted) return;
          this.place = first + said;
          this.progress = progressAt(sentence, this.place);
          if (this.state.isWaiting) this.set({ ...this.state, isWaiting: false });
          this.onProgress(this.progress);
          void fire(this.place);
        });
        if (signal.aborted) return;
        await fire(Infinity);
      }
      if (signal.aborted) return;
      // One sentence at a time: ready at the next one, which Play reads
      if (this.state.isSentenceBySentence && !isSilent && index < message.sentences.length - 1) {
        this.controller = null;
        this.place = 0;
        this.progress = 0;
        this.set({
          ...this.state,
          sentence: index + 1,
          isPlaying: false,
          progress: 0,
          isWaiting: false
        });
        return;
      }
    }
    if (signal.aborted) return;
    this.controller = null;
    this.place = 0;
    this.progress = 1;
    this.set({
      ...this.state,
      messageId: message.id,
      sentence: message.sentences.length - 1,
      isPlaying: false,
      progress: 1,
      isWaiting: false
    });
    const next = this.queue.shift();
    if (next) this.play(next.message, 0, next.isSilent);
  }

  /** Stops the voice where it is: resume goes on from there. */
  pause() {
    if (!this.state.isPlaying) return;
    this.controller?.abort();
    this.controller = null;
    this.set({
      ...this.state,
      isPlaying: false,
      isWaiting: false,
      progress: this.progress
    });
  }

  /**
   * Goes on from the word before the one a pause stopped at. Once the whole reply was read, it reads
   * it again from the start.
   */
  resume() {
    if (!this.message) return;
    const sentence = this.message.sentences[this.state.sentence];
    if (!sentence || this.progress >= 1) return this.play(this.message, 0, this.isSilent);
    const place = wordBefore(spokenOf(sentence).text, this.place);
    this.play(this.message, this.state.sentence, this.isSilent, place);
  }

  toggle() {
    if (this.state.isPlaying) this.pause();
    else this.resume();
  }

  /** Next or previous sentence; back from inside a sentence first goes to its start. */
  seek(delta: number) {
    if (!this.message) return;
    const isInside = this.progress > 0 && this.progress < 1;
    const to = delta < 0 && isInside ? this.state.sentence : this.state.sentence + delta;
    if (to < 0 || to >= this.message.sentences.length) return;
    this.play(this.message, to, this.isSilent);
  }

  /** The voice stops once the sentence it is saying ends, ready at the next one. */
  setSentenceBySentence(isOn: boolean) {
    if (this.state.isSentenceBySentence !== isOn)
      this.set({ ...this.state, isSentenceBySentence: isOn });
  }

  /** Stops the voice and drops the replies waiting for it. */
  stop() {
    this.queue = [];
    this.controller?.abort();
    this.controller = null;
    if (this.state.isPlaying)
      this.set({
        ...this.state,
        isPlaying: false,
        isWaiting: false,
        progress: this.progress
      });
  }

  private set(state: PlayerState) {
    this.state = state;
    this.onChange();
  }
}
