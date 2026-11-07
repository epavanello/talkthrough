import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { TalkthroughApi } from '../src/extension';

/** e2e/fake-claude.mjs, from the bundled test in .cache/e2e. */
const FAKE_CLAUDE = path.resolve(__dirname, '../../e2e/fake-claude.mjs');
/** e2e/fake-agent-browser.mjs: the browser panel's CLI. */
const FAKE_AGENT_BROWSER = path.resolve(__dirname, '../../e2e/fake-agent-browser.mjs');
const BROWSER_LOG = path.join(tmpdir(), `talkthrough-ab-${process.pid}.log`);
/** What the fake's dictation hears, when the file is there (FAKE_CLAUDE_DICTATION). */
const DICTATION = path.join(tmpdir(), `talkthrough-dictation-${process.pid}.txt`);
process.env.FAKE_CLAUDE_DICTATION = DICTATION;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'e2e',
  GIT_AUTHOR_EMAIL: 'e2e@example.com',
  GIT_COMMITTER_NAME: 'e2e',
  GIT_COMMITTER_EMAIL: 'e2e@example.com'
};
const gitIn = (repo: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: repo, env: GIT_ENV, encoding: 'utf8' }).trim();
const writeIn = (repo: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), text);
};

/** A repository with two commits, `base` and `tip` (checked out), as a PR would have them. */
function fixtureRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), 'talkthrough-e2e-'));
  const git = (...args: string[]) => gitIn(repo, ...args);
  const write = (file: string, text: string) => writeIn(repo, file, text);
  git('init', '-q', '-b', 'main');
  write(
    'src/price.ts',
    'export function resolvePrice(total: number) {\n  return Math.round(total);\n}\n'
  );
  write(
    'src/orders.ts',
    "import { resolvePrice } from './price';\n\nexport const save = (total: number) => resolvePrice(total);\n"
  );
  write('src/old.ts', 'export const legacy = true;\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('tag', 'base');
  write(
    'src/price.ts',
    'export function resolvePrice(total: number) {\n  return Math.ceil(total);\n}\n'
  );
  write('src/new.ts', 'export const added = 1;\n');
  rmSync(path.join(repo, 'src/old.ts'));
  git('add', '-A');
  git('commit', '-qm', 'head');
  git('tag', 'tip'); // not 'head': on a case-insensitive disk, git would read it as HEAD
  return repo;
}

describe('Talkthrough review session', function () {
  this.timeout(90_000);
  let api: TalkthroughApi;
  let repo: string;
  const state = () => api.session.state;
  const lastClaude = () =>
    [...state().messages].reverse().find((message) => message.role === 'claude');

  const until = async (check: () => boolean, what: string, timeout = 20_000) => {
    const end = Date.now() + timeout;
    while (!check()) {
      if (Date.now() > end) {
        const messages = state().messages.map((message) => `${message.role}: ${message.text}`);
        throw new Error(
          `Timed out waiting for ${what} (status ${state().status}): ${JSON.stringify(messages)}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  before(async () => {
    const extension = vscode.extensions.getExtension<TalkthroughApi>('epavanello.talkthrough');
    assert.ok(extension, 'the extension is installed');
    api = await extension.activate();
    await api.forget();
    process.env.FAKE_AGENT_BROWSER_LOG = BROWSER_LOG;
    await vscode.workspace
      .getConfiguration('talkthrough')
      .update('browser.path', FAKE_AGENT_BROWSER, vscode.ConfigurationTarget.Global);
    repo = fixtureRepo();
  });

  after(async () => {
    await vscode.workspace
      .getConfiguration('talkthrough')
      .update('browser.path', undefined, vscode.ConfigurationTarget.Global);
    rmSync(BROWSER_LOG, { force: true });
    rmSync(`${BROWSER_LOG}.json`, { force: true });
    api.session.end();
    rmSync(repo, { recursive: true, force: true });
  });

  it('GIVEN a PR WHEN the review starts THEN Claude prepares it and draws the map', async () => {
    await api.startLocal(
      { repo, base: 'base', head: 'tip', number: 7, title: 'Round prices up' },
      { claudeCommand: ['node', FAKE_CLAUDE], isSpeechOn: false }
    );

    await until(() => state().blocks.length > 0 && state().status === 'ready', 'the map');

    assert.equal(state().pr?.isLive, true);
    assert.deepEqual(
      state().files.map((file) => [file.path, file.changeType]),
      [
        ['src/new.ts', 'ADDED'],
        ['src/old.ts', 'DELETED'],
        ['src/price.ts', 'MODIFIED']
      ]
    );
    assert.deepEqual(
      state().blocks.map((block) => block.title),
      ['Price rounding', 'Everything else']
    );
    assert.equal(state().hotspots[0]?.title, 'Callers of resolvePrice');
    assert.ok(state().messages[0].text.startsWith('Prepare the review of PR #7'));
    assert.equal(
      state().messages[0].isAuto,
      true,
      "the kickoff is Talkthrough's, not the person's"
    );
    assert.equal(
      lastClaude()?.text,
      'La PR arrotonda i prezzi per eccesso. La mappa ha due blocchi.'
    );
    for (const step of [
      'Loading the pull request',
      'Starting Claude',
      'Reading the overview',
      'Drawing the map'
    ])
      assert.ok(
        state().trail.includes(step),
        `the trail shows "${step}": ${state().trail.join(', ')}`
      );
    await until(
      () => state().reviews.some((review) => review.number === 7 && review.total === 3),
      'the kept review'
    );
  });

  it('GIVEN the map WHEN Next is pressed THEN the diff opens on the real file and its hunk is explained', async () => {
    api.session.next();

    await until(() => state().step.length > 0, 'the step');
    await until(
      () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some(
            (tab) =>
              tab.input instanceof vscode.TabInputTextDiff && tab.label.startsWith('price.ts')
          ),
      'the diff of price.ts'
    );
    await until(
      () =>
        vscode.window.visibleTextEditors.some((editor) =>
          editor.document.uri.fsPath.endsWith('orders.ts')
        ),
      'orders.ts beside'
    );

    const priceHunk = state().files.find((file) => file.path === 'src/price.ts')!.hunks[0];
    assert.deepEqual(state().step, [priceHunk]);
    assert.equal(state().coverage[priceHunk], 'explained');
    const diff = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((tab) => tab.input instanceof vscode.TabInputTextDiff)!
      .input as vscode.TabInputTextDiff;
    assert.equal(diff.modified.scheme, 'file', 'the right side is the real file');
    assert.equal(lastClaude()?.sentences.length, 2);
  });

  it('GIVEN an explained step WHEN Next is pressed again THEN its hunks are ok and Claude is told', async () => {
    const step = [...state().step];
    const replies = state().messages.length;

    api.session.next();

    assert.ok(step.every((id) => state().coverage[id] === 'ok'));
    assert.deepEqual(state().step, []);
    await until(() => state().messages.length >= replies + 2, 'the reply to Next');
  });

  it('GIVEN a typed question WHEN sent THEN Claude gets it with the editor context', async () => {
    api.session.send('Dove viene chiamata resolvePrice?');

    await until(
      () => lastClaude()?.text.startsWith('Hai chiesto: Dove viene chiamata') ?? false,
      'the answer'
    );

    assert.ok(
      lastClaude()!.text.includes('La chiama src/orders.ts:3:'),
      `the search found the caller: ${lastClaude()!.text}`
    );
  });

  it('GIVEN the app WHEN Claude shows it THEN the browser panel opens the page and marks it, then the cues replay', async () => {
    api.session.send('Mostrami il bottone nel browser');

    await until(() => lastClaude()?.text.includes('Ecco la pagina') ?? false, 'the reply');
    const calls = () => readFileSync(BROWSER_LOG, 'utf8').trim().split('\n');
    assert.ok(calls().includes('open http://127.0.0.1:4173/events/42'), calls().join('\n'));
    assert.ok(calls().includes('get box @e2'));
    assert.equal(state().browser?.page?.url, 'http://127.0.0.1:4173/events/42');
    // The link keeps its full address, whatever page is open later
    const link = lastClaude()!
      .sentences.flatMap((sentence) => sentence.parts)
      .find((part) => part.type === 'cue' && part.cue.kind === 'page');
    assert.equal(link?.type === 'cue' && link.cue.path, 'http://127.0.0.1:4173/events/42');
    // The tool's mark, then the reply's cue on the same element: one mark, as the voice left it
    await until(
      () =>
        JSON.stringify(state().browser?.marks.map((mark) => [mark.label, mark.kind])) ===
        '[["Clicca qui","action"]]',
      "the reply's mark cue"
    );
    assert.ok(calls().some((call) => call.startsWith('eval') && call.includes('"kind":"change"')));
    await until(
      () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some((tab) => tab.label === 'Browser'),
      'the browser panel beside the code'
    );
    assert.equal(state().browser?.isShown, true);

    const before = calls().length;
    api.session.play(lastClaude()!.id, 0);

    await until(
      () =>
        calls()
          .slice(before)
          .some((call) => call.startsWith('eval') && call.includes('"kind":"action"')),
      'the cues played again: the page stays, the mark is drawn again'
    );
    assert.ok(
      !calls()
        .slice(before)
        .some((call) => call.startsWith('open')),
      'the open page is not reloaded'
    );
    // The reply kept the mark's selector in place of its @ref: a replay or a reload finds it
    assert.ok(
      lastClaude()!.text.includes('[[mark #confirm action: Clicca qui]]'),
      lastClaude()!.text
    );
    assert.ok(calls().slice(before).includes('get box #confirm'), 'the replay marks by selector');
  });

  it("GIVEN the mic WHEN pressed twice THEN Claude's dictation sends a dictated prompt", async () => {
    api.session.toggleMic();
    assert.equal(state().isRecording, true);
    assert.equal(state().status, 'recording');
    await until(
      () => state().draft === 'parole dettate dal test',
      'the words heard, read from its prompt'
    );

    api.session.toggleMic();

    await until(
      () =>
        state().messages.some((message) => message.role === 'user' && message.isDictated === true),
      'the dictated prompt'
    );
    await until(() => lastClaude()?.text.includes('Domanda dettata') ?? false, 'the answer to it');
  });

  it('GIVEN a dictation under three words WHEN Claude Code leaves it in its prompt THEN it is sent anyway', async () => {
    writeFileSync(DICTATION, 'Fatto.');
    try {
      const drafts = new Set<string>();
      api.session.toggleMic();
      await until(() => {
        drafts.add(state().draft);
        return state().draft === 'parole dettate dal test';
      }, 'the words heard');
      // Claude Code shows the last dictation again until it hears new words: not what is said
      assert.ok(!drafts.has('Domanda dettata sul prezzo'), [...drafts].join(' | '));
      api.session.toggleMic();

      await until(
        () =>
          state().messages.some(
            (message) => message.role === 'user' && message.text === 'Fatto.' && message.isDictated
          ),
        'the short dictated prompt'
      );
      await until(() => state().status === 'ready', 'the chat free again');
    } finally {
      rmSync(DICTATION, { force: true });
    }
  });

  it('GIVEN a dictation WHEN cancelled THEN nothing is sent and the chat is free again', async () => {
    const messages = state().messages.length;
    api.session.toggleMic();
    await until(() => state().draft === 'parole dettate dal test', 'the words heard');

    api.session.cancelMic();

    assert.equal(state().isRecording, false);
    assert.equal(state().status, 'ready');
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(state().messages.length, messages);
  });

  it('GIVEN a running turn WHEN stopped THEN the chat is free again and the next prompt arrives alone', async () => {
    const replies = state().messages.filter((message) => message.role === 'claude').length;
    api.session.send('Rispondi in modo lento');
    await until(
      () => state().messages.some((message) => message.text === 'Rispondi in modo lento'),
      'the slow prompt'
    );
    assert.equal(state().status, 'thinking');

    api.session.interrupt();

    assert.equal(state().status, 'ready');
    assert.equal(state().messages.at(-1)?.text, 'Interrupted.');
    await new Promise((resolve) => setTimeout(resolve, 600)); // the input is emptied 400 ms after Esc
    api.session.send('Dopo lo stop');
    await until(
      () => lastClaude()?.text.startsWith('Hai chiesto: Dopo lo stop.') ?? false,
      'the next answer'
    );
    assert.equal(
      state().messages.filter((message) => message.role === 'claude').length,
      replies + 1
    );
  });

  it('GIVEN hunks marked ok WHEN the review starts over THEN every hunk is to review again', async () => {
    const ids = Object.keys(state().hunks);
    api.session.setHunks(ids, 'ok');
    assert.ok(ids.every((id) => state().coverage[id] === 'ok'));

    await api.session.reset();

    assert.ok(ids.every((id) => state().coverage[id] === 'todo'));
    assert.deepEqual(state().step, []);
    assert.equal(state().messages.at(-1)?.text, 'Started over: every hunk is to review again.');
  });

  it("GIVEN the session WHEN the terminal button is pressed twice THEN Claude's terminal shows, then hides", async () => {
    api.session.toggleTerminal();
    assert.equal(state().isTerminalShown, true);
    assert.ok(vscode.window.terminals.some((terminal) => terminal.name === 'Claude · PR #7'));

    api.session.toggleTerminal();

    assert.equal(state().isTerminalShown, false);
  });

  it('GIVEN a running session WHEN another model is picked THEN the same session goes on with it', async () => {
    const messages = state().messages.length;

    await api.session.choose('model', 'haiku');

    await until(
      () => state().model === 'claude-haiku-fake' && state().status === 'ready',
      'the session on haiku'
    );
    assert.equal(state().choices.model, 'haiku');
    assert.ok(state().messages.length >= messages, 'the chat is kept');
    await api.session.choose('effort', 'high');
    await until(() => state().model === 'claude-haiku-fake@high', 'the session on high effort');
    await api.session.choose('model', '');
    await api.session.choose('effort', '');
    await until(() => state().model === 'claude-default-fake', 'the default model again');
  });

  it('GIVEN a review WHEN the window reopens THEN it shows as saved and Resume goes on with its session', async () => {
    const coverage = { ...state().coverage };
    const texts = state().messages.map((message) => message.text);
    api.session.end();

    const reopened = await api.reopen();
    try {
      assert.equal(reopened.state.status, 'paused');
      assert.deepEqual(
        reopened.state.messages.map((message) => message.text),
        texts
      );
      assert.deepEqual(reopened.state.coverage, coverage);
      assert.equal(reopened.state.blocks.length, 2);

      await reopened.resume({ claudeCommand: ['node', FAKE_CLAUDE], isSpeechOn: false });
      await until(() => reopened.state.status === 'ready', 'the resumed session');
      reopened.send('Ti ricordi la PR?');
      await until(
        () =>
          reopened.state.messages.at(-1)?.text.startsWith('Hai chiesto: Ti ricordi la PR?') ??
          false,
        'an answer from the resumed session'
      );
    } finally {
      reopened.dispose();
    }
    await api.session.resume({ claudeCommand: ['node', FAKE_CLAUDE], isSpeechOn: false });
    await until(() => state().status === 'ready', 'the first session back');
  });

  it('GIVEN new commits on the PR WHEN updated THEN unchanged hunks keep their state, and only the new ones are to review', async () => {
    api.session.setHunks(Object.keys(state().hunks), 'ok');
    const from = state().pr!.headSha;
    // The PR's head moves: the commit changes orders.ts, and nothing else
    writeIn(
      repo,
      'src/orders.ts',
      "import { resolvePrice } from './price';\n\nexport const save = (total: number) => resolvePrice(total) + 1;\n"
    );
    gitIn(repo, 'commit', '-qam', 'more');
    gitIn(repo, 'tag', '-f', 'tip');

    await api.session.checkHead();
    assert.deepEqual(state().newHead, { sha: gitIn(repo, 'rev-parse', 'tip'), commits: 1 });

    await api.session.update();

    await until(
      () =>
        lastClaude()?.text.startsWith('Hai chiesto: The PR has 1 new commit since your review') ??
        false,
      'Claude, told what moved, in the same session'
    );
    const orders = state().files.find((file) => file.path === 'src/orders.ts')!;
    assert.equal(state().coverage[orders.hunks[0]], 'todo');
    for (const file of state().files.filter((one) => one !== orders))
      assert.ok(
        file.hunks.every((id) => state().coverage[id] === 'ok'),
        `${file.path} kept ok`
      );
    assert.deepEqual(
      state().blocks.map((block) => block.title),
      ['What changed since your review', 'Price rounding', 'Everything else']
    );
    assert.deepEqual(state().blocks[0].hunks, orders.hunks);
    assert.equal(state().newHead, null);
    assert.notEqual(state().pr!.headSha, from);
    const told = state().messages.find((message) => message.isAuto && message.text.includes(from));
    assert.ok(
      told?.text.includes('What changed since your review'),
      'the prompt names the new hunks'
    );
  });

  it("GIVEN a resumed session WHEN Claude's tools are still connecting THEN it is not your turn yet", async () => {
    process.env.FAKE_CLAUDE_LIST_DELAY = '1500';
    try {
      await api.session.end();

      await api.session.resume();

      await until(
        () => state().activity === 'Connecting the review tools',
        'Claude started, its tools connecting'
      );
      assert.equal(state().status, 'starting');
      await until(() => state().status === 'ready', 'the tools listed');
    } finally {
      delete process.env.FAKE_CLAUDE_LIST_DELAY;
    }
  });

  it("GIVEN a resume while Claude's session is still closing WHEN it finds no conversation THEN it tries again and goes on", async () => {
    const fails = path.join(repo, '..', `fails-${Date.now()}`);
    writeFileSync(fails, '2');
    process.env.FAKE_CLAUDE_FAILS = fails;
    try {
      await api.session.end();

      await api.session.resume();

      await until(() => state().status === 'ready', 'the session after two tries', 30_000);
      assert.equal(readFileSync(fails, 'utf8'), '0');
      assert.ok(
        state().trail.some((step) =>
          step.startsWith("Waiting for Claude's session to be free (try 3")
        )
      );
    } finally {
      delete process.env.FAKE_CLAUDE_FAILS;
      rmSync(fails, { force: true });
    }
  });

  it('GIVEN a second PR WHEN it prepares THEN input waits for the map, and both reviews are kept apart', async () => {
    const first = state().reviews.find((review) => review.number === 7)!;
    const firstSession = state().messages.length;

    await api.startLocal({ repo, base: 'base', head: 'tip', number: 8, title: 'Slow prep' });
    await until(() => state().status === 'thinking', 'the preparation');
    api.session.send('Troppo presto');
    await until(() => state().blocks.length > 0 && state().status === 'ready', 'the map of #8');

    assert.ok(
      !state().messages.some((message) => message.text === 'Troppo presto'),
      'nothing was sent while preparing'
    );
    assert.deepEqual(
      state()
        .reviews.map((review) => review.number)
        .sort(),
      [7, 8]
    );

    await api.session.openReview(first.id);
    await until(() => state().status === 'ready' && state().pr?.number === 7, 'review #7 again');
    assert.ok(state().messages.length >= firstSession, 'its chat is back');
    api.session.send('Sei ancora tu?');
    await until(
      () => lastClaude()?.text.startsWith('Hai chiesto: Sei ancora tu?') ?? false,
      'its session answering'
    );

    await api.session.drop([state().reviews.find((review) => review.number === 8)!.id]);
    assert.deepEqual(
      state().reviews.map((review) => review.number),
      [7]
    );
  });

  it('GIVEN a folder Claude does not trust yet WHEN it asks THEN Trust answers its dialog and the review prepares', async () => {
    const trusted = path.join(repo, '..', `trusted-${Date.now()}`);
    process.env.FAKE_CLAUDE_TRUST = trusted;
    try {
      await api.startLocal({ repo, base: 'base', head: 'tip', number: 9, title: 'Trust me' });
      await until(
        () => state().status === 'waiting' && state().dialog === 'trust',
        'the trust dialog'
      );

      api.session.trustFolder();

      await until(() => state().blocks.length > 0 && state().status === 'ready', 'the map of #9');
      assert.ok(existsSync(trusted));
    } finally {
      delete process.env.FAKE_CLAUDE_TRUST;
      rmSync(trusted, { force: true });
    }
  });

  it('GIVEN a checkout away from the PR head WHEN a review worktree opens THEN it is at the head, in a new window', async () => {
    execFileSync('git', ['checkout', '-q', 'base'], { cwd: repo });
    await api.startLocal({ repo, base: 'base', head: 'tip', number: 10, title: 'Elsewhere' });
    await until(() => state().status === 'ready', 'the review of #10');
    assert.equal(state().pr?.isLive, false);
    const opened: string[] = [];
    const execute = vscode.commands.executeCommand;
    (vscode.commands as { executeCommand: unknown }).executeCommand = async (
      command: string,
      ...args: unknown[]
    ) => {
      if (command !== 'vscode.openFolder') return execute(command, ...args);
      opened.push((args[0] as vscode.Uri).fsPath);
    };
    try {
      await api.session.openWorktree();
    } finally {
      (vscode.commands as { executeCommand: unknown }).executeCommand = execute;
    }

    const folder = path.join(realpathSync(repo), '.claude', 'worktrees', 'pr-10');
    assert.deepEqual(opened, [folder]);
    const head = execFileSync('git', ['rev-parse', 'tip'], { cwd: repo, encoding: 'utf8' }).trim();
    assert.equal(
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8' }).trim(),
      head
    );
    assert.match(
      readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'),
      /^\/\.claude\/worktrees\/$/m
    );
    assert.equal(
      execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }),
      ''
    );
    assert.equal(state().status, 'ended');
  });

  it('GIVEN a clean checkout away from the PR head WHEN checked out here THEN diffs go live', async () => {
    await api.session.resume();
    await until(() => state().status === 'ready', 'the review of #10 again');
    const ask = vscode.window.showWarningMessage;
    (vscode.window as { showWarningMessage: unknown }).showWarningMessage = async () => 'Check Out';
    try {
      await api.session.checkoutPr();
    } finally {
      (vscode.window as { showWarningMessage: unknown }).showWarningMessage = ask;
    }

    assert.equal(state().pr?.isLive, true);
    assert.equal(
      state().messages.at(-1)?.text,
      'Checked out PR #10: diffs open on your files, with live errors.'
    );
  });

  it('GIVEN the review WHEN the chat view is focused THEN it opens in the side bar', async () => {
    await vscode.commands.executeCommand('talkthrough.chat.focus');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    // TALKTHROUGH_SCREENSHOT=<file.png> keeps a picture of the window, to look at the UI
    const screenshot = process.env.TALKTHROUGH_SCREENSHOT;
    if (screenshot) execFileSync('screencapture', ['-x', screenshot]);
  });

  it('GIVEN a reply WHEN played silently THEN the player walks its sentences and stops', async () => {
    const message = lastClaude()!;

    api.session.play(message.id, 0);

    await until(
      () =>
        !state().player.isPlaying &&
        state().player.messageId === message.id &&
        state().player.sentence === message.sentences.length - 1,
      'the end of the reply'
    );
  });
});

describe('Your own changes and tours', function () {
  this.timeout(90_000);
  let api: TalkthroughApi;
  let repo: string;
  const options = { claudeCommand: ['node', FAKE_CLAUDE], isSpeechOn: false };
  const state = () => api.session.state;
  const until = async (check: () => boolean, what: string, timeout = 20_000) => {
    const end = Date.now() + timeout;
    while (!check()) {
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what} (${state().status})`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  before(async () => {
    api = await vscode.extensions
      .getExtension<TalkthroughApi>('epavanello.talkthrough')!
      .activate();
    repo = fixtureRepo();
  });

  after(async () => {
    await api.session.end();
    await api.forget();
    rmSync(repo, { recursive: true, force: true });
  });

  it('GIVEN staged and unstaged work WHEN the staged changes are reviewed THEN Claude maps only those', async () => {
    writeIn(repo, 'src/orders.ts', 'export const save = (total: number) => total;\n');
    gitIn(repo, 'add', 'src/orders.ts');
    writeIn(repo, 'src/price.ts', 'export const unstaged = true;\n');

    await api.session.start({ kind: 'changes', scope: 'staged', repo }, options);

    await until(() => state().blocks.length > 0 && state().status === 'ready', 'the map');
    assert.equal(state().pr?.kind, 'changes');
    assert.equal(state().pr?.title, 'Staged changes on main');
    assert.deepEqual(
      state().files.map((file) => file.path),
      ['src/orders.ts']
    );
  });

  it('GIVEN a question WHEN a tour starts THEN Claude draws stops, and a show cue opens the file itself', async () => {
    // The code as the previous test left it, but clean: the stops fit its files
    gitIn(repo, 'reset', '-q', '--hard');
    await api.session.start(
      { kind: 'tour', question: 'Come si calcola il prezzo?', repo },
      options
    );

    await until(() => state().blocks.length === 2 && state().status === 'ready', 'the tour');
    assert.equal(state().pr?.kind, 'tour');
    assert.deepEqual(state().hunks.T1 && [state().hunks.T1.path, state().hunks.T1.header], [
      'src/price.ts',
      'resolvePrice'
    ]);

    api.session.next();

    await until(() => state().coverage.T1 === 'explained', 'the first stop explained');
    const here = `${path.basename(repo)}/src/price.ts`;
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    assert.ok(
      tabs.some(
        (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.path.endsWith(here)
      ),
      'the file is open'
    );
    assert.ok(
      !tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.path.endsWith(here)
      ),
      'a file, not a diff'
    );
  });
});
