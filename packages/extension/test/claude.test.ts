import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeProcess, claudeArgs, plain, promptIn } from '../src/claude';

const BRIDGE = fileURLToPath(new URL('../resources/ptybridge.py', import.meta.url));

describe('claudeArgs', () => {
  const options = {
    port: 4321,
    token: 'secret',
    language: 'italian',
    model: 'sonnet',
    effort: 'high',
    systemPrompt: 'rules',
    name: 'Talkthrough · PR #1: Round prices up',
    sessionId: '0b7f6c1e-2f4a-4c55-9d1e-3a8b2c4d5e6f',
    disabledPlugins: ['earshot@earshot']
  };

  it('GIVEN launch options WHEN built THEN the session gets tap dictation, the hooks, the MCP server and no prompts', () => {
    const args = claudeArgs({ ...options, prompt: 'Prepare PR #1' });
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
    const mcp = JSON.parse(args[args.indexOf('--mcp-config') + 1]);

    expect(settings.voice).toEqual({ enabled: true, mode: 'tap' });
    expect(settings.language).toBe('italian');
    expect(settings.enabledPlugins).toEqual({ 'earshot@earshot': false });
    expect(Object.keys(settings.hooks)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'Stop'
    ]);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('/hook/stop');
    expect(mcp.mcpServers.talkthrough).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:4321/mcp',
      headers: { Authorization: 'Bearer secret' }
    });
    expect(args).toEqual(
      expect.arrayContaining(['--strict-mcp-config', '--permission-mode', 'dontAsk'])
    );
    expect(args.slice(-9)).toEqual([
      '--name',
      'Talkthrough · PR #1: Round prices up',
      '--model',
      'sonnet',
      '--effort',
      'high',
      '--session-id',
      options.sessionId,
      'Prepare PR #1'
    ]);
  });

  it('GIVEN a session to resume WHEN built THEN it goes on with it under its name, with no first prompt', () => {
    const args = claudeArgs({ ...options, model: '', effort: '', resume: true });

    expect(args.slice(-4)).toEqual(['--name', options.name, '--resume', options.sessionId]);
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--session-id');
  });
});

describe('plain', () => {
  it('GIVEN output drawn with cursor moves WHEN read THEN its words and lines are apart', () => {
    expect(
      plain('\x1b[?25hNo\x1b[4Gconversation\x1b[17Gfound\r\r\n\x1b[2G❯\x1b[4GNo,\x1b[8Gexit')
    ).toBe('No conversation found\n\n\n ❯ No, exit');
  });
});

describe('promptIn', () => {
  const RULE = '─'.repeat(40);
  const row = (text: string, isDim = false) => ({ text, isDim });

  it('GIVEN typed text in the input box WHEN read THEN it is the prompt', () => {
    expect(
      promptIn([row('  ⏵⏵ older'), row(RULE), row('❯ ciao come stai'), row(RULE), row('  ⏵⏵ mode')])
    ).toBe('ciao come stai');
  });

  it('GIVEN a prompt that wraps WHEN read THEN its lines join', () => {
    expect(promptIn([row(RULE), row('❯ una frase lunga'), row('  che va a capo'), row(RULE)])).toBe(
      'una frase lunga che va a capo'
    );
  });

  it('GIVEN the dim placeholder or the listening hint WHEN read THEN the prompt is empty', () => {
    expect(promptIn([row(RULE), row('❯ Try "create a util logging.py"', true), row(RULE)])).toBe(
      ''
    );
    expect(promptIn([row(RULE), row('❯ Listening', true), row(RULE)])).toBe('');
    expect(promptIn([row(RULE), row('❯ '), row(RULE)])).toBe('');
  });

  it('GIVEN a ❯ outside the input box (a menu) WHEN read THEN it is not the prompt', () => {
    expect(promptIn([row('Allow?'), row('❯ No, disable'), row('  Yes')])).toBe('');
  });
});

describe('ClaudeProcess', () => {
  let process: ClaudeProcess | null = null;
  afterEach(() => process?.dispose());

  const waitFor = async (check: () => boolean, timeout = 5000) => {
    const end = Date.now() + timeout;
    while (!check()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  it('GIVEN a command in the pseudo-terminal WHEN text is submitted THEN it reads it as typed', async () => {
    process = new ClaudeProcess(BRIDGE);
    process.start(
      ['sh', '-c', 'stty -echo; read line; echo "got:$line"; sleep 1'],
      '/tmp',
      globalThis.process.env
    );

    process.submit('ciao mondo');

    await waitFor(() => process!.screen.includes('got:ciao mondo'));
  });

  it('GIVEN a command WHEN the terminal is resized THEN the command sees the new size', async () => {
    process = new ClaudeProcess(BRIDGE);
    process.start(
      ['sh', '-c', 'sleep 0.3; stty size; sleep 1'],
      '/tmp',
      globalThis.process.env,
      100,
      30
    );

    process.resize(90, 25);

    await waitFor(() => process!.screen.includes('25 90'));
  });

  it('GIVEN a full-screen program WHEN it draws a prompt box THEN the emulated screen reads its text', async () => {
    process = new ClaudeProcess(BRIDGE);
    const box = `printf '\\033[2J\\033[1;1H%s\\r\\n❯ testo dal vivo\\r\\n%s\\r\\n' "$(printf '─%.0s' $(seq 30))" "$(printf '─%.0s' $(seq 30))"; sleep 1`;
    process.start(['sh', '-c', box], '/tmp', globalThis.process.env);

    await waitFor(() => process!.promptText() === 'testo dal vivo');
  });

  it('GIVEN a command WHEN it exits THEN the exit is reported with its code', async () => {
    process = new ClaudeProcess(BRIDGE);
    let code: number | null | undefined;
    process.onExit((exitCode) => (code = exitCode));
    process.start(['sh', '-c', 'exit 3'], '/tmp', globalThis.process.env);

    await waitFor(() => code !== undefined);

    expect(code).toBe(3);
  });
});
