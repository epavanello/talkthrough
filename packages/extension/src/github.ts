/**
 * GitHub through the gh CLI: GraphQL with gh's active account, else with the other accounts gh is
 * signed in with (work and personal, say), the one that can read a repository remembered for it;
 * the GitHub repository a checkout belongs to; its open pull requests, filtered like GitHub's own
 * lists. vscode-free.
 */
import type { PullFilter, PullItem } from '@talkthrough/shared';
import { git, run } from './proc';

export interface RepoRef {
  host: string;
  owner: string;
  name: string;
}

/** `git@github.com:o/r.git`, `https://github.com/o/r`, `ssh://git@host:22/o/r.git` → host, owner, name. */
export function parseRemote(url: string): RepoRef | null {
  const match = url
    .trim()
    .match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return match ? { host: match[1], owner: match[2], name: match[3] } : null;
}

const sameRepo = (a: RepoRef, b: RepoRef) =>
  a.host.toLowerCase() === b.host.toLowerCase() &&
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.name.toLowerCase() === b.name.toLowerCase();

/** The checkout's remotes and the GitHub repository each points to. */
async function remotes(repo: string) {
  const names = (await git(repo, 'remote').catch(() => '')).split('\n').filter(Boolean);
  const urls = await Promise.all(
    names.map((name) => git(repo, 'remote', 'get-url', name).catch(() => ''))
  );
  return names
    .map((name, index) => ({ name, at: parseRemote(urls[index]) }))
    .filter((remote): remote is { name: string; at: RepoRef } =>
      Boolean(remote.at && /github/i.test(remote.at.host))
    );
}

/**
 * Where a checkout's pull requests are: the remote `gh repo set-default` picked, else `upstream`
 * (a fork's original), else `origin`, else the first GitHub remote. Null without one.
 */
export async function githubRepo(repo: string): Promise<RepoRef | null> {
  const found = await remotes(repo);
  const chosen = (
    await git(repo, 'config', '--get-regexp', '^remote\\..*\\.gh-resolved$').catch(() => '')
  )
    .split('\n')
    .find((line) => line.endsWith(' base'))
    ?.match(/^remote\.(.+)\.gh-resolved /)?.[1];
  const byName = (name?: string) => found.find((remote) => remote.name === name);
  return (byName(chosen) ?? byName('upstream') ?? byName('origin') ?? found[0])?.at ?? null;
}

/** The remote to fetch a repository's refs from: one of the checkout's, else its URL. */
export async function remoteFor(repo: string, at: RepoRef) {
  return (
    (await remotes(repo)).find((remote) => sameRepo(remote.at, at))?.name ??
    `https://${at.host}/${at.owner}/${at.name}.git`
  );
}

/** The account that could read each repository (null: gh's active one), and their tokens. */
const accountOf = new Map<string, string | null>();
const tokens = new Map<string, string>();

/** gh's other signed-in accounts on `host` (older gh versions can't list them: none). */
async function otherAccounts(host: string) {
  const { stdout } = await run('gh', ['auth', 'status', '--json', 'hosts'], { allowFailure: true });
  try {
    const { hosts } = JSON.parse(stdout) as {
      hosts: Record<string, { login: string; active: boolean; state: string }[]>;
    };
    return (hosts[host] ?? [])
      .filter((one) => !one.active && one.state === 'success')
      .map((one) => one.login);
  } catch {
    return [];
  }
}

/** The environment gh runs with to act as `login` (gh's active account when null). */
async function envFor(host: string, login: string | null) {
  if (!login) return process.env;
  let token = tokens.get(`${host}/${login}`);
  if (!token) {
    token = (await run('gh', ['auth', 'token', '--hostname', host, '--user', login])).stdout.trim();
    tokens.set(`${host}/${login}`, token);
  }
  return { ...process.env, GH_TOKEN: token, GH_ENTERPRISE_TOKEN: token };
}

const key = (at: RepoRef) => `${at.host}/${at.owner}/${at.name}`.toLowerCase();

/** gh's environment for a repository: the account that last could read it. */
export const ghEnv = (at: RepoRef) => envFor(at.host, accountOf.get(key(at)) ?? null);

async function request<T>(
  at: RepoRef,
  login: string | null,
  query: string,
  variables: Record<string, unknown>
) {
  const { stdout, stderr } = await run(
    'gh',
    ['api', 'graphql', '--hostname', at.host, '--input', '-'],
    {
      input: JSON.stringify({ query, variables }),
      env: await envFor(at.host, login),
      allowFailure: true
    }
  );
  let payload: { data?: T; errors?: { message: string }[] };
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error(`gh api graphql: ${stderr.trim() || 'no answer'}`);
  }
  if (payload.errors?.length)
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  return payload.data as T;
}

/** A GraphQL request about `at`, as the first of gh's accounts that can answer it. */
export async function graphql<T>(
  at: RepoRef,
  query: string,
  variables: Record<string, unknown> = {}
) {
  const known = accountOf.get(key(at));
  const logins = known !== undefined ? [known] : [null, ...(await otherAccounts(at.host))];
  let failure: Error | null = null;
  for (const login of logins) {
    try {
      const data = await request<T>(at, login, query, variables);
      accountOf.set(key(at), login);
      return data;
    } catch (error) {
      // The active account's reason is the one worth telling
      failure ??= error as Error;
    }
  }
  accountOf.delete(key(at));
  throw failure ?? new Error('gh: no account answered');
}

const SEARCH = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes { ... on PullRequest {
      number title url isDraft updatedAt headRefName additions deletions author { login }
    } }
  }
}`;

interface SearchNode {
  number?: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  headRefName: string;
  additions: number;
  deletions: number;
  author: { login: string } | null;
}

/** GitHub's own lists: review requested from me, assigned to me, mine, every open one. */
const QUALIFIERS: Record<PullFilter, string> = {
  review: 'review-requested:@me',
  assigned: 'assignee:@me',
  mine: 'author:@me',
  open: ''
};

/** The search GitHub runs for a list, narrowed by `text` (words, or qualifiers such as `label:bug`). */
export const pullQuery = (at: RepoRef, filter: PullFilter, text: string) =>
  [
    `repo:${at.owner}/${at.name}`,
    'is:pr',
    'is:open',
    QUALIFIERS[filter],
    text.trim(),
    'sort:updated-desc'
  ]
    .filter(Boolean)
    .join(' ');

/** Open pull requests of a list, most recently updated first (50 at most). */
export async function searchPulls(
  at: RepoRef,
  filter: PullFilter,
  text: string
): Promise<PullItem[]> {
  const data = await graphql<{ search: { nodes: SearchNode[] } }>(at, SEARCH, {
    q: pullQuery(at, filter, text)
  });
  return data.search.nodes
    .filter((node): node is SearchNode & { number: number } => typeof node.number === 'number')
    .map((node) => ({
      number: node.number,
      title: node.title,
      url: node.url,
      author: node.author?.login ?? null,
      isDraft: node.isDraft,
      updatedAt: Date.parse(node.updatedAt),
      head: node.headRefName,
      additions: node.additions,
      deletions: node.deletions
    }));
}
