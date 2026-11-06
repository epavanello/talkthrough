/**
 * The editor as Claude's stage: cues open the PR diff or any file and highlight lines, references
 * come from the language server and show in a peek. Also what the editor shows, for "this".
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Cue, PrFile, PrInfo } from '@talkthrough/shared';
import { SCHEME, headUri, openPrDiff } from './diff';

export interface StageContext {
  pr: PrInfo;
  files: PrFile[];
}

const MAX_REFERENCES = 50;
const DECLARATION =
  /^(\s*(?:(?:export|default|async|public|private|protected|static|readonly|override|abstract)\s+)*(?:function\*?\s+|const\s+|let\s+|var\s+|class\s+|interface\s+|type\s+|enum\s+|def\s+|fn\s+)?)([A-Za-z_$][\w$]*)/;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The column of `symbol` on a line, else of its first declared or used identifier. */
export function symbolColumn(line: string, symbol: string | null) {
  if (symbol) {
    const found = line.match(new RegExp(`(?<![\\w$])${escape(symbol)}(?![\\w$])`));
    if (found?.index !== undefined) return found.index;
  }
  const declared = line.match(DECLARATION);
  return declared ? declared[1].length : Math.max(0, line.search(/\S/));
}

function highlightType() {
  return vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
    borderColor: new vscode.ThemeColor('focusBorder'),
    borderStyle: 'solid',
    borderWidth: '0 0 0 3px',
    overviewRulerColor: new vscode.ThemeColor('focusBorder'),
    overviewRulerLane: vscode.OverviewRulerLane.Full
  });
}

export class Stage implements vscode.Disposable {
  /** The diff's highlight (column one) and the side file's (column two). */
  private readonly main = highlightType();
  private readonly side = highlightType();
  private readonly lit = new Map<vscode.TextEditorDecorationType, vscode.TextEditor>();

  constructor(private readonly context: () => StageContext | null) {}

  async run(cue: Cue) {
    const context = this.context();
    if (!context) return;
    if (cue.kind === 'show') await this.show(context, cue);
    else if (cue.kind === 'open') await this.open(context, cue);
    else await this.refs(context, cue);
  }

  private async show(context: StageContext, cue: Cue) {
    const file = context.files.find(
      (one) => one.path === cue.path || one.previousPath === cue.path
    );
    if (!file) return this.open(context, cue, vscode.ViewColumn.One);
    const editor = await openPrDiff(context.pr, file);
    if (editor) this.highlight(this.main, editor, cue.start, cue.end);
  }

  private async open(context: StageContext, cue: Cue, column = vscode.ViewColumn.Two) {
    const uri = await headUri(context.pr, cue.path);
    const editor = await vscode.window.showTextDocument(uri, {
      viewColumn: column,
      preserveFocus: true,
      preview: true
    });
    this.highlight(
      column === vscode.ViewColumn.One ? this.main : this.side,
      editor,
      cue.start,
      cue.end
    );
  }

  private async refs(context: StageContext, cue: Cue) {
    if (cue.start === null) return this.open(context, cue);
    const { uri, position } = await this.position(context, cue.path, cue.start, cue.symbol);
    const locations =
      (await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        position
      )) ?? [];
    const editor = await vscode.window.showTextDocument(uri, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: false,
      preview: true,
      selection: new vscode.Range(position, position)
    });
    this.highlight(this.side, editor, cue.start, cue.end);
    await vscode.commands.executeCommand(
      'editor.action.peekLocations',
      uri,
      position,
      locations,
      'peek'
    );
  }

  /** The references to a symbol, as text Claude reads. */
  async references(filePath: string, line: number, symbol: string | null) {
    const context = this.context();
    if (!context) return 'No review is running.';
    const { uri, position, text } = await this.position(context, filePath, line, symbol);
    const locations =
      (await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        position
      )) ?? [];
    const name = text.slice(position.character).match(/^[A-Za-z_$][\w$]*/)?.[0] ?? symbol ?? '?';
    if (!locations.length)
      return `No references found for ${name} at ${filePath}:${line} (the language server may still be starting).`;
    const lines = await Promise.all(
      locations.slice(0, MAX_REFERENCES).map(async (location) => {
        const where = this.relative(context, location.uri);
        const document = await vscode.workspace.openTextDocument(location.uri);
        const at = location.range.start.line;
        return `${where}:${at + 1}: ${document.lineAt(at).text.trim().slice(0, 160)}`;
      })
    );
    const more =
      locations.length > MAX_REFERENCES ? `\n… ${locations.length - MAX_REFERENCES} more` : '';
    const note = context.pr.isLive
      ? ''
      : '\n(The checkout is not at the PR head: these come from the working tree.)';
    return `${locations.length} references to ${name}:\n${lines.join('\n')}${more}${note}`;
  }

  /** Where `symbol` is on `line` of the working tree's file, the one language servers read. */
  private async position(
    context: StageContext,
    filePath: string,
    line: number,
    symbol: string | null
  ) {
    const uri = vscode.Uri.file(path.join(context.pr.repo, filePath));
    const document = await vscode.workspace.openTextDocument(uri);
    const index = Math.min(Math.max(line - 1, 0), document.lineCount - 1);
    const text = document.lineAt(index).text;
    return { uri, position: new vscode.Position(index, symbolColumn(text, symbol)), text };
  }

  private relative(context: StageContext, uri: vscode.Uri) {
    if (uri.scheme === SCHEME) return uri.path.slice(1);
    const relative = path.relative(context.pr.repo, uri.fsPath);
    return relative.startsWith('..') ? uri.fsPath : relative;
  }

  private highlight(
    type: vscode.TextEditorDecorationType,
    editor: vscode.TextEditor,
    start: number | null,
    end: number | null
  ) {
    const previous = this.lit.get(type);
    if (previous && previous !== editor) previous.setDecorations(type, []);
    this.lit.set(type, editor);
    if (start === null) {
      editor.setDecorations(type, []);
      return;
    }
    const last = editor.document.lineCount - 1;
    const first = Math.min(Math.max(start - 1, 0), last);
    const final = Math.min(Math.max((end ?? start) - 1, first), last);
    const range = new vscode.Range(first, 0, final, editor.document.lineAt(final).text.length);
    editor.setDecorations(type, [range]);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /** What the person is looking at: file, side, visible lines and selection. */
  describeFocus(context: StageContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const { uri } = editor.document;
    let side = 'working tree';
    if (uri.scheme === SCHEME) {
      const { rev } = JSON.parse(uri.query) as { rev: string };
      side =
        rev === context.pr.mergeBase ? 'base side of the PR diff' : rev ? 'PR head' : 'empty side';
    } else if (uri.scheme !== 'file') return null;
    const file = this.relative(context, uri);
    if (path.isAbsolute(file)) return null;
    const visible = editor.visibleRanges[0];
    const lines = visible
      ? `, lines ${visible.start.line + 1}-${visible.end.line + 1} visible`
      : '';
    const selection = editor.selection;
    const selected = selection.isEmpty
      ? ''
      : `; selected L${selection.start.line + 1}-${selection.end.line + 1}: "${editor.document
          .getText(selection)
          .replace(/\s+/g, ' ')
          .slice(0, 300)}"`;
    return `${file} (${side})${lines}${selected}`;
  }

  dispose() {
    this.main.dispose();
    this.side.dispose();
  }
}
