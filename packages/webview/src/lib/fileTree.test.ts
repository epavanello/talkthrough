import { describe, expect, it } from 'vitest';
import { fileTree, filesIn, type Dir } from './fileTree';

const file = (path: string) => ({ path });
/** The tree as indented lines: folders end with '/', files don't. */
const lines = (dir: Dir<{ path: string }>, depth = 0): string[] => [
  ...dir.dirs.flatMap((child) => [
    `${'  '.repeat(depth)}${child.name}/`,
    ...lines(child, depth + 1)
  ]),
  ...dir.files.map((one) => `${'  '.repeat(depth)}${one.path.split('/').pop()}`)
];

describe('fileTree', () => {
  it('GIVEN files WHEN grouped THEN folders hold them and chains of single folders merge', () => {
    const tree = fileTree(
      [
        'src/lib/components/a.svelte',
        'src/lib/components/b.svelte',
        'src/lib/c.ts',
        'docs/x/y/z.md',
        'README.md'
      ].map(file)
    );

    expect(lines(tree)).toEqual([
      'src/lib/',
      '  components/',
      '    a.svelte',
      '    b.svelte',
      '  c.ts',
      'docs/x/y/',
      '  z.md',
      'README.md'
    ]);
    expect(tree.dirs[0].path).toBe('src/lib');
    expect(filesIn(tree.dirs[0]).map((one) => one.path)).toEqual([
      'src/lib/c.ts',
      'src/lib/components/a.svelte',
      'src/lib/components/b.svelte'
    ]);
  });
});
