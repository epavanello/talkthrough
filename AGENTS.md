# AGENTS.md — Talkthrough

A VS Code extension for voice-driven, turn-based PR reviews with Claude Code. Same stack and approach
as Treeline (`~/sideprojects/treeline`): Svelte 5 webview with shadcn-svelte, typed RPC between host
and webview, esbuild for the host, e2e in a real VS Code.

## Ground rules

- **Language**: code, comments, docs, commit messages and UI text in English. Claude's replies follow
  `talkthrough.language` (VS Code's language when empty). Chat with the owner is in Italian.
- **Least code wins**: VS Code built-ins first (`vscode.diff`, decorations, reference provider,
  `editor.action.peekLocations`), shadcn-svelte components in `packages/webview/src/lib/components/ui/`
  (vendored: edit only to theme or fix integration).
- **One source of truth**: types and constants the host and the webview share live in
  `packages/shared` (`ReviewState`, `HostApi`, `SHORTCUTS`, `MODELS`, `isPreparing`). The shortcuts are
  also bound in `package.json`: `test/manifest.test.ts` keeps the two the same.
- Svelte 5 runes only. No stores.
- vscode-free modules stay vscode-free (`browser.ts`, `changes.ts`, `claude.ts`, `cues.ts`, `delta.ts`,
  `github.ts`, `patch.ts`, `player.ts`, `pr.ts`, `proc.ts`, `prompts.ts`, `requirements.ts`, `reviews.ts`, `server.ts`, `tools.ts`): they are
  unit-tested and `cli-check` runs them in plain Node.
- **Every user-facing change ships as a release**: in the same push, bump `version` in
  `packages/extension/package.json` (fix → patch, feature → minor while on 0.x) and add a `## <version>`
  section at the top of `packages/extension/CHANGELOG.md`, one user-facing bullet per change. The
  Release workflow publishes it. Docs, CI or tests alone need no bump. Never push tags by hand.

## Architecture

- `session.ts` owns the open review: PR and hunks, coverage, the Claude process, hooks, tools, player,
  stage. One per window; `extension.ts` wires it to the webview's `HostApi`.
- `claude.ts` builds the CLI arguments (`--settings` with hooks and tap dictation, `--mcp-config`,
  `--permission-mode dontAsk`, `--name "Talkthrough · PR #<n>: <title>"`, `--session-id <uuid>` for a
  new session, `--resume <uuid>` after) and runs `claude` through `resources/ptybridge.py`.
- The session is read-only by construction (`ALLOWED_TOOLS` in `claude.ts`): Read and the stage's
  MCP tools, no shell. The PR is someone else's text, and git flags can write files (`--output`) or run
  a pager (`git grep -O`). Search is `pr_search` (`git grep` at the PR head, through `run`, no shell).
- `server.ts` is the local HTTP server: `/hook/<event>` (curl from the hooks) and `/mcp` (stateless
  Streamable HTTP, hand-written JSON-RPC). Bearer token per session.
- Claude Code connects its MCP servers after the SessionStart hook: a session is ready ("Your turn")
  once it lists the stage's tools (`tools/list`, `onListed`), 10 s at most. A prompt sent sooner runs
  without them, and Claude says the server is gone.
- What Claude says arrives through the Stop hook (`last_assistant_message`), never by reading the
  screen. The screen is read only for dialogs, dictation outcomes ("No speech detected") and a resume
  that finds no conversation. Claude Code draws spaces with cursor moves (`No\x1b[4Gconversation`):
  `plain()` in `claude.ts` turns them back before matching text.
- Dictation exists only in Claude Code's interactive interface: Space in tap mode starts it on an
  empty prompt and sends on the second tap. What is heard is read live from the prompt box of an
  emulated screen (`@xterm/headless`, `promptIn` in `claude.ts`). Claude Code sends a transcript by itself
  only from three words on: a shorter one waits in the prompt, and `sendShortDictation()` presses Enter
  once it holds still and the footer no longer says "Voice: processing".
- Cancel is Esc while dictating (`cancelDictation`): Claude Code drops the recording. Until it hears
  new words, it shows the last dictation in its prompt again: `heard()` hides that.
- Never type `/model` or `/effort` into the session: Claude Code also saves them as defaults. The
  header's pickers (`CHOICES` in shared: `talkthrough.model`, `talkthrough.effort`) relaunch with
  `--resume <session> --model <alias> --effort <level>`, same conversation.
- Prompts sent to Claude are English whatever `talkthrough.language` says: Next sends "Next", and the
  system prompt tells Claude what it means in any language.
- Esc ends a turn with no Stop hook and puts the prompt back in the input: the session says
  "Interrupted." itself and Ctrl+U empties the input.
- Stage cues (`[[show|open|refs path#Lx-y symbol]]`) are parsed in `cues.ts` and fired by the
  player sentence by sentence. `[[choice words]]` fires nothing: the last reply's choices are buttons
  that send their words (`choiceText`). A `show` cue marks the hunks it overlaps as explained.

### Reviews kept

- `reviews.ts` keeps every review as one JSON file in the extension's global storage (`reviews/`), so
  each window writes only its own. A review's id is `<git common dir>#<owner/name>#<number>`: every
  worktree of a repository lists the same reviews (`state.reviews`, the start screen), and a PR with a
  kept review goes on with it instead of starting over. workspaceState `talkthrough.open` is the review
  a window has open: a new window shows it `paused`, and Resume relaunches with `--resume`.
- A resume that ends before Claude starts (an early exit, or "No conversation found": the session may
  still be closing in another window) is tried again after 1, 2, 4 and 8 s, then fails with "Try again"
  or "New Claude session" (`restart`: new session id, the kickoff again, chat and hunk states kept).
  `ptybridge.py` hangs up Claude's whole process group and kills it 3 s later; `deactivate()` waits.
- Bumped `run` counters drop the work of a start or resume that something newer replaced.

### New commits

- `checkHead()` (on window focus, at most every 30 s, and every 3 minutes) asks the PR's head
  (`currentHead`: GitHub's `headRefOid`, a local review's ref) and counts the commits since the head
  under review (`commitsSince`, null after a force-push): `state.newHead`, the banner's Update.
- Every hunk has a `key`: its path and changed lines, hashed (`indexPatch`), so the same change matches
  on a new head where ids shift. `carryOver()` in `delta.ts` keeps the state and block of matching
  hunks and gathers the new or changed ones in a first block, `DELTA_TITLE` (an earlier one is merged).
- `update()` moves a running session to the new head and types `updatePrompt` into it (same session);
  a stopped one goes on with `--resume` and the same prompt. A resume that finds a new head does the
  same, and a restart carries the states over before Claude draws a new map.

### Your changes and tours

- `changes.ts` (vscode-free): a review that is not a PR stands on a snapshot, a commit on top of HEAD
  that no ref points to, written with a copy of the index (`GIT_INDEX_FILE`; `git add -A` for
  uncommitted work), fixed author and dates so the same changes make the same commit. `changes`
  reviews: staged or uncommitted against HEAD, or the branch against `origin/HEAD`, main or master; one
  kept per scope (`#changes#<scope>`), and `checkHead()` compares snapshots. `PrInfo.kind` says which
  (`kindOf()`: missing is `pr`); worktree and checkout offers are for PRs only.
- Both kinds, and PRs, have `git_log` and `git_show` (`logAt`, `showAt` in `pr.ts`: a revision that
  can't be an option, `--no-ext-diff --no-textconv`, no shell).
- A tour (`#tour#<time>`) has no diff: Claude gets `TOUR_TOOLS` (`code_search`, `code_file`,
  `set_tour`) and `systemPrompt(…, 'tour')`. `set_tour` stops become hunks `T1…` (`tourMap()` in
  `tools.ts`: the title is the header, no additions), in files, in blocks, so coverage, Next and the
  map work as in a review. A show cue opens the file itself (`Stage.show`). Resuming a tour keeps its
  stops (`reopenTour`); a new Claude session draws it again.

### The browser panel

- agent-browser ships inside the extension: a pinned devDependency carries every platform's binary,
  and `scripts/package.mjs` puts one in each platform's `.vsix` (`bin/`, with its licenses; a universal
  `.vsix` has none). `browserBin()`: `talkthrough.browser.path`, else `bin/`, else the PATH. Without
  Chrome (`agent-browser doctor`), the start screen offers `agent-browser install`.
- `browser.ts` (vscode-free) runs agent-browser (Vercel's browser CLI for agents) with `--json`: one
  session (`review-<hash of the git common dir>`, namespace `talkthrough`) and one Chrome profile per
  repository in global storage, the installed Chrome when there is one, an action policy denying
  download and upload, content boundaries on. Marks are our own DOM layer (`markScript`: a box in
  document coordinates from `get box`, kept within the page's width, its label as text placed by CSS
  anchor positioning: `position-try-order: most-width`, flipping below). A mark follows the element
  under it (found by `elementFromPoint`, checked every 300 ms) and goes once it leaves the page;
  `refresh()` drops those from the list. Numbered `m1…`, kept per page. An @ref lives only until
  the next snapshot: drawing a mark answers a selector for its element (an id, else `nth-of-type`
  steps), and `pin()` writes it, and a page cue's full address, into the reply's text, which a kept
  review parses again.
- `browserPanel.ts` is a WebviewPanel in column Two (the diff is in One), mounting the same webview
  bundle (`data-view="browser"`, `BrowserApp.svelte`). agent-browser's stream (a WebSocket that only
  takes local clients) is opened by the host, which relays JPEG frames to the panel (ack pacing) and
  the person's mouse and keys back; the viewport follows the panel's size. Chrome runs with
  `--force-device-scale-factor=2`: the stream's frames follow Chrome's own pixel ratio, not an emulated
  one. Keys go through a hidden textarea (a canvas gets no paste or composition) as `keyInput`: text
  on keyDown, a virtual key code on rawKeyDown (what moves the caret); ⌘ edits go through `edit`.
- Claude gets `BROWSER_TOOLS` (probe, open, snapshot, act, look, eval, mark; probe checks local
  addresses, so Claude confirms the app's port before asking) only when the browser is on and
  agent-browser answers (`browserReady()` at each launch), and the prompt's browser section with them.
  Cues `[[page …]]` and `[[mark @ref label]]` fire with the voice (`runCue`); a page cue on the page
  already open keeps it and its marks. A reply's page cues are stored with their full address
  (`pinPages`): each link works on its own, after a reload too; the chat shows only the path. `pnpm browser-check` runs the real CLI on
  a local page.

### Preparing, trust, checkout

- The kickoff (and the "new commits" prompt of a resume) is typed into the session once its tools are
  listed (`firstPrompt`, `readyWhenListed`): one on Claude's command line runs before the MCP server
  connects, without the stage's tools. Its message is `isAuto`.
- The start screen's **Goal** (`app.focus`) is a review's `focus` (`StartInput`, kept with
  the review: the kickoff's `Focus: …`, and a prompt of its own when a kept review goes on) or a
  tour's question. `isPreparing` (shared): no map yet and Claude busy. Input waits meanwhile (the composer and
  the host's `isWaitingForMap`), and the webview shows `state.trail`, the turn's steps.
- Hooks don't run in a folder Claude Code doesn't trust: its trust dialog shows on the screen
  (`dialog: 'trust'`), and `trustFolder()` moves its menu to "Yes" and presses Enter.
- `checkout.ts`: a review worktree (`git worktree add --detach <main>/.claude/worktrees/pr-<n>
<headSha>`, `/.claude/worktrees/` added to `info/exclude`), handed to its new window through
  globalState `talkthrough.handoff` (that window resumes it and runs `talkthrough.worktreeSetup` in a
  terminal); or `gh pr checkout <url>` here, asking first, refused with uncommitted changes.
- `github.ts`: gh's active account, else its other signed-in accounts, the working one remembered per
  repository; the repository is `gh repo set-default`'s remote, else `upstream`, else `origin`. The PR
  lists are GitHub searches (`review-requested:@me`, `assignee:@me`, `author:@me`).
- `requirements.ts`: `claude auth status --json` (claude.ai sign-in, expiry), `gh auth status`,
  `python3`; the start screen shows them when something is missing, with a fix typed into a terminal.

## Layout

```
packages/
  shared/      The host ⇄ webview contract: ReviewState, HostApi, SHORTCUTS, MODELS. Start here.
  extension/   The extension (the published package), bundled by esbuild → dist/extension.cjs
    src/        session, claude, server, tools, prompts, cues, patch, delta, player, stage, diff,
                terminal, pr, changes, github, reviews, requirements, checkout, browser,
                browserPanel, view, extension
    resources/  ptybridge.py, icon.svg (the view's), icon.png (the stores', from docs/icon.svg)
    test/       vitest; e2e/ runs in VS Code with e2e/fake-claude.mjs; scripts/cli-check.ts
    scripts/    package.mjs (`pnpm package`: this platform's .vsix; `--all`: every platform's, in vsix/),
                agent-browser.mjs (its binary per target), readme.mjs (the stores' README),
                cli-check, tour-check, browser-check (the real CLIs)
  webview/     Svelte 5 + Vite + Tailwind 4 + shadcn-svelte → extension/dist/webview
    src/lib/app.svelte.ts   the state (one class, runes) and small helpers
    src/lib/components/     Home (Requirements, Starters, PullPicker), Header, Notice, MapPanel,
                            Messages, PlayerBar, Composer, Shortcuts, Tip; BrowserApp.svelte is
                            the panel
    preview/                the panel in a browser on a mocked host: ?scene=home|setup|preparing|
                            review|update|browser|trust|recording|tour|error, &theme=light,
                            &width=280, &voice=off
docs/          README images and the icon's source
```

## Theming and accessibility

- shadcn tokens map to `--vscode-*` variables in `src/app.css`; `ok`, `explained` and `warn` are the
  hunk states' colors. Text you click is `text-link`; secondary text is `text-muted-foreground`; no
  opacity on text, only on icons and dimmed states.
- The root is a container (`@container`): controls fold by the side bar's width (`@xs:`).
- Icon-only buttons are named by their `hint` (the vendored `Button` sets `aria-label`); the chat is a
  `role="log"`; toggles carry `aria-pressed` / `aria-expanded`.

## Checks

`pnpm check`, `pnpm test`, `pnpm e2e` (uses the VS Code build pinned in `.vscode-test.mjs`), and
`pnpm cli-check [folder]` when the CLI arguments, hooks or the MCP server change (runs Haiku, costs a
little; the folder must be one Claude Code already trusts, or hooks never run), and
`pnpm tour-check [repo] [question]` when the tour's prompt or tools change (Haiku explores the real
code and draws a tour). `pnpm format:check` runs in CI.

## Releases

Published as `epavanello.talkthrough` on the VS Code Marketplace and Open VSX by
`.github/workflows/release.yml`, as Treeline: every push to `main` whose `package.json` version has no
`v<version>` tag yet runs the tests, packages a `.vsix` per platform and a universal one, creates the
tag and a GitHub release with them (notes: that version's CHANGELOG section, required), then publishes
to both stores, with the `VSCE_PAT` and `OVSX_PAT` repository secrets (or Entra ID / Open VSX trusted
publishing, when set up as in Treeline).
**Run workflow** republishes the current version to a store that lacks it.
