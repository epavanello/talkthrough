/** The review chat: a webview view in the secondary side bar, talking to the host over typed RPC. */
import * as vscode from 'vscode';
import type { HostApi, HostEvent, RpcRequest, RpcResponse } from '@talkthrough/shared';

export class ChatView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: HostApi,
    private readonly log: vscode.LogOutputChannel
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')]
    };
    view.webview.html = html(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage(async ({ id, method, args }: RpcRequest) => {
      const reply: RpcResponse = { id };
      try {
        reply.result = await (this.api[method] as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (error) {
        reply.error = (error as Error).message;
        this.log.warn(`${method} failed: ${reply.error}`);
      }
      void view.webview.postMessage(reply);
    });
    view.onDidDispose(() => (this.view = null));
  }

  post(event: HostEvent) {
    void this.view?.webview.postMessage(event);
  }
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri) {
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
<body>
  <div id="app"></div>
  <script type="module" nonce="${nonce}" src="${asset('index.js')}"></script>
</body>
</html>`;
}
