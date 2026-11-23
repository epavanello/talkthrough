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
  const seen = { changes: 0, progress: 0, cues: [] as string[] };
  const player = new Player(
    speaker,
    async (cue) => void seen.cues.push(`${cue.kind} ${cue.path}:${cue.start}`),
    () => seen.changes++,
    (progress) => (seen.progress = progress)
  );
  return { speaker, player, seen };
}

describe('Player', () => {
  it('GIVEN a reply naming files in code WHEN read THEN the real ones open as the voice says them', async () => {
    const { speaker, player, seen } = setup();
    const reply: ChatMessage = {
      ...message,
      paths: ['infra/services.ts'],
      sentences: [
        {
          parts: [
            {
              type: 'text',
              text: 'Uno due tre quattro cinque sei sette otto `infra/services.ts:250` nove `process.env` dieci.'
            }
          ]
        }
      ]
    };
    const opened: number[] = [];
    player.play(reply);
    await until(() => {
      if (seen.cues.length && !opened.length) opened.push(seen.progress);
      return !player.state.isPlaying && speaker.said.length === 1;
    });
    expect(seen.cues).toEqual(['open infra/services.ts:250']);
    expect(opened[0]).toBeGreaterThan(0.5);
  });

  it('GIVEN the voice reading a reply WHEN another comes THEN it is read once the first ends; stop drops it', async () => {
    const { speaker, player } = setup();
    const second: ChatMessage = {
      ...message,
      id: 'm2',
      sentences: [{ parts: [{ type: 'text', text: 'Nove dieci.' }] }]
    };
    player.play(message);
    await until(() => speaker.said.length === 1);

    player.enqueue(second);
    expect(player.state).toMatchObject({ messageId: 'm1', isPlaying: true });
    await until(() => player.state.messageId === 'm2');
    expect(speaker.said).toEqual(['Uno due tre quattro cinque sei.', 'Sette otto.', 'Nove dieci.']);
    await until(() => !player.state.isPlaying);

    player.play(message);
    player.enqueue(second);
    player.stop();
    await wait(300);
    expect(player.state.messageId).toBe('m1');
  });

  it('GIVEN the voice quiet WHEN a reply comes THEN it is read at once', async () => {
    const { speaker, player } = setup();
    player.enqueue(message);
    await until(() => speaker.said.length === 1);
    expect(player.state).toMatchObject({ messageId: 'm1', isPlaying: true });
    player.stop();
  });

  it('GIVEN a sentence half read WHEN paused and resumed THEN it goes on from the word before, its progress held', async () => {
    const { speaker, player, seen } = setup();
    player.play(message);
    await until(() => seen.progress > 0.5);

    player.pause();
    const held = seen.progress;
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
    const { speaker, player, seen } = setup();
    player.play(message, 1);
    await until(() => seen.progress > 0);

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

  it('GIVEN a play WHEN the voice starts and goes on THEN it waits until the first word, and words move only the progress', async () => {
    const { player, seen } = setup();
    player.play(message);

    expect(player.state).toMatchObject({ isPlaying: true, isWaiting: true });
    await until(() => !player.state.isWaiting);
    const changes = seen.changes;
    await until(() => seen.progress > 0.5);
    expect(seen.changes, 'no state change for a word').toBe(changes);
    player.stop();
  });

  it('GIVEN one sentence at a time WHEN played THEN each play says one sentence and waits at the next, until turned off', async () => {
    const { speaker, player } = setup();
    player.setSentenceBySentence(true);
    player.play(message);

    await until(() => speaker.said.length === 1 && !player.state.isPlaying);
    expect(player.state).toMatchObject({ sentence: 1, progress: 0, isSentenceBySentence: true });
    player.resume();
    await until(() => speaker.said.length === 2);
    expect(speaker.said[1]).toBe('Sette otto.');
    await until(() => !player.state.isPlaying);
    expect(player.state.isSentenceBySentence).toBe(true);

    player.setSentenceBySentence(false);
    player.play(message);
    await until(() => speaker.said.length === 4);
    expect(speaker.said.slice(2)).toEqual(['Uno due tre quattro cinque sei.', 'Sette otto.']);
  });

  it('GIVEN a cue in the middle of a sentence WHEN played THEN the sentence is said in one piece and the cue fires as the voice gets there', async () => {
    const speaker = new FakeSpeaker();
    const fired: { path: string; words: number }[] = [];
    let words = 0;
    const cue = { kind: 'open' as const, path: '.env', start: null, end: null, symbol: null };
    const player = new Player(
      speaker,
      async (one) => void fired.push({ path: one.path, words }),
      () => {},
      () => words++
    );
    player.play({
      ...message,
      sentences: [
        {
          parts: [
            { type: 'text', text: 'Nel' },
            { type: 'cue', cue },
            { type: 'text', text: 'nuovo scrive.' }
          ]
        }
      ]
    });

    await until(() => !player.state.isPlaying);
    expect(speaker.said).toEqual(['Nel nuovo scrive.']);
    expect(fired).toEqual([{ path: '.env', words: 2 }]);
  });

  it('GIVEN the last sentence WHEN next THEN nothing happens', async () => {
    const { speaker, player } = setup();
    player.play(message, 1);
    await until(() => speaker.said.length === 1);

    player.seek(1);

    await wait(30);
    expect(speaker.said).toHaveLength(1);
    expect(player.state.sentence).toBe(1);
    player.stop();
  });
});
