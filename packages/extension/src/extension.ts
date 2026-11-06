import * as vscode from 'vscode';
import type { HostApi } from '@talkthrough/shared';
import { RevisionProvider, SCHEME } from './diff';
import { githubRepo, searchPulls } from './github';
import { ReviewSession, findRepo, type StartOptions } from './session';
import { ChatView } from './view';

/** What the e2e tests drive. */
export interface TalkthroughApi {
  session: ReviewSession;
  startLocal(
    input: { repo: string; base: string; head: string; number: number; title: string },
    options?: StartOptions
  ): Promise<void>;
  /** A session as the next window would open it: restored from what this one kept. */
  reopen(): Promise<ReviewSession>;
  /** Forgets every kept review: a clean start. */
  forget(): Promise<void>;
}

let session: ReviewSession | undefined;

export function activate(ctx: vscode.ExtensionContext): TalkthroughApi {
  const log = vscode.window.createOutputChannel('Talkthrough', { log: true });
  const review = new ReviewSession(ctx);
  session = review;
  const fail = (error: unknown) => {
    log.error(error as Error);
    void vscode.window.showErrorMessage(`Talkthrough: ${(error as Error).message}`);
  };

  const start = async (pr: string) => {
    const value =
      pr.trim() ||
      (await vscode.window.showInputBox({
        title: 'Talkthrough: review a pull request',
        prompt: 'Pull request number or URL',
        placeHolder: '943 or https://github.com/owner/repo/pull/943',
        ignoreFocusOut: true
      }));
    if (!value) return;
    await vscode.commands.executeCommand('talkthrough.chat.focus');
    await review.start({ kind: 'github', pr: value });
  };

  const api: HostApi = {
    getState: async () => {
      await review.ready;
      if (!review.state.requirements) void review.checkRequirements();
      return review.state;
    },
    start,
    listPulls: async (filter, text) => {
      const repo = await findRepo().catch(() => null);
      if (!repo)
        return {
          status: 'none',
          message: 'Open the repository of the pull requests in this window.'
        };
      const at = await githubRepo(repo);
      if (!at)
        return {
          status: 'none',
          message: 'This repository has no GitHub remote: start a review by its URL.'
        };
      try {
        return { status: 'ok', items: await searchPulls(at, filter, text) };
      } catch (error) {
        return { status: 'error', message: (error as Error).message };
      }
    },
    openReview: (id) => review.openReview(id),
    dropReview: async (id) => {
      const kept = review.state.reviews.find((one) => one.id === id);
      if (!kept) return;
      if (kept.ok < kept.total) {
        const choice = await vscode.window.showWarningMessage(
          `Drop the review of PR #${kept.number}?`,
          {
            modal: true,
            detail: `${kept.ok} of ${kept.total} hunks are ok. Its chat and hunk states are deleted; Claude's session stays in Claude Code.`
          },
          'Drop'
        );
        if (choice !== 'Drop') return;
      }
      await review.drop([id]);
    },
    closeReview: () => review.close(),
    checkRequirements: () => review.checkRequirements(),
    runInTerminal: async (command) => {
      // Only the fixes the requirements suggest, typed but not run: the person presses Enter
      if (!review.state.requirements?.some((requirement) => requirement.fix === command)) return;
      const terminal = vscode.window.createTerminal({ name: 'Talkthrough' });
      terminal.show();
      terminal.sendText(command, false);
    },
    stop: () => review.end(),
    resume: () => review.resume(),
    restart: () => review.restart(),
    trustFolder: async () => review.trustFolder(),
    openWorktree: () => review.openWorktree().catch(fail),
    checkoutPr: () => review.checkoutPr().catch(fail),
    choose: (setting, value) => review.choose(setting, value),
    update: () => review.update(),
    toggleTerminal: async () => review.toggleTerminal(),
    send: async (text) => review.send(text),
    toggleMic: async () => review.toggleMic(),
    next: async () => review.next(),
    interrupt: async () => review.interrupt(),
    play: async (messageId, sentence) => review.play(messageId, sentence),
    pauseResume: async () => review.pauseResume(),
    seek: async (delta) => review.seek(delta),
    replayLast: async () => review.replayLast(),
    stopSpeech: async () => review.stopSpeech(),
    setSpeech: async (isOn) => review.setSpeech(isOn),
    runCue: (cue) => review.runCue(cue),
    showHunk: (id) => review.showHunk(id),
    setHunks: async (ids, state) => review.setHunks(ids, state),
    reset: async () => {
      const pr = review.state.pr;
      if (!pr) return;
      const viewed = review.viewedCount;
      const detail = viewed
        ? `Every hunk goes back to todo, and the ${viewed} files marked as Viewed on GitHub are unmarked.`
        : 'Every hunk goes back to todo.';
      const choice = await vscode.window.showWarningMessage(
        `Start the review of PR #${pr.number} over?`,
        { modal: true, detail },
        'Start over'
      );
      if (choice === 'Start over') await review.reset();
    },
    showTerminal: async () => review.showTerminal(),
    openUrl: async (url) => {
      // Only web pages: the URL comes from the webview
      if (/^https:\/\//.test(url)) await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  };
  const view = new ChatView(ctx.extensionUri, api, log);

  ctx.subscriptions.push(
    log,
    review,
    review.onChange(() => view.post({ event: 'state', state: review.state })),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, new RevisionProvider()),
    vscode.window.registerWebviewViewProvider('talkthrough.chat', view, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('talkthrough.start', (pr?: string) =>
      start(typeof pr === 'string' ? pr : '')
    ),
    vscode.commands.registerCommand('talkthrough.toggleMic', () => review.toggleMic()),
    vscode.commands.registerCommand('talkthrough.next', () => review.next()),
    vscode.commands.registerCommand('talkthrough.pauseResume', () => review.pauseResume()),
    vscode.commands.registerCommand('talkthrough.replay', () => review.replayLast()),
    vscode.commands.registerCommand('talkthrough.showTerminal', () => review.toggleTerminal()),
    vscode.commands.registerCommand('talkthrough.resume', () => review.resume()),
    vscode.commands.registerCommand('talkthrough.stop', () => review.end()),
    vscode.commands.registerCommand('talkthrough.openWorktree', () =>
      review.openWorktree().catch(fail)
    ),
    vscode.commands.registerCommand('talkthrough.checkout', () => review.checkoutPr().catch(fail)),
    vscode.commands.registerCommand('talkthrough.update', () => review.update())
  );

  return {
    session: review,
    startLocal: (input, options) => review.start({ kind: 'local', ...input }, options),
    reopen: async () => {
      await review.flush();
      const next = new ReviewSession(ctx);
      await next.ready;
      return next;
    },
    forget: async () => {
      await review.ready;
      await review.drop(review.state.reviews.map((kept) => kept.id));
    }
  };
}

/** Claude's processes end with the window, and the open review is saved. */
export function deactivate() {
  return session?.shutdown();
}
