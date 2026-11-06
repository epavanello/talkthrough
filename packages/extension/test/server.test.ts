import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewServer } from '../src/server';
import { TOOLS, mapProblems } from '../src/tools';

describe('ReviewServer', () => {
  let server: ReviewServer | null = null;
  const hook = vi.fn(async (event: string) =>
    event === 'prompt' ? { added: 'context' } : undefined
  );
  const callTool = vi.fn(async (name: string) => ({ text: `called ${name}` }));

  const start = async () => {
    server = new ReviewServer({ hook, tools: () => TOOLS, callTool });
    await server.listen();
    return server;
  };
  const post = (path: string, body: unknown, token = server!.token) =>
    fetch(`http://127.0.0.1:${server!.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  const rpc = async (method: string, params?: unknown, id = 1) =>
    (await post('/mcp', { jsonrpc: '2.0', id, method, params })).json();

  afterEach(() => {
    server?.close();
    server = null;
    vi.clearAllMocks();
  });

  it('GIVEN no token WHEN posting THEN it is refused', async () => {
    await start();

    expect((await post('/hook/prompt', {}, 'wrong')).status).toBe(401);
  });

  it('GIVEN an MCP client WHEN it initializes THEN the protocol version it asked for comes back', async () => {
    await start();

    const reply = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {} });

    expect(reply.result.protocolVersion).toBe('2025-11-25');
    expect(reply.result.capabilities.tools).toBeDefined();
  });

  it('GIVEN a notification WHEN posted THEN it is accepted with no body', async () => {
    await start();

    const response = await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });

    expect(response.status).toBe(202);
  });

  it('GIVEN the tools WHEN listed and called THEN the stage answers', async () => {
    await start();

    const list = await rpc('tools/list');
    const call = await rpc('tools/call', { name: 'pr_overview', arguments: {} }, 2);

    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toContain('set_map');
    expect(call.result).toEqual({
      content: [{ type: 'text', text: 'called pr_overview' }],
      isError: false
    });
  });

  it('GIVEN a hook WHEN posted THEN its handler gets the payload and its answer is the body', async () => {
    await start();

    const response = await post('/hook/prompt', { prompt: 'ciao' });

    expect(hook).toHaveBeenCalledWith('prompt', { prompt: 'ciao' });
    expect(await response.json()).toEqual({ added: 'context' });
  });
});

describe('mapProblems', () => {
  it('GIVEN unknown, repeated and missing hunks WHEN checked THEN each is reported', () => {
    const problems = mapProblems(
      {
        blocks: [
          { title: 'A', hunks: ['H1', 'H9'] },
          { title: 'B', hunks: ['H1'] }
        ]
      },
      ['H1', 'H2']
    );

    expect(problems).toEqual([
      'Unknown hunk H9 in "A".',
      'H1 is in both "A" and "B".',
      'Not in any block: H2.'
    ]);
  });
});
