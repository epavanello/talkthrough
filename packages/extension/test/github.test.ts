import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { githubRepo, parseRemote, pullQuery, searchPulls } from '../src/github';

describe('parseRemote', () => {
  it('GIVEN remote URLs WHEN parsed THEN host, owner and name come out', () => {
    for (const url of [
      'git@github.com:acme/shop.git',
      'https://github.com/acme/shop',
      'ssh://git@github.com:22/acme/shop.git'
    ])
      expect(parseRemote(url)).toEqual({ host: 'github.com', owner: 'acme', name: 'shop' });
    expect(parseRemote('not a remote')).toBeNull();
  });
});

describe('pullQuery', () => {
  const at = { host: 'github.com', owner: 'acme', name: 'shop' };

  it("GIVEN GitHub's lists WHEN searched THEN each has its qualifier, and the text narrows it", () => {
    expect(pullQuery(at, 'review', '')).toBe(
      'repo:acme/shop is:pr is:open review-requested:@me sort:updated-desc'
    );
    expect(pullQuery(at, 'assigned', '')).toContain('assignee:@me');
    expect(pullQuery(at, 'mine', ' cache ')).toBe(
      'repo:acme/shop is:pr is:open author:@me cache sort:updated-desc'
    );
    expect(pullQuery(at, 'open', 'label:bug')).toBe(
      'repo:acme/shop is:pr is:open label:bug sort:updated-desc'
    );
  });
});

describe('githubRepo', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'talkthrough-remotes-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("GIVEN a fork's checkout WHEN asked THEN the pull requests are upstream's, unless gh picked another", async () => {
    git('init', '-q');
    git('remote', 'add', 'origin', 'git@github.com:me/shop.git');
    git('remote', 'add', 'upstream', 'https://github.com/acme/shop.git');
    expect(await githubRepo(repo)).toEqual({ host: 'github.com', owner: 'acme', name: 'shop' });

    git('config', 'remote.origin.gh-resolved', 'base');
    expect(await githubRepo(repo)).toEqual({ host: 'github.com', owner: 'me', name: 'shop' });
  });
});

describe('searchPulls', () => {
  const bin = mkdtempSync(path.join(tmpdir(), 'talkthrough-gh-'));
  const calls = path.join(bin, 'calls.log');
  const path0 = process.env.PATH;

  beforeAll(() => {
    // gh's active account can't read the repository; its other account can
    writeFileSync(
      path.join(bin, 'gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, args.join(' ') + ' token=' + (process.env.GH_TOKEN || '-') + '\\n');
if (args[0] === 'auth' && args[1] === 'status')
  console.log(JSON.stringify({ hosts: { 'github.com': [
    { login: 'work', active: true, state: 'success' },
    { login: 'personal', active: false, state: 'success' }
  ] } }));
else if (args[0] === 'auth' && args[1] === 'token') console.log('token-' + args[args.indexOf('--user') + 1]);
else if (args[0] === 'api') {
  const { variables } = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (process.env.GH_TOKEN !== 'token-personal')
    console.log(JSON.stringify({ errors: [{ message: "Could not resolve to a Repository with the name 'acme/shop'." }] }));
  else console.log(JSON.stringify({ data: { search: { nodes: [
    { number: 12, title: 'Round prices up (' + variables.q + ')', url: 'https://github.com/acme/shop/pull/12', isDraft: false,
      updatedAt: '2026-11-05T10:00:00Z', headRefName: 'fix/round', additions: 3, deletions: 1, author: { login: 'ada' } },
    {}
  ] } } }));
}
`
    );
    chmodSync(path.join(bin, 'gh'), 0o755);
    process.env.PATH = `${bin}:${path0}`;
  });
  afterAll(() => {
    process.env.PATH = path0;
    rmSync(bin, { recursive: true, force: true });
  });

  it("GIVEN a repository only gh's other account can read WHEN listed THEN that account answers, and is remembered", async () => {
    const at = { host: 'github.com', owner: 'acme', name: 'shop' };

    const pulls = await searchPulls(at, 'review', 'round');

    expect(pulls).toEqual([
      {
        number: 12,
        title:
          'Round prices up (repo:acme/shop is:pr is:open review-requested:@me round sort:updated-desc)',
        url: 'https://github.com/acme/shop/pull/12',
        author: 'ada',
        isDraft: false,
        updatedAt: Date.parse('2026-11-05T10:00:00Z'),
        head: 'fix/round',
        additions: 3,
        deletions: 1
      }
    ]);
    await searchPulls(at, 'open', '');
    const log = readFileSync(calls, 'utf8').trim().split('\n');
    expect(log.filter((line) => line.startsWith('api graphql'))).toEqual([
      'api graphql --hostname github.com --input - token=-',
      'api graphql --hostname github.com --input - token=token-personal',
      'api graphql --hostname github.com --input - token=token-personal'
    ]);
  });
});
