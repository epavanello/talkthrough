import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Browser,
  browserBin,
  describeCommand,
  markOf,
  markScript,
  resolveUrl
} from '../src/browser';

describe('browserBin', () => {
  it('GIVEN a .vsix with the binary WHEN resolved THEN the setting wins, then the bundled one, then the PATH', () => {
    const extension = mkdtempSync(path.join(tmpdir(), 'talkthrough-extension-'));
    expect(browserBin(extension)).toBe('agent-browser');
    mkdirSync(path.join(extension, 'bin'));
    const name = process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser';
    const bundled = path.join(extension, 'bin', name);
    // Unpacked without its file mode
    writeFileSync(bundled, '', { mode: 0o644 });
    expect(browserBin(extension, '  ')).toBe(bundled);
    if (process.platform !== 'win32') expect(statSync(bundled).mode & 0o111).toBeTruthy();
    expect(browserBin(extension, '/opt/agent-browser')).toBe('/opt/agent-browser');
    rmSync(extension, { recursive: true, force: true });
  });
});

describe('resolveUrl', () => {
  it('GIVEN a path WHEN opened THEN it goes to the current page origin; full URLs stay', () => {
    expect(resolveUrl('/events/42', 'http://localhost:5173/home')).toBe(
      'http://localhost:5173/events/42'
    );
    expect(resolveUrl('localhost:5173/x', null)).toBe('http://localhost:5173/x');
    expect(resolveUrl('https://staging.example.com/a', null)).toBe('https://staging.example.com/a');
    expect(() => resolveUrl('/events', null)).toThrow('Not a full URL');
  });
});

describe('markOf', () => {
  it("GIVEN a mark cue's label WHEN read THEN a kind in front sets it, change otherwise", () => {
    expect(markOf('action: Click here')).toEqual({ kind: 'action', label: 'Click here' });
    expect(markOf('The new guard')).toEqual({ kind: 'change', label: 'The new guard' });
  });
});

describe('markScript', () => {
  it('GIVEN a label with markup WHEN drawn THEN it goes in as text, in a script that parses', () => {
    const script = markScript(
      { id: 'm1', target: '@e2', label: '<img src=x onerror=alert(1)>', kind: 'action' },
      { x: 10, y: 20, width: 100, height: 30 },
      1
    );

    expect(() => new Function(`return ${script}`)).not.toThrow();
    expect(script).toContain('tag.textContent');
    expect(script).not.toContain('innerHTML');
    expect(script).toContain(JSON.stringify('<img src=x onerror=alert(1)>'));
  });
});

describe('describeCommand', () => {
  it('GIVEN a command from the stream WHEN shown THEN it reads as an action and its target', () => {
    expect(describeCommand({ action: 'click', params: { selector: '@e3' } })).toBe('click @e3');
    expect(
      describeCommand({ action: 'navigate', params: { url: 'http://localhost:5173/x' } })
    ).toBe('navigate http://localhost:5173/x');
  });
});

describe('Browser', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'talkthrough-ab-'));
  const log = path.join(dir, 'calls.log');
  const bin = path.join(dir, 'agent-browser');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // A fake CLI: logs its arguments and the environment that matters, answers like the real one
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2).filter((arg) => arg !== '--json');
const env = ['AGENT_BROWSER_SESSION', 'AGENT_BROWSER_NAMESPACE', 'AGENT_BROWSER_ACTION_POLICY', 'AGENT_BROWSER_CONTENT_BOUNDARIES', 'AGENT_BROWSER_ARGS', 'AGENT_BROWSER_STREAM_MAX_WIDTH'].map((name) => name + '=' + (process.env[name] ?? ''));
fs.appendFileSync(${JSON.stringify(log)}, args.join(' ') + ' | ' + env.join(' ') + '\\n');
const answer = (data, error) => console.log(JSON.stringify({ success: !error, data, error: error ?? null }));
if (args[0] === '--version') console.log('agent-browser 9.9.9');
else if (args[0] === 'open' && args[1].includes(':9/')) answer({}, 'Navigation failed: net::ERR_CONNECTION_REFUSED');
else if (args[0] === 'open') answer({ title: 'Events', url: args[1] });
else if (args[0] === 'get' && args[1] === 'box') answer({ x: 1, y: 2, width: 3, height: 4 });
else answer({ result: true });
`
  );
  chmodSync(bin, 0o755);
  const browser = new Browser({ bin, key: '/repo/.git', storage: dir });

  it('GIVEN a repository WHEN the browser runs THEN it has its session, policy and untrusted-content markers', async () => {
    expect(await browser.version()).toBe('9.9.9');
    expect(await browser.open('http://localhost:5173/events')).toEqual({
      title: 'Events',
      url: 'http://localhost:5173/events'
    });

    const call = readFileSync(log, 'utf8').trim().split('\n').at(-1)!;
    expect(call).toMatch(
      /^open http:\/\/localhost:5173\/events \| AGENT_BROWSER_SESSION=review-[0-9a-f]{12} AGENT_BROWSER_NAMESPACE=talkthrough /
    );
    expect(call).toContain('AGENT_BROWSER_CONTENT_BOUNDARIES=1');
    // Sharp live view: Chrome at pixel ratio 2, frames not capped at the CSS width
    expect(call).toContain('AGENT_BROWSER_ARGS=--force-device-scale-factor=2');
    expect(call).toContain('AGENT_BROWSER_STREAM_MAX_WIDTH=4096');
    expect(JSON.parse(readFileSync(path.join(dir, 'policy.json'), 'utf8'))).toEqual({
      default: 'allow',
      deny: ['download', 'upload']
    });
  });

  it('GIVEN marks WHEN drawn on a target again THEN it keeps its number; a new page clears them', async () => {
    await browser.mark('@e2', 'The guard');
    await browser.mark('#email', 'Type here', 'action');
    await browser.mark('@e2', 'The guard, again');
    expect(browser.currentMarks.map(({ id, label }) => `${id} ${label}`)).toEqual([
      'm1 The guard, again',
      'm2 Type here'
    ]);

    await browser.open('/events/42');

    expect(browser.page?.url).toBe('http://localhost:5173/events/42');
    expect(browser.currentMarks).toEqual([]);
  });

  it('GIVEN a server that is down WHEN opened THEN Claude is told to ask for it', async () => {
    await expect(browser.open('http://127.0.0.1:9/')).rejects.toThrow(
      "Nothing answers at http://127.0.0.1:9/: check the port in the repository's dev setup (its dev script, framework config, .env), and if it is right, the app's server is not running. Ask the person to start it."
    );
  });
});
