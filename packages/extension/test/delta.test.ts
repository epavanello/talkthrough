import type { Hunk } from '@talkthrough/shared';
import { describe, expect, it } from 'vitest';
import { DELTA_TITLE, carryOver } from '../src/delta';
import { indexPatch, parsePatch } from '../src/patch';

const diff = (...files: [string, string[]][]) =>
  files
    .map(
      ([path, hunks]) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunks.join('\n')}`
    )
    .join('\n');
const hunk = (at: number, ...lines: string[]) =>
  [`@@ -${at},${lines.length} +${at},${lines.length} @@`, ...lines].join('\n');

describe('hunk keys', () => {
  it('GIVEN the same change moved further down WHEN indexed THEN its key stays; a changed one gets a new key', () => {
    const before = indexPatch(
      parsePatch(diff(['src/a.ts', [hunk(3, ' x', '-old', '+new', ' y')]]))
    );
    const after = indexPatch(
      parsePatch(
        diff([
          'src/a.ts',
          [hunk(1, '+import z;', ' w'), hunk(9, ' x', '-old', '+new', ' y'), hunk(20, '-a', '+b')]
        ])
      )
    );

    const keys = Object.values(after.hunks).map((one: Hunk) => one.key);
    expect(keys[1]).toBe(before.hunks.H1.key);
    expect(new Set(keys).size).toBe(3);
  });

  it('GIVEN the same change twice in a file WHEN indexed THEN the copies have keys of their own', () => {
    const { hunks } = indexPatch(
      parsePatch(diff(['src/a.ts', [hunk(3, '-a', '+b'), hunk(30, '-a', '+b')]]))
    );

    expect(hunks.H2.key).toBe(`${hunks.H1.key}#2`);
  });
});

describe('carryOver', () => {
  const old = indexPatch(
    parsePatch(
      diff(['src/a.ts', [hunk(3, '-a', '+b'), hunk(30, '-c', '+d')]], ['src/b.ts', [hunk(5, '+e')]])
    )
  ).hunks;

  it('GIVEN a reviewed map WHEN the PR moves THEN unchanged hunks keep state and block, the rest gathers on top', () => {
    const next = indexPatch(
      parsePatch(
        diff(
          ['src/a.ts', [hunk(3, '-a', '+b'), hunk(30, '-c', '+D')]],
          ['src/b.ts', [hunk(5, '+e')]],
          ['src/c.ts', [hunk(1, '+f')]]
        )
      )
    ).hunks;

    const result = carryOver(
      {
        hunks: old,
        coverage: { H1: 'ok', H2: 'ok', H3: 'explained' },
        step: ['H3'],
        blocks: [
          { id: 'B1', title: 'Core', why: '', hunks: ['H1', 'H2'] },
          { id: 'B2', title: 'Wiring', why: '', hunks: ['H3'] }
        ]
      },
      next
    );

    expect(result.changed).toEqual(['H2', 'H4']);
    expect(result.coverage).toEqual({ H1: 'ok', H2: 'todo', H3: 'explained', H4: 'todo' });
    expect(result.step).toEqual(['H3']);
    expect(result.blocks).toEqual([
      {
        id: 'B1',
        title: DELTA_TITLE,
        why: 'New or changed since the head you reviewed',
        hunks: ['H2', 'H4']
      },
      { id: 'B2', title: 'Core', why: '', hunks: ['H1'] },
      { id: 'B3', title: 'Wiring', why: '', hunks: ['H3'] }
    ]);
  });

  it('GIVEN an earlier update block WHEN the PR moves again THEN it stays one block, ahead of the rest', () => {
    const result = carryOver(
      {
        hunks: old,
        coverage: { H1: 'ok', H2: 'todo', H3: 'ok' },
        step: [],
        blocks: [
          { id: 'B1', title: DELTA_TITLE, why: '', hunks: ['H2'] },
          { id: 'B2', title: 'Core', why: '', hunks: ['H1', 'H3'] }
        ]
      },
      indexPatch(
        parsePatch(
          diff(
            ['src/a.ts', [hunk(3, '-a', '+b'), hunk(30, '-c', '+d')]],
            ['src/b.ts', [hunk(5, '+E')]]
          )
        )
      ).hunks
    );

    expect(result.blocks.map((block) => [block.title, block.hunks])).toEqual([
      [DELTA_TITLE, ['H2', 'H3']],
      ['Core', ['H1']]
    ]);
  });

  it('GIVEN no map yet WHEN the PR moves THEN there is still none: Claude draws it', () => {
    expect(carryOver({ hunks: old, coverage: {}, step: [], blocks: [] }, old).blocks).toEqual([]);
  });
});
