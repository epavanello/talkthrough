/**
 * The pull request under review: GitHub's view of it through the gh CLI (title, notes, the files
 * already Viewed), its commits in the local repository, and marking files as Viewed. vscode-free.
 */
import type { PrInfo } from '@talkthrough/shared';
import { githubRepo, graphql, remoteFor, type RepoRef } from './github';
import { git, run } from './proc';

export interface PrRef extends RepoRef {
  number: number;
}

export interface LoadedPr {
  info: PrInfo;
  /** Where the PR lives on GitHub; null for a local review. */
  github: PrRef | null;
  /** GitHub's node id, for the Viewed mutation; null for a local review. */
  prId: string | null;
  body: string;
  authorNotes: string | null;
  /** Files the viewer already marked as Viewed on GitHub. */
  viewedPaths: string[];
}

/** PR authors post their per-file reasoning as a comment starting with this marker. */
const NOTES_MARKER = '<!-- pr-tour:notes -->';

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number title url body author { login }
      baseRefName baseRefOid headRefName headRefOid
      comments(last: 50) { nodes { body } }
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path viewerViewedState }
      }
    }
  }
}`;

interface PrNode {
  id: string;
  number: number;
  title: string;
  url: string;
  body: string;
  author: { login: string } | null;
  baseRefName: string;
  baseRefOid: string;
  headRefName: string;
  headRefOid: string;
  comments: { nodes: { body: string }[] };
  files: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { path: string; viewerViewedState: string }[];
  };
}

/** `943`, `#943` or a pull request URL. */
export async function parsePrRef(repo: string, raw: string): Promise<PrRef> {
  const url = raw.match(/https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/);
  if (url) return { host: url[1], owner: url[2], name: url[3], number: Number(url[4]) };
  const number = raw.trim().replace(/^#/, '');
  if (!/^\d+$/.test(number)) throw new Error(`Not a pull request number or URL: ${raw}`);
  const at = await githubRepo(repo);
  if (!at) throw new Error('This repository has no GitHub remote: open a pull request by its URL.');
  return { ...at, number: Number(number) };
}

const hasCommit = async (repo: string, sha: string) =>
  (await run('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repo, allowFailure: true }))
    .code === 0;

/** Whether the checkout's HEAD is `sha`. */
export const isAtCommit = async (repo: string, sha: string) =>
  (await git(repo, 'rev-parse', 'HEAD').catch(() => '')) === sha;

export async function loadPr(repo: string, ref: PrRef): Promise<LoadedPr> {
  const viewed: string[] = [];
  let after: string | null = null;
  let pr: PrNode | null = null;
  do {
    const data: { repository: { pullRequest: PrNode | null } | null } = await graphql(
      ref,
      PR_QUERY,
      {
        owner: ref.owner,
        name: ref.name,
        number: ref.number,
        after
      }
    );
    const page = data.repository?.pullRequest;
    if (!page) throw new Error(`PR #${ref.number} not found in ${ref.owner}/${ref.name}`);
    pr ??= page;
    viewed.push(
      ...page.files.nodes.filter((f) => f.viewerViewedState === 'VIEWED').map((f) => f.path)
    );
    after = page.files.pageInfo.hasNextPage ? page.files.pageInfo.endCursor : null;
  } while (after);

  if (!(await hasCommit(repo, pr.headRefOid)) || !(await hasCommit(repo, pr.baseRefOid))) {
    // Fills FETCH_HEAD only: no branch, remote-tracking ref or working tree changes
    await git(
      repo,
      'fetch',
      '--quiet',
      '--no-tags',
      await remoteFor(repo, ref),
      `refs/pull/${ref.number}/head`,
      `refs/heads/${pr.baseRefName}`
    );
  }
  const mergeBase = await git(repo, 'merge-base', pr.baseRefOid, pr.headRefOid);
  return {
    info: {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: pr.author?.login ?? null,
      base: pr.baseRefName,
      head: pr.headRefName,
      headSha: pr.headRefOid,
      mergeBase,
      repo,
      isLive: await isAtCommit(repo, pr.headRefOid)
    },
    github: ref,
    prId: pr.id,
    body: pr.body,
    authorNotes: pr.comments.nodes.find((c) => c.body.includes(NOTES_MARKER))?.body ?? null,
    viewedPaths: viewed
  };
}

const HEAD_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid } }
}`;

/** The PR's head commit now: GitHub's, or `ref`'s for a local review. */
export async function currentHead(loaded: LoadedPr, ref: string) {
  const at = loaded.github;
  if (!at) return git(loaded.info.repo, 'rev-parse', ref);
  const data = await graphql<{ repository: { pullRequest: { headRefOid: string } | null } | null }>(
    at,
    HEAD_QUERY,
    { owner: at.owner, name: at.name, number: at.number }
  );
  const sha = data.repository?.pullRequest?.headRefOid;
  if (!sha) throw new Error(`PR #${at.number} not found in ${at.owner}/${at.name}`);
  return sha;
}

/**
 * Commits from the head under review to `sha`, fetched first when missing (no ref is made); null
 * when `sha` doesn't descend from it: the PR's history was rewritten (a force-push, a rebase).
 */
export async function commitsSince(loaded: LoadedPr, sha: string) {
  const { repo, headSha } = loaded.info;
  if (loaded.github && !(await hasCommit(repo, sha)))
    await git(
      repo,
      'fetch',
      '--quiet',
      '--no-tags',
      await remoteFor(repo, loaded.github),
      `refs/pull/${loaded.github.number}/head`
    );
  const isAhead =
    (
      await run('git', ['merge-base', '--is-ancestor', headSha, sha], {
        cwd: repo,
        allowFailure: true
      })
    ).code === 0;
  return isAhead ? Number(await git(repo, 'rev-list', '--count', `${headSha}..${sha}`)) : null;
}

/** A review of two local commits, with no pull request on GitHub (tests, unpushed branches). */
export async function loadLocal(
  repo: string,
  options: { base: string; head: string; number: number; title: string }
): Promise<LoadedPr> {
  const headSha = await git(repo, 'rev-parse', options.head);
  const baseSha = await git(repo, 'rev-parse', options.base);
  return {
    info: {
      number: options.number,
      title: options.title,
      url: null,
      author: null,
      base: options.base,
      head: options.head,
      headSha,
      mergeBase: await git(repo, 'merge-base', baseSha, headSha),
      repo,
      isLive: await isAtCommit(repo, headSha)
    },
    github: null,
    prId: null,
    body: '',
    authorNotes: null,
    viewedPaths: []
  };
}

/** The PR's unified diff from the merge base, renames detected. */
export const prDiff = async (info: PrInfo, paths: string[] = []) =>
  (
    await run(
      'git',
      ['diff', '-M', info.mergeBase, info.headSha, ...(paths.length ? ['--', ...paths] : [])],
      {
        cwd: info.repo
      }
    )
  ).stdout;

/** A file as it is at `rev`; '' when it doesn't exist there. */
export const fileAt = async (repo: string, rev: string, path: string) => {
  const result = await run('git', ['show', `${rev}:${path}`], { cwd: repo, allowFailure: true });
  return result.code === 0 ? result.stdout : '';
};

/** Lines matching `pattern` (extended regex) in the files at `rev`, as `path:line: text`. */
export async function searchAt(
  repo: string,
  rev: string,
  pattern: string,
  options: { paths?: string[]; ignoreCase?: boolean; max?: number } = {}
) {
  const max = options.max ?? 200;
  const args = [
    'grep',
    '-n',
    '-I',
    '-E',
    ...(options.ignoreCase ? ['-i'] : []),
    '-e',
    pattern,
    rev
  ];
  const result = await run('git', [...args, '--', ...(options.paths ?? [])], {
    cwd: repo,
    allowFailure: true
  });
  // 1: nothing matched
  if (result.code > 1) throw new Error(result.stderr.trim() || 'git grep failed');
  const lines = result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(rev.length + 1).slice(0, 240));
  if (!lines.length) return 'No match.';
  const more =
    lines.length > max ? `\n… ${lines.length - max} more: narrow the pattern or the paths.` : '';
  return lines.slice(0, max).join('\n') + more;
}

/** The PR's commits, oldest first: short hash and subject. */
export const commitsOf = async (info: PrInfo) =>
  (
    await git(
      info.repo,
      'log',
      '--reverse',
      '--format=%h %s',
      '-n',
      '100',
      `${info.mergeBase}..${info.headSha}`
    )
  )
    .split('\n')
    .filter(Boolean);

/** Marks files as Viewed on GitHub, or takes the mark back (`isViewed` false). */
export async function markViewed(at: RepoRef, prId: string, paths: string[], isViewed = true) {
  if (!paths.length) return;
  const mutation = isViewed ? 'markFileAsViewed' : 'unmarkFileAsViewed';
  const declarations = paths.map((_, index) => `$p${index}: String!`).join(', ');
  const mutations = paths
    .map(
      (_, index) =>
        `m${index}: ${mutation}(input: {pullRequestId: $id, path: $p${index}}) { clientMutationId }`
    )
    .join('\n');
  await graphql(at, `mutation($id: ID!, ${declarations}) { ${mutations} }`, {
    id: prId,
    ...Object.fromEntries(paths.map((path, index) => [`p${index}`, path]))
  });
}
