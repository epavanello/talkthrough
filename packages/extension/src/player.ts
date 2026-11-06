/**
 * Reads Claude's replies aloud a sentence at a time, firing each cue where it stands, so the editor
 * changes as the voice gets there. Pause, resume, previous or next sentence, replay. vscode-free.
 */
import { spawn } from 'node:child_process';
import type { ChatMessage, Cue, PlayerState } from '@talkthrough/shared';
import { speakable } from './cues';

export interface Speaker {
  /** Resolves once the words are said, or as soon as `signal` aborts. */
  speak(text: string, signal: AbortSignal): Promise<void>;
}

/** macOS `say`, the text on stdin (so nothing in it reads as an option). */
export class SaySpeaker implements Speaker {
  constructor(private readonly options: () => { voice: string; rate: number }) {}

  speak(text: string, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const { voice, rate } = this.options();
      const args = ['-r', String(rate), ...(voice ? ['-v', voice] : [])];
      const child = spawn('say', args);
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

export class Player {
  private controller: AbortController | null = null;
  private message: ChatMessage | null = null;
  /** The last play only fired cues (voice off): resume and seek do the same. */
  private isSilent = false;
  state: PlayerState = { messageId: null, sentence: 0, isPlaying: false };

  constructor(
    private readonly speaker: Speaker,
    private readonly runCue: (cue: Cue) => Promise<void>,
    private readonly onChange: () => void
  ) {}

  /** Reads `message` from sentence `from`; `isSilent` only fires its cues. */
  play(message: ChatMessage, from = 0, isSilent = false) {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.message = message;
    this.isSilent = isSilent;
    void this.read(
      message,
      Math.max(0, Math.min(from, message.sentences.length - 1)),
      controller,
      isSilent
    );
  }

  private async read(
    message: ChatMessage,
    from: number,
    controller: AbortController,
    isSilent: boolean
  ) {
    const { signal } = controller;
    for (let index = from; index < message.sentences.length; index++) {
      if (signal.aborted) return;
      this.set({ messageId: message.id, sentence: index, isPlaying: !isSilent });
      for (const part of message.sentences[index].parts) {
        if (signal.aborted) return;
        if (part.type === 'cue') await this.runCue(part.cue).catch(() => {});
        else if (part.type === 'text' && !isSilent) {
          const words = speakable(part.text);
          if (words) await this.speaker.speak(words, signal);
        }
      }
    }
    if (signal.aborted) return;
    this.controller = null;
    this.set({ messageId: message.id, sentence: message.sentences.length - 1, isPlaying: false });
  }

  pause() {
    if (!this.state.isPlaying) return;
    this.controller?.abort();
    this.controller = null;
    this.set({ ...this.state, isPlaying: false });
  }

  /** Starts the current sentence again. */
  resume() {
    if (this.message) this.play(this.message, this.state.sentence, this.isSilent);
  }

  toggle() {
    if (this.state.isPlaying) this.pause();
    else this.resume();
  }

  seek(delta: number) {
    if (this.message) this.play(this.message, this.state.sentence + delta, this.isSilent);
  }

  stop() {
    this.controller?.abort();
    this.controller = null;
    if (this.state.isPlaying) this.set({ ...this.state, isPlaying: false });
  }

  private set(state: PlayerState) {
    this.state = state;
    this.onChange();
  }
}
