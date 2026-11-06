/**
 * The store's README, from the repository's: the Development section left out, and relative links
 * and images made absolute (the Marketplace and Open VSX show them away from the repository).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const REPO = 'https://github.com/epavanello/talkthrough';
const RAW = 'https://raw.githubusercontent.com/epavanello/talkthrough/main';

const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
  .replace(/\n## Development\n[\s\S]*?(?=\n## )/, '\n')
  .replace(/(src="|\]\()((?:docs|packages)\/[^")]+)/g, `$1${RAW}/$2`)
  .replace(/\]\(((?:LICENSE|AGENTS\.md)[^)]*)\)/g, `](${REPO}/blob/main/$1)`);
writeFileSync(new URL('../README.md', import.meta.url), readme);
