/**
 * The local HTTP server the review's Claude session talks to: its hooks (`/hook/<event>`, posted by
 * curl) and the stage's tools as a Streamable HTTP MCP server (`/mcp`, JSON responses, stateless).
 * Bound to 127.0.0.1, every request carries the session's bearer token. vscode-free.
 */
import { randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ServerHandlers {
  /** A hook's payload; what it resolves to is printed by curl, i.e. the hook's output. */
  hook(event: string, payload: Record<string, unknown>): Promise<unknown>;
  tools(): ToolSpec[];
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  instructions?: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const SERVER_INFO = { name: 'talkthrough', version: '0.1.0' };
const MAX_BODY = 8 * 1024 * 1024;

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json'
  });
  res.end(text);
}

export class ReviewServer {
  readonly token = randomBytes(24).toString('hex');
  private server: HttpServer | null = null;
  port = 0;

  constructor(private readonly handlers: ServerHandlers) {}

  async listen() {
    if (this.server) return;
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  close() {
    this.server?.close();
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    try {
      if (req.headers.authorization !== `Bearer ${this.token}`)
        return send(res, 401, 'unauthorized');
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/mcp') return await this.mcp(req, res);
      const hook = url.pathname.match(/^\/hook\/([\w-]+)$/);
      if (hook && req.method === 'POST') {
        const body = await readBody(req);
        let payload: Record<string, unknown> = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          payload = { raw: body };
        }
        const output = await this.handlers.hook(hook[1], payload);
        return output === undefined ? send(res, 200, '') : send(res, 200, output);
      }
      send(res, 404, 'not found');
    } catch (error) {
      send(res, 500, (error as Error).message);
    }
  }

  /** MCP over Streamable HTTP, stateless: a JSON answer per POST, no server-initiated stream. */
  private async mcp(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    let message: JsonRpcRequest | JsonRpcRequest[];
    try {
      message = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      });
    }
    const batch = Array.isArray(message) ? message : [message];
    const answers = (await Promise.all(batch.map((one) => this.answer(one)))).filter(
      (answer) => answer !== null
    );
    if (!answers.length) return send(res, 202);
    send(res, 200, Array.isArray(message) ? answers : answers[0]);
  }

  private async answer(request: JsonRpcRequest) {
    // A notification (no id) gets no answer
    if (request.id === undefined || request.id === null) return null;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: request.id, result });
    const fail = (code: number, message: string) => ({
      jsonrpc: '2.0',
      id: request.id,
      error: { code, message }
    });
    switch (request.method) {
      case 'initialize':
        return reply({
          protocolVersion: (request.params?.protocolVersion as string) ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          ...(this.handlers.instructions ? { instructions: this.handlers.instructions } : {})
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: this.handlers.tools() });
      case 'tools/call': {
        const name = String(request.params?.name ?? '');
        const args = (request.params?.arguments as Record<string, unknown>) ?? {};
        if (!this.handlers.tools().some((tool) => tool.name === name))
          return fail(-32602, `Unknown tool: ${name}`);
        try {
          const result = await this.handlers.callTool(name, args);
          return reply({
            content: [{ type: 'text', text: result.text }],
            isError: Boolean(result.isError)
          });
        } catch (error) {
          return reply({
            content: [{ type: 'text', text: (error as Error).message }],
            isError: true
          });
        }
      }
      default:
        return fail(-32601, `Method not found: ${request.method}`);
    }
  }
}
