import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { logAt, searchAt, showAt } from '../src/pr';

describe('searchAt', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'talkthrough-search-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t'
      }
    }).trim();
  git('init', '-q');
  writeFileSync(
    path.join(repo, 'price.ts'),
    'export const resolvePrice = (n: number) => Math.ceil(n);\n'
  );
  writeFileSync(
    path.join(repo, 'orders.ts'),
    "import { resolvePrice } from './price';\nsave(resolvePrice(3));\n"
  );
  git('add', '-A');
  git('commit', '-qm', 'head');
  const head = git('rev-parse', 'HEAD');
  // The working tree moves on: the search reads the commit, not the files on disk
  writeFileSync(path.join(repo, 'orders.ts'), 'nothing here\n');
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('GIVEN a pattern WHEN searched at the PR head THEN the matches come as path:line: text', async () => {
    expect(await searchAt(repo, head, 'resolvePrice\\(')).toBe(
      'orders.ts:2:save(resolvePrice(3));'
    );
    expect(await searchAt(repo, head, 'resolvePrice', { paths: ['price.ts'] })).toBe(
      'price.ts:1:export const resolvePrice = (n: number) => Math.ceil(n);'
    );
  });

  it('GIVEN paths, case and a cap WHEN searched THEN they narrow the answer', async () => {
    expect(
      await searchAt(repo, head, 'RESOLVEPRICE', { paths: ['orders.ts'], ignoreCase: true, max: 1 })
    ).toBe(
      "orders.ts:1:import { resolvePrice } from './price';\n… 1 more: narrow the pattern or the paths."
    );
    expect(await searchAt(repo, head, 'nowhere')).toBe('No match.');
  });

  it('GIVEN the history WHEN read THEN commits come as hash, date, author and subject; options are refused', async () => {
    expect(await logAt(repo, head)).toMatch(/^[0-9a-f]{7,} \d{4}-\d{2}-\d{2} t: head$/);
    expect(await showAt(repo, head, ['price.ts'])).toContain('Math.ceil');
    expect(await logAt(repo, '--output=/tmp/x')).toBe('Not a revision: --output=/tmp/x');
    expect(await showAt(repo, '-O/bin/sh')).toBe('Not a revision: -O/bin/sh');
  });
});
