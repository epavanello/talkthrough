import { defineConfig } from '@vscode/test-cli';

// e2e/*.test.ts, bundled by `pnpm e2e` (vscode stays external, so the tests share the extension's API object)
export default defineConfig({
  files: '.cache/e2e/*.test.cjs',
  // Pinned so the copy already in .vscode-test is used instead of downloading the latest stable
  version: '1.144.0',
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'bdd', timeout: 90_000 }
});
