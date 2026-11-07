import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultBranch, loadChanges, loadTour, snapshot } from '../src/changes';
import { systemPrompt } from '../src/prompts';
import { tourMap } from '../src/tools';

describe('your own changes', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'talkthrough-changes-'));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
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
  const write = (file: string, text: string) => writeFileSync(path.join(repo, file), text);
  const changed = (from: string, to: string) => git('diff', '--name-only', from, to).split('\n');

  git('init', '-q', '-b', 'main');
  write('.gitignore', '*.log\n');
  write('price.ts', 'export const price = 1;\n');
  write('orders.ts', 'export const orders = [];\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('switch', '-q', '-c', 'feat/round');
  write('price.ts', 'export const price = Math.ceil(1.2);\n');
  git('commit', '-qam', 'round up');
  // Staged, unstaged, untracked and ignored work on top
  write('orders.ts', 'export const orders = [1];\n');
  git('add', 'orders.ts');
  write('price.ts', 'export const price = Math.ceil(1.5);\n');
  write('notes.ts', 'export const notes = true;\n');
  write('debug.log', 'noise\n');
  const status = git('status', '--porcelain');

  it('GIVEN staged and unstaged work WHEN snapshotted THEN each scope is a commit on HEAD, and the repository is untouched', async () => {
    const staged = await snapshot(repo, 'staged');
    const uncommitted = await snapshot(repo, 'uncommitted');

    expect(git('rev-parse', `${staged}^`)).toBe(git('rev-parse', 'HEAD'));
    expect(changed('HEAD', staged)).toEqual(['orders.ts']);
    expect(changed('HEAD', uncommitted)).toEqual(['notes.ts', 'orders.ts', 'price.ts']);
    // The same work, the same commit: "nothing moved" is a compare
    expect(await snapshot(repo, 'staged')).toBe(staged);
    expect(git('status', '--porcelain')).toBe(status);
    expect(git('diff', '--cached', '--name-only')).toBe('orders.ts');
  });

  it('GIVEN a feature branch WHEN reviewed THEN it goes against main, uncommitted work included', async () => {
    expect(await defaultBranch(repo)).toBe('main');

    const branch = await loadChanges(repo, 'branch');

    expect(branch.info).toMatchObject({
      kind: 'changes',
      number: 0,
      title: 'feat/round against main',
      base: 'main',
      isLive: true
    });
    expect(branch.info.mergeBase).toBe(git('rev-parse', 'main'));
    expect(changed(branch.info.mergeBase, branch.info.headSha)).toEqual([
      'notes.ts',
      'orders.ts',
      'price.ts'
    ]);
    const staged = await loadChanges(repo, 'staged');
    expect(staged.info).toMatchObject({ title: 'Staged changes on feat/round', isLive: false });
    expect(staged.info.mergeBase).toBe(git('rev-parse', 'HEAD'));
  });

  it('GIVEN a question WHEN a tour starts THEN it stands on the code as it is, with no diff', async () => {
    const tour = await loadTour(repo, '  How does   rounding work?\n');

    expect(tour.info).toMatchObject({ kind: 'tour', title: 'How does rounding work?' });
    expect(tour.info.mergeBase).toBe(tour.info.headSha);
    expect(git('show', `${tour.info.headSha}:notes.ts`)).toBe('export const notes = true;');
  });
});

describe('tourMap', () => {
  const lines = (file: string) => ({ 'src/signup.ts': 40, 'src/mail.ts': 12 })[file] ?? null;

  it('GIVEN blocks of stops WHEN set THEN stops are numbered hunks in their files, kept within the file', () => {
    const map = tourMap(
      {
        blocks: [
          {
            title: 'The form',
            why: 'Where it starts',
            stops: [{ path: './src/signup.ts', start: 10, end: 20, title: 'Posts the form' }]
          },
          {
            title: 'The email',
            stops: [
              { path: 'src/mail.ts', start: 5, end: 99, title: 'Sends it' },
              { path: 'src/signup.ts', start: 30, end: 35, title: 'Checks it' }
            ]
          }
        ]
      },
      lines
    );

    expect(map.problems).toEqual([]);
    expect(map.blocks.map((block) => block.hunks)).toEqual([['T1'], ['T2', 'T3']]);
    expect(map.hunks.T2).toMatchObject({
      path: 'src/mail.ts',
      start: 5,
      end: 12,
      header: 'Sends it'
    });
    expect(map.files.map((file) => [file.path, file.hunks])).toEqual([
      ['src/signup.ts', ['T1', 'T3']],
      ['src/mail.ts', ['T2']]
    ]);
  });

  it('GIVEN stops on missing files or past the end WHEN set THEN Claude hears what to fix', () => {
    const map = tourMap(
      {
        blocks: [
          {
            title: 'Nowhere',
            stops: [
              { path: 'src/gone.ts', start: 1, end: 5 },
              { path: 'src/mail.ts', start: 50, end: 60 }
            ]
          }
        ]
      },
      lines
    );

    expect(map.problems).toEqual([
      'src/gone.ts does not exist.',
      'src/mail.ts has 12 lines: L50 is past its end.',
      '"Nowhere" has no stop.'
    ]);
  });
});

describe('systemPrompt', () => {
  it('GIVEN each kind of review WHEN Claude starts THEN it hears the tools and the job of that kind', () => {
    const tour = systemPrompt('italian', true, 'tour');
    expect(tour).toContain('set_tour');
    expect(tour).toContain('code_search');
    expect(tour).not.toContain('set_map');
    expect(tour).toContain('browser_open');

    const own = systemPrompt('italian', false, 'changes');
    expect(own).toContain("the person's own changes");
    expect(own).toContain('leftover debug code');
    expect(systemPrompt('italian')).not.toContain("person's own changes");
  });
});
