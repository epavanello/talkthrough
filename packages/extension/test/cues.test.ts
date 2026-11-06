import type { Sentence } from '@talkthrough/shared';
import { describe, expect, it } from 'vitest';
import { cuesOf, parseReply, speakable } from '../src/cues';

/** A sentence as plain text, cues left out. */
const plainText = (sentence: Sentence) =>
  sentence.parts
    .map((part) => (part.type === 'text' ? part.text : part.type === 'code' ? part.code : ''))
    .join('')
    .trim();

describe('parseReply', () => {
  it('GIVEN a reply with cues WHEN parsed THEN each cue opens the sentence it precedes', () => {
    const sentences = parseReply(
      'La PR cambia il calcolo. [[show src/price.ts#L40-58]] Qui nasce resolvePrice. [[refs src/price.ts#L40 resolvePrice]] La chiamano due punti.'
    );

    expect(sentences.map(plainText)).toEqual([
      'La PR cambia il calcolo.',
      'Qui nasce resolvePrice.',
      'La chiamano due punti.'
    ]);
    expect(sentences[1].parts[0]).toEqual({
      type: 'cue',
      cue: { kind: 'show', path: 'src/price.ts', start: 40, end: 58, symbol: null }
    });
    expect(sentences[2].parts[0]).toEqual({
      type: 'cue',
      cue: { kind: 'refs', path: 'src/price.ts', start: 40, end: 40, symbol: 'resolvePrice' }
    });
  });

  it('GIVEN a cue inside a sentence WHEN parsed THEN it stays at its place between the words', () => {
    const [sentence] = parseReply(
      'Il controller la chiama [[open src/orders.ts#L12]] prima di salvare.'
    );

    expect(sentence.parts.map((part) => part.type)).toEqual(['text', 'cue', 'text']);
  });

  it('GIVEN a fenced code block WHEN parsed THEN it is a sentence of its own', () => {
    const sentences = parseReply('Ecco un esempio:\n```ts\nconst x = 1;\n```\nTutto qui.');

    expect(sentences).toHaveLength(3);
    expect(sentences[1].parts).toEqual([{ type: 'code', lang: 'ts', code: 'const x = 1;' }]);
  });

  it('GIVEN the voice-mode marker and line breaks WHEN parsed THEN the marker is gone and lines split', () => {
    const sentences = parseReply('Prima riga\n⁣*Seconda riga*');

    expect(sentences.map(plainText)).toEqual(['Prima riga', '*Seconda riga*']);
  });

  it('GIVEN a whole-file cue WHEN parsed THEN it has no range', () => {
    const cues = cuesOf(parseReply('[[show ./src/a.ts]] Il file intero.'));

    expect(cues).toEqual([
      { kind: 'show', path: 'src/a.ts', start: null, end: null, symbol: null }
    ]);
  });
});

describe('cues with brackets in their paths', () => {
  it('GIVEN SvelteKit and Next.js routes WHEN parsed THEN each cue holds its whole path', () => {
    const cues = cuesOf(
      parseReply(
        '[[show packages/web/src/routes/(protected)/[eventId]/reschedule/+page.server.ts#L14-51]] La query. ' +
          '[[open src/routes/[[lang]]/+page.svelte#L3]] Qui. [[refs app/[...slug]/page.tsx#L4 load]].'
      )
    );

    expect(cues.map((cue) => [cue.path, cue.start, cue.end, cue.symbol])).toEqual([
      ['packages/web/src/routes/(protected)/[eventId]/reschedule/+page.server.ts', 14, 51, null],
      ['src/routes/[[lang]]/+page.svelte', 3, 3, null],
      ['app/[...slug]/page.tsx', 4, 4, 'load']
    ]);
  });
});

describe('speakable', () => {
  it('GIVEN markdown, code and links WHEN made speakable THEN only the words remain', () => {
    expect(speakable('**Attenzione**: `src/lib/price.ts` usa [questo](https://x.y) - ok')).toBe(
      'Attenzione: price.ts usa questo - ok'
    );
    expect(speakable('Vedi [[show a/b(c.ts#L2]] qui')).toBe('Vedi qui');
  });
});
