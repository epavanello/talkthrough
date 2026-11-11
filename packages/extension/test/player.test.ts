import type { ChatMessage } from '@talkthrough/shared';
import { describe, expect, it } from 'vitest';
import { Player, type Speaker } from '../src/player';

/** Says a word every 20 ms, reporting each one; remembers what it was asked to say. */
class FakeSpeaker implements Speaker {
  said: string[] = [];

  speak(text: string, signal: AbortSignal, onWord?: (offset: number) => void) {
    this.said.push(text);
    const offsets = [...text.matchAll(/\S+/g)].map((match) => match.index);
    return new Promise<void>((resolve) => {
      let next = 0;
      const timer = setInterval(() => {
        if (next < offsets.length) return onWord?.(offsets[next++]);
        clearInterval(timer);
        resolve();
      }, 20);
      signal.addEventListener('abort', () => (clearInterval(timer), resolve()), { once: true });
    });
  }
}

const message: ChatMessage = {
  id: 'm1',
  role: 'claude',
  at: 0,
  text: '',
  sentences: [
    { parts: [{ type: 'text', text: 'Uno due tre quattro cinque sei.' }] },
    { parts: [{ type: 'text', text: 'Sette otto.' }] }
  ]
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check: () => boolean) => {
  for (let tries = 0; !check() && tries < 100; tries++) await wait(10);
  expect(check()).toBe(true);
};

function setup() {
  const speaker = new FakeSpeaker();
  const player = new Player(
    speaker,
    async () => {},
    () => {}
  );
  return { speaker, player };
}

describe('Player', () => {
  it('GIVEN a sentence half read WHEN paused and resumed THEN it goes on from the word before, its progress held', async () => {
    const { speaker, player } = setup();
    player.play(message);
    await until(() => player.state.progress > 0.5);

    player.pause();
    const held = player.state.progress;
    await wait(60);

    expect(player.state).toMatchObject({ sentence: 0, isPlaying: false, progress: held });
    player.resume();
    await until(() => speaker.said.length === 2);
    expect(speaker.said[1]).toMatch(/^(due|tre|quattro) /);
    expect(message.sentences[0].parts[0]).toMatchObject({
      text: expect.stringContaining(speaker.said[1])
    });
    player.stop();
  });

  it('GIVEN the voice inside a sentence WHEN back THEN it starts that sentence again; at its start, the previous one', async () => {
    const { speaker, player } = setup();
    player.play(message, 1);
    await until(() => player.state.progress > 0);

    player.seek(-1);
    await until(() => speaker.said.length === 2);
    expect(player.state.sentence).toBe(1);
    expect(speaker.said[1]).toBe('Sette otto.');

    player.seek(-1);
    await until(() => speaker.said.length === 3);
    expect(player.state.sentence).toBe(0);
    player.stop();
  });

  it('GIVEN a reply WHEN read to its end THEN the last sentence is full', async () => {
    const { player } = setup();
    player.play(message, 1);

    await until(() => !player.state.isPlaying && player.state.progress === 1);
    expect(player.state.sentence).toBe(1);
  });
});
