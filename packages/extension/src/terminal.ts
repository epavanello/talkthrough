/** Claude's session made visible: a terminal mirroring its pseudo-terminal, keys typed go to it. */
import * as vscode from 'vscode';
import type { ClaudeProcess } from './claude';

export class MirrorTerminal implements vscode.Disposable {
  private terminal: vscode.Terminal | null = null;
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Whether it was last shown rather than hidden (the panel's own state isn't readable). */
  isShown = false;

  constructor(private readonly onChange: () => void) {
    this.subscriptions.push(
      vscode.window.onDidCloseTerminal((closed) => {
        if (closed !== this.terminal) return;
        this.terminal = null;
        this.set(false);
      }),
      // Another terminal brought to the front hides this one
      vscode.window.onDidChangeActiveTerminal((active) => {
        if (this.terminal && active && active !== this.terminal) this.set(false);
      })
    );
  }

  /** Shows it, or hides it when it is the one shown. */
  toggle(claude: ClaudeProcess, name: string) {
    if (this.terminal && this.isShown) {
      this.terminal.hide();
      this.set(false);
      return;
    }
    this.show(claude, name);
  }

  show(claude: ClaudeProcess, name: string) {
    if (!this.terminal) this.terminal = this.create(claude, name);
    this.terminal.show();
    this.set(true);
  }

  private create(claude: ClaudeProcess, name: string) {
    const write = new vscode.EventEmitter<string>();
    let unsubscribe = () => {};
    const pty: vscode.Pseudoterminal = {
      onDidWrite: write.event,
      open: (dimensions) => {
        write.fire(claude.output);
        unsubscribe = claude.onOutput((data) => write.fire(data));
        // Claude redraws on resize: the screen comes back whole
        if (dimensions) claude.resize(dimensions.columns, dimensions.rows);
      },
      close: () => {
        unsubscribe();
        write.dispose();
      },
      handleInput: (data) => claude.write(data),
      setDimensions: (dimensions) => claude.resize(dimensions.columns, dimensions.rows)
    };
    return vscode.window.createTerminal({
      name,
      pty,
      iconPath: new vscode.ThemeIcon('comment-discussion')
    });
  }

  private set(isShown: boolean) {
    if (this.isShown === isShown) return;
    this.isShown = isShown;
    this.onChange();
  }

  /** Closes it: its Claude process is gone. */
  close() {
    this.terminal?.dispose();
    this.terminal = null;
    this.set(false);
  }

  dispose() {
    this.close();
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }
}
