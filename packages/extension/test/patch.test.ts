import { describe, expect, it } from 'vitest';
import { hunksAt, indexPatch, parsePatch, renderPatch } from '../src/patch';

const DIFF = `diff --git a/src/price.ts b/src/price.ts
index 1111111..2222222 100644
--- a/src/price.ts
+++ b/src/price.ts
@@ -10,6 +10,7 @@ export function resolvePrice(order: Order) {
 const a = 1;
 const b = 2;
 const c = 3;
-  return round(total);
+  const rounded = Math.ceil(total);
+  return rounded;
 const d = 4;
 const e = 5;
 const f = 6;
@@ -40,4 +41,3 @@ function helper() {
 one
-two
 three
 four
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-a
-b
-c
diff --git a/src/before.ts b/src/after.ts
similarity index 100%
rename from src/before.ts
rename to src/after.ts
`;

describe('parsePatch', () => {
  const files = parsePatch(DIFF);

  it('GIVEN a modified file WHEN parsed THEN each hunk spans its changed lines on the new side', () => {
    expect(files[0].changeType).toBe('MODIFIED');
    expect(
      files[0].hunks.map((hunk) => [hunk.start, hunk.end, hunk.additions, hunk.deletions])
    ).toEqual([
      [13, 14, 2, 1],
      [42, 42, 0, 1]
    ]);
    expect(files[0].hunks[0].header).toBe('export function resolvePrice(order: Order) {');
  });

  it('GIVEN added, deleted and renamed files WHEN parsed THEN their change types and ranges follow', () => {
    expect(files.map((file) => [file.path, file.oldPath, file.changeType])).toEqual([
      ['src/price.ts', 'src/price.ts', 'MODIFIED'],
      ['src/new.ts', 'src/new.ts', 'ADDED'],
      ['src/old.ts', 'src/old.ts', 'DELETED'],
      ['src/after.ts', 'src/before.ts', 'RENAMED']
    ]);
    expect([files[1].hunks[0].start, files[1].hunks[0].end]).toEqual([1, 2]);
    expect([files[2].hunks[0].start, files[2].hunks[0].end]).toEqual([1, 3]);
  });
});

describe('indexPatch', () => {
  const parsed = parsePatch(DIFF);
  const { files, hunks } = indexPatch(parsed);

  it('GIVEN parsed files WHEN indexed THEN hunks get ids in diff order and a rename gets one for the file', () => {
    expect(files.map((file) => file.hunks)).toEqual([['H1', 'H2'], ['H3'], ['H4'], ['H5']]);
    expect(hunks.H5).toMatchObject({ path: 'src/after.ts', header: 'no content change' });
    expect(files[3].previousPath).toBe('src/before.ts');
  });

  it('GIVEN a line range WHEN looking for hunks THEN only the overlapping ones come back', () => {
    expect(hunksAt(files, hunks, 'src/price.ts', 12, 13)).toEqual(['H1']);
    expect(hunksAt(files, hunks, 'src/price.ts', null, null)).toEqual(['H1', 'H2']);
    expect(hunksAt(files, hunks, 'src/before.ts', null, null)).toEqual(['H5']);
    expect(hunksAt(files, hunks, 'src/missing.ts', 1, 1)).toEqual([]);
  });

  it('GIVEN the index WHEN rendered for Claude THEN each hunk is headed by its id and lines', () => {
    const text = renderPatch(parsed, files, hunks);

    expect(text).toContain('### H1 · head L13-14 · export function resolvePrice(order: Order) {');
    expect(text).toContain('### H4 · base L1-3');
    expect(text).toContain('## src/after.ts (from src/before.ts) · renamed');
  });
});
