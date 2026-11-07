/**
 * Reviews that are not pull requests: the person's own changes, and tours of how something works.
 * Both stand on a snapshot, a commit on top of HEAD that no ref points to, made with a copy of the
 * index: the repository, its index and its working tree stay as they are. vscode-free.
 */
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { ChangeScope, LocalChanges } from '@talkthrough/shared';
import type { LoadedPr } from './pr';
import { git, run } from './proc';

/** Fixed author and dates: the same changes make the same commit, so "nothing moved" is a compare. */
const SNAPSHOT_ENV = {
  GIT_AUTHOR_NAME: 'Talkthrough',
  GIT_AUTHOR_EMAIL: 'talkthrough@localhost',
  GIT_COMMITTER_NAME: 'Talkthrough',
  GIT_COMMITTER_EMAIL: 'talkthrough@localhost',
  GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z'
};

/**
 * The staged changes (the index), or everything uncommitted (untracked files too, ignored ones not),
 * as a commit whose parent is HEAD.
 */
export async function snapshot(repo: string, what: 'staged' | 'uncommitted') {
  const head = await git(repo, 'rev-parse', 'HEAD').catch(() => {
    throw new Error('This repository has no commit yet: there is nothing to compare with.');
  });
  const index = await git(repo, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
  const dir = await mkdtemp(path.join(tmpdir(), 'talkthrough-index-'));
  const copy = path.join(dir, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: copy };
  try {
    await copyFile(index, copy).catch(() => {});
    if (what === 'uncommitted') await run('git', ['add', '-A'], { cwd: repo, env });
    const tree = (await run('git', ['write-tree'], { cwd: repo, env })).stdout.trim();
    const message = what === 'staged' ? 'Staged changes' : 'Uncommitted changes';
    const commit = await run(
      'git',
      ['commit-tree', '--no-gpg-sign', tree, '-p', head, '-m', message],
      { cwd: repo, env: { ...process.env, ...SNAPSHOT_ENV } }
    );
    return commit.stdout.trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The branch work is compared with: the remote's default, else main or master. */
export async function defaultBranch(repo: string) {
  const remoteHead = await git(
    repo,
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD'
  )
    .then((ref) => [ref])
    .catch(() => []);
  for (const candidate of [...remoteHead, 'main', 'master', 'origin/main', 'origin/master']) {
    const found = await run('git', ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], {
      cwd: repo,
      allowFailure: true
    });
    if (found.code === 0) return candidate;
  }
  throw new Error('No main or master branch to compare with.');
}

const lines = (text: string) => text.split('\n').filter(Boolean);

/** How many files each scope holds now: staged, uncommitted (untracked too), the branch's. */
export async function changeCounts(repo: string): Promise<LocalChanges> {
  const [staged, status, untracked, base] = await Promise.all([
    git(repo, 'diff', '--cached', '--name-only'),
    git(repo, 'status', '--porcelain', '--untracked-files=all'),
    git(repo, 'ls-files', '--others', '--exclude-standard'),
    defaultBranch(repo).catch(() => null)
  ]);
  let branch = 0;
  if (base) {
    const from = await git(repo, 'merge-base', base, 'HEAD').catch(() => null);
    if (from)
      branch = new Set([
        ...lines(await git(repo, 'diff', '--name-only', from)),
        ...lines(untracked)
      ]).size;
  }
  return { staged: lines(staged).length, uncommitted: lines(status).length, branch, base };
}

const currentBranch = (repo: string) =>
  git(repo, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => 'HEAD');

/** The head a review of your changes is on now: what to compare a kept one with. */
export const changesHead = (repo: string, scope: ChangeScope) =>
  snapshot(repo, scope === 'staged' ? 'staged' : 'uncommitted');

/** Your changes, as a review: staged or uncommitted against HEAD, or the branch against its base. */
export async function loadChanges(repo: string, scope: ChangeScope): Promise<LoadedPr> {
  const [headSha, branch] = await Promise.all([changesHead(repo, scope), currentBranch(repo)]);
  const base = scope === 'branch' ? await defaultBranch(repo) : 'HEAD';
  const mergeBase = await git(repo, 'merge-base', await git(repo, 'rev-parse', base), headSha);
  const title =
    scope === 'staged'
      ? `Staged changes on ${branch}`
      : scope === 'uncommitted'
        ? `Uncommitted changes on ${branch}`
        : `${branch} against ${base}`;
  return {
    info: {
      kind: 'changes',
      number: 0,
      title,
      url: null,
      author: null,
      base,
      head: branch,
      headSha,
      mergeBase,
      repo,
      // The working tree is what is under review, but for staged changes
      isLive: scope !== 'staged'
    },
    github: null,
    prId: null,
    body: '',
    authorNotes: null,
    viewedPaths: []
  };
}

/** A tour of the code as it is now (uncommitted work included), from the person's question. */
export async function loadTour(repo: string, question: string): Promise<LoadedPr> {
  const [headSha, branch] = await Promise.all([snapshot(repo, 'uncommitted'), currentBranch(repo)]);
  const title = question.replace(/\s+/g, ' ').trim();
  return {
    info: {
      kind: 'tour',
      number: 0,
      title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
      url: null,
      author: null,
      base: branch,
      head: branch,
      headSha,
      mergeBase: headSha,
      repo,
      isLive: true
    },
    github: null,
    prId: null,
    body: question.trim(),
    authorNotes: null,
    viewedPaths: []
  };
}
