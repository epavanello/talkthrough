/**
 * The checkout at the PR head, so diffs open on real files with IntelliSense and local errors: a
 * review worktree (opened in a new window, where the review goes on), or the PR's branch checked
 * out here when nothing would get in the way.
 */
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ghEnv } from './github';
import type { LoadedPr } from './pr';
import { git, run } from './proc';

const hasChanges = async (folder: string) =>
  (await git(folder, 'status', '--porcelain', '--untracked-files=no')) !== '';

/**
 * `<main checkout>/.claude/worktrees/pr-<n>`, detached at the PR head, kept out of `git status`
 * through the repository's info/exclude. One already there moves to the PR head.
 */
export async function reviewWorktree(loaded: LoadedPr, commonDir: string) {
  const { repo, number, headSha } = loaded.info;
  const main =
    (await git(repo, 'worktree', 'list', '--porcelain')).match(/^worktree (.+)$/m)?.[1] ?? repo;
  const folder = path.join(main, '.claude', 'worktrees', `pr-${number}`);
  if (existsSync(folder)) {
    if ((await git(folder, 'rev-parse', 'HEAD')) === headSha) return folder;
    if (await hasChanges(folder))
      throw new Error(`${folder} has uncommitted changes: commit or discard them first.`);
    await git(folder, 'checkout', '--quiet', '--detach', headSha);
    return folder;
  }
  const isIgnored =
    (
      await run('git', ['check-ignore', '-q', path.relative(main, folder)], {
        cwd: main,
        allowFailure: true
      })
    ).code === 0;
  if (!isIgnored) {
    await mkdir(path.join(commonDir, 'info'), { recursive: true });
    await appendFile(path.join(commonDir, 'info', 'exclude'), '\n/.claude/worktrees/\n');
  }
  await git(main, 'worktree', 'add', '--quiet', '--detach', folder, headSha);
  return folder;
}

/**
 * Checks the PR out in this window's checkout, after asking: `gh pr checkout` (its branch), or the
 * head commit for a review with no PR on GitHub. Answers whether it did.
 */
export async function checkoutHere(loaded: LoadedPr, openWorktree: () => Promise<void>) {
  const { repo, number, head, headSha, url } = loaded.info;
  if (await hasChanges(repo)) {
    const choice = await vscode.window.showWarningMessage(
      'This checkout has uncommitted changes.',
      {
        modal: true,
        detail: 'Commit or stash them first, or review in a worktree: your checkout stays as it is.'
      },
      'Open a Review Worktree'
    );
    if (choice) await openWorktree();
    return false;
  }
  const from = (await git(repo, 'branch', '--show-current').catch(() => '')) || 'a detached HEAD';
  const choice = await vscode.window.showWarningMessage(
    `Check out PR #${number} here?`,
    {
      modal: true,
      detail: `This window's checkout moves from ${from} to ${head}, the PR head. Nothing uncommitted is lost.`
    },
    'Check Out'
  );
  if (choice !== 'Check Out') return false;
  if (loaded.github && url)
    await run('gh', ['pr', 'checkout', url], { cwd: repo, env: await ghEnv(loaded.github) });
  else await git(repo, 'checkout', '--quiet', '--detach', headSha);
  return true;
}
