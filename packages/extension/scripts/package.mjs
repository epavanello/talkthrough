/**
 * Packages the extension. Each platform's .vsix carries agent-browser's binary, so the browser panel
 * needs nothing installed; a universal one without it serves the platforms left (agent-browser on
 * the PATH, if there).
 *
 *   node scripts/package.mjs          this platform's → talkthrough.vsix (bin/ keeps the binary)
 *   node scripts/package.mjs --all    every platform's and the universal → vsix/talkthrough-<target>.vsix
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, hostTarget, vendor } from './agent-browser.mjs';
import './readme.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin');
const vsce = (...args) =>
  execFileSync('vsce', ['package', '--no-dependencies', ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PATH: `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}`
    }
  });

if (process.argv.includes('--all')) {
  mkdirSync(path.join(root, 'vsix'), { recursive: true });
  for (const target of Object.keys(TARGETS)) {
    vendor(bin, target);
    vsce('--target', target, '--out', `vsix/talkthrough-${target}.vsix`);
  }
  vendor(bin, null);
  vsce('--out', 'vsix/talkthrough-universal.vsix');
} else {
  const target = hostTarget();
  vendor(bin, target);
  vsce(...(target ? ['--target', target] : []), '--out', 'talkthrough.vsix');
}
