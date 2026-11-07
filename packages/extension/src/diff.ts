/**
 * The PR's files in the editor: read-only documents for a revision (`talkthrough:` URIs), and
 * native diffs whose right side is the real file whenever it matches the PR head, so language
 * features (errors, lint, go to definition) work on it, as in Treeline.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PrFile, PrInfo } from '@talkthrough/shared';
import { fileAt } from './pr';
import { run } from './proc';

export const SCHEME = 'talkthrough';

/** `rev === ''` is an empty document (the missing side of an added or deleted file). */
export function revisionUri(repo: string, filePath: string, rev: string) {
  return vscode.Uri.from({
    scheme: SCHEME,
    path: '/' + filePath,
    query: JSON.stringify({ repo, rev })
  });
}

export class RevisionProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri) {
    const { repo, rev } = JSON.parse(uri.query) as { repo: string; rev: string };
    return rev ? fileAt(repo, rev, uri.path.slice(1)) : '';
  }
}

/** Whether the working tree's copy of `filePath` is the one at `rev`. */
export const isSameAsWorkingTree = async (repo: string, rev: string, filePath: string) =>
  (await run('git', ['diff', '--quiet', rev, '--', filePath], { cwd: repo, allowFailure: true }))
    .code === 0;

/** The file at the PR head: the real one when it matches, else a read-only copy. */
export async function headUri(pr: PrInfo, filePath: string) {
  const isReal = await isSameAsWorkingTree(pr.repo, pr.headSha, filePath);
  return isReal
    ? vscode.Uri.file(path.join(pr.repo, filePath))
    : revisionUri(pr.repo, filePath, pr.headSha);
}

/** Opens the PR diff of `file` and answers the editor of the side that holds its lines. */
export async function openPrDiff(pr: PrInfo, file: PrFile, column = vscode.ViewColumn.One) {
  const isAdded = file.changeType === 'ADDED';
  const isDeleted = file.changeType === 'DELETED';
  const left = revisionUri(pr.repo, file.previousPath ?? file.path, isAdded ? '' : pr.mergeBase);
  const right = isDeleted ? revisionUri(pr.repo, file.path, '') : await headUri(pr, file.path);
  const head = pr.kind === 'changes' ? 'your changes' : `PR #${pr.number}`;
  const side = right.scheme === 'file' ? `${head} = working tree` : head;
  const title = `${path.basename(file.path)} (base ↔ ${side})`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title, {
    preview: true,
    viewColumn: column
  });
  const target = (isDeleted ? left : right).toString();
  return (
    vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === target) ??
    vscode.window.activeTextEditor
  );
}
