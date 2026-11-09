/**
 * The webviews: the review chat (a view in the secondary side bar) and the browser panel, one bundle
 * mounting either, both talking to the host over typed RPC.
 */
import * as vscode from 'vscode';
import type { HostApi, HostEvent, RpcRequest, RpcResponse } from '@talkthrough/shared';

/** Answers a webview's RPC requests with `api`'s methods. */
export function serve(webview: vscode.Webview, api: object, log: vscode.LogOutputChannel) {
  return webview.onDidReceiveMessage(async ({ id, method, args }: RpcRequest) => {
    const reply: RpcResponse = { id };
    try {
      const call = (api as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
      if (!call) throw new Error(`Unknown method ${method}`);
      reply.result = await call(...args);
    } catch (error) {
      reply.error = (error as Error).message;
      log.warn(`${method} failed: ${reply.error}`);
    }
    void webview.postMessage(reply);
  });
}

/** The page of a webview: the chat, or the browser panel. */
export function html(webview: vscode.Webview, extensionUri: vscode.Uri, view: 'chat' | 'browser') {
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', file));
  const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    ''
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${asset('index.css')}" />
</head>
<body data-view="${view}">
  <div id="app"></div>
  <script type="module" nonce="${nonce}" src="${asset('index.js')}"></script>
</body>
</html>`;
}

export const webviewOptions = (extensionUri: vscode.Uri) => ({
  enableScripts: true,
  localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')]
});

/**
 * VS Code puts the chat in the secondary side bar; editors that don't take extensions there (Cursor
 * shows it among the files) get an activity bar icon of its own: `talkthrough.ownBar`.
 */
export const hasOwnBar = () => !/Visual Studio Code/i.test(vscode.env.appName);

/** Shows the chat, wherever this editor has it. */
export const focusChat = () =>
  vscode.commands.executeCommand(
    hasOwnBar() ? 'talkthrough.panel.focus' : 'talkthrough.chat.focus'
  );

export class ChatView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: HostApi,
    private readonly log: vscode.LogOutputChannel
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = html(view.webview, this.extensionUri, 'chat');
    serve(view.webview, this.api, this.log);
    view.onDidDispose(() => (this.view = null));
  }

  post(event: HostEvent) {
    void this.view?.webview.postMessage(event);
  }
}
