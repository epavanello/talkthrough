/**
 * A unified diff (`git diff -M`) split into files and hunks, with the changed lines' range on the
 * side that still exists, and the compact rendering Claude reads. vscode-free.
 */
import { createHash } from 'node:crypto';
import type { ChangeType, Hunk, PrFile } from '@talkthrough/shared';

export interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  additions: number;
  deletions: number;
  /** First and last changed line on the new side (old side for a deleted file). */
  start: number;
  end: number;
  /** The hunk's body lines, ` `/`+`/`-` prefixed. */
  lines: string[];
}

export interface ParsedFile {
  path: string;
  oldPath: string;
  changeType: ChangeType;
  isBinary: boolean;
  hunks: ParsedHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

const withoutPrefix = (path: string, prefix: string) =>
  path.startsWith(prefix) ? path.slice(prefix.length) : path;

export function parsePatch(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let file: ParsedFile | null = null;
  let hunk: ParsedHunk | null = null;
  // Line numbers of the hunk being read, on each side
  let oldLine = 0;
  let newLine = 0;

  const finishHunk = () => {
    if (!hunk || !file) return;
    if (hunk.start === 0) {
      // Context only (shouldn't happen): the whole hunk
      hunk.start = file.changeType === 'DELETED' ? hunk.oldStart : hunk.newStart;
      hunk.end =
        hunk.start +
        Math.max(0, (file.changeType === 'DELETED' ? hunk.oldLines : hunk.newLines) - 1);
    }
    hunk = null;
  };

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      finishHunk();
      const names = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      file = {
        path: names?.[2] ?? '',
        oldPath: names?.[1] ?? '',
        changeType: 'MODIFIED',
        isBinary: false,
        hunks: []
      };
      files.push(file);
      continue;
    }
    if (!file) continue;

    const header = line.match(HUNK_HEADER);
    if (header) {
      finishHunk();
      hunk = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        header: header[5]?.trim() ?? '',
        additions: 0,
        deletions: 0,
        start: 0,
        end: 0,
        lines: []
      };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      file.hunks.push(hunk);
      continue;
    }

    if (!hunk) {
      if (line.startsWith('new file mode')) file.changeType = 'ADDED';
      else if (line.startsWith('deleted file mode')) file.changeType = 'DELETED';
      else if (line.startsWith('rename from ')) {
        file.oldPath = line.slice('rename from '.length);
        file.changeType = 'RENAMED';
      } else if (line.startsWith('rename to ')) file.path = line.slice('rename to '.length);
      else if (line.startsWith('Binary files ')) file.isBinary = true;
      else if (line.startsWith('--- ') && line !== '--- /dev/null')
        file.oldPath = withoutPrefix(line.slice(4), 'a/');
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null')
        file.path = withoutPrefix(line.slice(4), 'b/');
      continue;
    }

    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    hunk.lines.push(line);
    const isDeletedFile = file.changeType === 'DELETED';
    const mark = (at: number) => {
      hunk!.start = hunk!.start === 0 ? at : Math.min(hunk!.start, at);
      hunk!.end = Math.max(hunk!.end, at);
    };
    if (line.startsWith('+')) {
      hunk.additions++;
      mark(newLine);
      newLine++;
    } else if (line.startsWith('-')) {
      hunk.deletions++;
      // A deletion sits where the next new line is (at least line 1); a deleted file has only old lines
      mark(isDeletedFile ? oldLine : Math.max(1, newLine));
      oldLine++;
    } else {
      oldLine++;
      newLine++;
    }
  }
  finishHunk();
  return files;
}

/**
 * A hunk's key: its file and its changed lines, without context or line numbers, so the same change
 * has the same key wherever it moved. The same change twice in a file counts its copies.
 */
const keyOf = (path: string, lines: string[], seen: Map<string, number>) => {
  const changed = lines.filter((line) => line.startsWith('+') || line.startsWith('-'));
  const hash = createHash('sha1')
    .update(`${path}\n${changed.join('\n')}`)
    .digest('hex')
    .slice(0, 16);
  const copies = (seen.get(hash) ?? 0) + 1;
  seen.set(hash, copies);
  return copies > 1 ? `${hash}#${copies}` : hash;
};

/** Hunk ids and the files as the review state holds them. Files with no hunk get one for the whole file. */
export function indexPatch(parsed: ParsedFile[]) {
  const hunks: Record<string, Hunk> = {};
  const files: PrFile[] = [];
  let next = 1;
  for (const file of parsed) {
    const ids: string[] = [];
    const seen = new Map<string, number>();
    const add = (hunk: Omit<Hunk, 'id' | 'path' | 'key'>, lines: string[]) => {
      const id = `H${next++}`;
      hunks[id] = { id, path: file.path, ...hunk, key: keyOf(file.path, lines, seen) };
      ids.push(id);
    };
    for (const hunk of file.hunks)
      add(
        {
          start: hunk.start,
          end: hunk.end,
          header: hunk.header,
          additions: hunk.additions,
          deletions: hunk.deletions
        },
        hunk.lines
      );
    if (!ids.length)
      add(
        {
          start: 1,
          end: 1,
          header: file.isBinary ? 'binary file' : 'no content change',
          additions: 0,
          deletions: 0
        },
        [`+${file.changeType} ${file.oldPath}`]
      );
    files.push({
      path: file.path,
      previousPath: file.oldPath && file.oldPath !== file.path ? file.oldPath : null,
      changeType: file.changeType,
      additions: file.hunks.reduce((sum, hunk) => sum + hunk.additions, 0),
      deletions: file.hunks.reduce((sum, hunk) => sum + hunk.deletions, 0),
      hunks: ids
    });
  }
  return { files, hunks };
}

/** The diff as Claude reads it: each hunk headed by its id and its changed lines. */
export function renderPatch(parsed: ParsedFile[], files: PrFile[], hunks: Record<string, Hunk>) {
  const out: string[] = [];
  parsed.forEach((file, index) => {
    const indexed = files[index];
    const from = indexed.previousPath ? ` (from ${indexed.previousPath})` : '';
    out.push(
      `## ${file.path}${from} · ${file.changeType.toLowerCase()} · +${indexed.additions} −${indexed.deletions}`
    );
    if (!file.hunks.length) {
      const only = hunks[indexed.hunks[0]];
      out.push(`### ${only.id} · ${only.header}`, '');
      return;
    }
    file.hunks.forEach((hunk, at) => {
      const id = indexed.hunks[at];
      const side = file.changeType === 'DELETED' ? 'base' : 'head';
      const context = hunk.header ? ` · ${hunk.header}` : '';
      out.push(`### ${id} · ${side} L${hunk.start}-${hunk.end}${context}`, ...hunk.lines);
    });
    out.push('');
  });
  return out.join('\n');
}

/** Hunks of `path` whose changed lines overlap `start`–`end` (all of them without a range). */
export function hunksAt(
  files: PrFile[],
  hunks: Record<string, Hunk>,
  path: string,
  start: number | null,
  end: number | null
) {
  const file = files.find((one) => one.path === path || one.previousPath === path);
  if (!file) return [];
  if (start === null) return [...file.hunks];
  const last = end ?? start;
  return file.hunks.filter((id) => {
    const hunk = hunks[id];
    return hunk.start <= last && hunk.end >= start;
  });
}
