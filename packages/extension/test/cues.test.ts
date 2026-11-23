import { choiceText, paceOf, type Sentence } from '@talkthrough/shared';
import { describe, expect, it } from 'vitest';
import { codePaths, cuesOf, parseReply, speakable } from '../src/cues';

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

describe('browser cues', () => {
  it('GIVEN page and mark cues WHEN parsed THEN the URL and the target stay as written', () => {
    const cues = cuesOf(
      parseReply(
        '[[page /events/42?tab=slots]] Ecco la pagina. [[mark @e3 action: Clicca qui]] Questo.'
      )
    );

    expect(cues).toEqual([
      { kind: 'page', path: '/events/42?tab=slots', start: null, end: null, symbol: null },
      { kind: 'mark', path: '@e3', start: null, end: null, symbol: 'action: Clicca qui' }
    ]);
  });
});

describe('choice cues', () => {
  it('GIVEN choices at the end of a reply WHEN parsed THEN they are cues, and the voice skips them', () => {
    const reply = 'Lo upload è il pezzo migliore. [[choice Mostrami R2]] [[choice Chi lo chiama?]]';
    expect(cuesOf(parseReply(reply)).map((cue) => choiceText(cue))).toEqual([
      'Mostrami R2',
      'Chi lo chiama?'
    ]);
    expect(speakable(reply)).toBe('Lo upload è il pezzo migliore.');
  });
});

describe('pace cues', () => {
  it('GIVEN a routine reply WHEN parsed THEN its pace is skim, and the voice skips the cue', () => {
    const reply = '[[pace skim]] Restano solo gli import dei file usati.';
    expect(paceOf(parseReply(reply))).toBe('skim');
    expect(speakable(reply)).toBe('Restano solo gli import dei file usati.');
  });

  it('GIVEN a reply without a pace cue, or an unknown one WHEN parsed THEN it has no pace', () => {
    expect(paceOf(parseReply('Qui cambia il calcolo del prezzo.'))).toBeNull();
    expect(paceOf(parseReply('[[pace meh]] Boh.'))).toBeNull();
    expect(paceOf(parseReply('[[pace Focus]] Attento al lock.'))).toBe('focus');
  });
});

describe('speakable', () => {
  it('GIVEN markdown, code and links WHEN made speakable THEN only the words remain', () => {
    expect(speakable('**Attenzione**: `src/lib/price.ts` usa [questo](https://x.y) - ok')).toBe(
      'Attenzione: price usa questo - ok'
    );
    expect(speakable('Vedi [[show a/b(c.ts#L2]] qui')).toBe('Vedi qui');
  });

  it('GIVEN file names in code WHEN made speakable THEN no dot is left for the voice to read', () => {
    expect(speakable('Nel `.env` nuovo scrive')).toBe('Nel env nuovo scrive');
    expect(speakable('In `scripts/migrate.mts` e `.env.example`')).toBe('In migrate e env example');
    expect(speakable('Chiama `config.load()` poi `x`')).toBe('Chiama config load() poi x');
  });

  it('GIVEN dots and colons inside words WHEN made speakable THEN they become spaces; a sentence colon and a time stay', () => {
    expect(speakable('Il comando talkthrough:next apre chat.ts')).toBe(
      'Il comando talkthrough next apre chat ts'
    );
    expect(speakable('Usa `std::fs::read` e `foo:bar`')).toBe('Usa std fs read e foo bar');
    expect(speakable('Nota: alle 10:30 parte. Poi basta.')).toBe(
      'Nota: alle 10:30 parte. Poi basta.'
    );
  });
});

describe('codePaths', () => {
  it('GIVEN a reply with code WHEN read THEN only paths, without line or ./, once each', () => {
    expect(
      codePaths(
        'See `infra/services.ts:250`, `./a.ts`, `services.ts`, `ARIA_MONGO_URI` and `infra/services.ts`.'
      )
    ).toEqual(['infra/services.ts', 'a.ts', 'services.ts']);
  });
});
