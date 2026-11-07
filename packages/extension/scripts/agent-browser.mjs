/**
 * agent-browser's binaries, for the browser panel. The npm package (a pinned devDependency) carries
 * every platform's; each .vsix gets its own, with agent-browser's licenses.
 */
import { chmodSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const root = path.dirname(createRequire(import.meta.url).resolve('agent-browser/package.json'));

/** VS Code's platform targets and agent-browser's binary for each: Windows on Arm runs the x64 one. */
export const TARGETS = {
  'darwin-arm64': 'agent-browser-darwin-arm64',
  'darwin-x64': 'agent-browser-darwin-x64',
  'linux-x64': 'agent-browser-linux-x64',
  'linux-arm64': 'agent-browser-linux-arm64',
  'alpine-x64': 'agent-browser-linux-musl-x64',
  'alpine-arm64': 'agent-browser-linux-musl-arm64',
  'win32-x64': 'agent-browser-win32-x64.exe',
  'win32-arm64': 'agent-browser-win32-x64.exe'
};

/** This machine's target, null when agent-browser has no binary for it. */
export const hostTarget = () => {
  const target = `${process.platform}-${process.arch}`;
  return target in TARGETS ? target : null;
};

/**
 * Puts a target's binary (`agent-browser`, `.exe` on Windows) and its licenses in `dir`, emptied
 * first; no target leaves it empty. Returns the binary's path.
 */
export function vendor(dir, target) {
  rmSync(dir, { recursive: true, force: true });
  if (!target) return null;
  mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, target.startsWith('win32') ? 'agent-browser.exe' : 'agent-browser');
  copyFileSync(path.join(root, 'bin', TARGETS[target]), binary);
  chmodSync(binary, 0o755);
  copyFileSync(path.join(root, 'LICENSE'), path.join(dir, 'LICENSE-agent-browser.txt'));
  for (const file of ['LICENSE-axe-core.txt', 'LICENSE-axe-core-THIRD-PARTY.txt'])
    copyFileSync(path.join(root, 'cli', 'src', 'native', 'a11y', file), path.join(dir, file));
  return binary;
}
