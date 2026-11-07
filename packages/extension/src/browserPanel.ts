/**
 * The browser panel: agent-browser's live view of the app, beside the code. Frames come from its
 * stream, a WebSocket only local clients may open, so the host relays them; the person's mouse and
 * keys go back the same way. Claude and the person use one page.
 */
import * as vscode from 'vscode';
import type { BrowserApi, BrowserInput, HostEvent } from '@talkthrough/shared';
import { QUIET, describeCommand, type Browser } from './browser';
import { html, serve, webviewOptions } from './view';

export class BrowserPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private socket: WebSocket | null = null;
  private isConnecting = false;
  private retry: NodeJS.Timeout | undefined;
  private isLive = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly browser: () => Browser | null,
    private readonly log: vscode.LogOutputChannel,
    private readonly onChange: () => void
  ) {}

  get isShown() {
    return this.panel !== null;
  }

  /** Shows the panel beside the code, and its live view. */
  show(preserveFocus = true) {
    if (this.panel) this.panel.reveal(vscode.ViewColumn.Two, preserveFocus);
    else this.create(preserveFocus);
    void this.connect();
    this.onChange();
  }

  toggle() {
    if (this.panel) this.panel.dispose();
    else this.show(false);
  }

  private require() {
    const browser = this.browser();
    if (!browser) throw new Error('The browser is off.');
    return browser;
  }

  private create(preserveFocus: boolean) {
    const panel = vscode.window.createWebviewPanel(
      'talkthrough.browser',
      'Browser',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus },
      { ...webviewOptions(this.extensionUri), retainContextWhenHidden: true }
    );
    panel.webview.html = html(panel.webview, this.extensionUri, 'browser');
    const api: BrowserApi = {
      connect: async () => {
        await this.connect();
        return this.view();
      },
      navigate: async (url) => {
        await this.require().open(url);
        await this.connect();
      },
      go: async (action) => {
        await this.require().act(action);
      },
      input: async (event) => this.send(event),
      resize: (width, height, scale) => this.require().resize(width, height, scale),
      insertText: (text) => this.require().insertText(text),
      edit: async (command) => {
        const browser = this.require();
        if (command === 'copy' || command === 'cut') {
          const text = await browser.selectedText();
          if (!text) return;
          await vscode.env.clipboard.writeText(text);
          if (command === 'cut') await browser.execCommand('delete');
        } else await browser.execCommand(command);
      },
      showMark: (id) => this.require().showMark(id),
      clearMarks: () => this.require().clearMarks()
    };
    const subscription = serve(panel.webview, api, this.log);
    panel.onDidDispose(() => {
      subscription.dispose();
      this.panel = null;
      this.disconnect();
      this.onChange();
    });
    this.panel = panel;
  }

  private view() {
    const browser = this.browser();
    const marks = (browser?.currentMarks ?? []).map(({ id, label, kind }) => ({ id, label, kind }));
    return { page: browser?.page ?? null, marks };
  }

  /** The page and marks changed: the panel shows them. */
  update() {
    this.post({ event: 'browser', ...this.view(), isLive: this.isLive });
  }

  private post(event: HostEvent) {
    void this.panel?.webview.postMessage(event);
  }

  /** Opens the live view once there is a page to show. */
  private async connect() {
    const browser = this.browser();
    if (!this.panel || !browser?.page || this.socket || this.isConnecting) return;
    this.isConnecting = true;
    clearTimeout(this.retry);
    try {
      const port = await browser.streamPort();
      const socket = new WebSocket(`ws://127.0.0.1:${port}/?pacing=ack&maxFps=12`);
      this.socket = socket;
      socket.onopen = () => {
        this.isLive = true;
        this.update();
      };
      socket.onmessage = (event) => this.receive(socket, String(event.data));
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.isLive = false;
        this.update();
        if (this.panel) this.retry = setTimeout(() => void this.connect(), 2000);
      };
    } catch (error) {
      this.log.warn(`Browser stream: ${(error as Error).message}`);
      if (this.panel) this.retry = setTimeout(() => void this.connect(), 4000);
    } finally {
      this.isConnecting = false;
    }
  }

  private receive(socket: WebSocket, text: string) {
    let message: {
      type?: string;
      seq?: number;
      data?: string;
      metadata?: Record<string, number>;
      action?: string;
      params?: Record<string, unknown>;
    };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.type === 'frame') {
      this.post({
        event: 'frame',
        data: message.data ?? '',
        width: message.metadata?.deviceWidth ?? 0,
        height: message.metadata?.deviceHeight ?? 0
      });
      socket.send(JSON.stringify({ type: 'ack', seq: message.seq }));
    } else if (message.type === 'url') {
      // A click or a redirect moved the page: the address bar and Claude's context follow
      void this.browser()?.refresh();
    } else if (message.type === 'command' && message.action && !QUIET.has(message.action)) {
      this.post({ event: 'activity', text: describeCommand(message) });
    }
  }

  private send(event: BrowserInput) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private disconnect() {
    clearTimeout(this.retry);
    const socket = this.socket;
    this.socket = null;
    this.isLive = false;
    socket?.close();
  }

  dispose() {
    this.panel?.dispose();
    this.disconnect();
  }
}
