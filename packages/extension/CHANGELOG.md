# Changelog

## 0.4.0

- Every review in progress is kept, each with its own Claude session, and listed on the start screen
  with its progress and last activity: open one again, from any window or worktree of the repository,
  and Claude remembers it. Drop the ones you finished.
- Pick the pull request from GitHub's lists (review requested from you, assigned, yours, all open) or
  search them; a number or URL still works. With several gh accounts, the one that can read the
  repository answers.
- New commits on the PR are noticed (on focus, and every few minutes): **Update** keeps the state of
  every hunk whose change is the same, gathers the new or changed ones in a block "What changed since your
  review" at the top of the map, and tells Claude, in the same session, to explain only those.
- An **Effort** picker beside the model (Claude Code's `--effort`, for the review session only).
- Preparing is clear: the panel shows each step Claude takes while it studies the PR, and input waits
  for the map.
- When the checkout isn't at the PR head: **Review worktree** (at the PR head, in a new window where the
  review goes on, `talkthrough.worktreeSetup` runs a setup command there) or **Check out here**.
- The chat reads better: every message is labelled You or Claude, with the same width; Talkthrough's own
  prompts and Next are small lines.
- Review sessions have a name in Claude Code's and the desktop app's lists: `Talkthrough · PR #12: title`.
- Resume tries again when Claude's session is still closing in another window, and every Claude process
  ends with the window.
- First run: a check of Claude Code (signed in with claude.ai, for dictation), the GitHub CLI and Python,
  with the command that fixes what is missing.
- Claude's "do you trust this folder" question has a **Trust this folder** button.
- Keyboard shortcuts are listed in the panel; it fits a narrow side bar, follows light and dark themes,
  and names its controls for screen readers.
- Claude's dialogs and "No speech detected" are noticed again on its screen.
- `talkthrough.language` is VS Code's language unless set. Next sends "Next" in any language.

## 0.3.0

- The file chips in Claude's replies work again: a click reopens the diff or file it cited.
- Talk: while you dictate, the box shows what Claude hears, live, and Send is the only button.
- A reloaded window keeps the review: the chat, the map and the hunk states come back, and Resume goes
  on with the same Claude session, so Claude remembers the PR.
- A model picker (Default, Fable, Opus, Sonnet, Haiku): a running session goes on with the new model.
- The terminal button shows Claude's terminal, and hides it on a second click.

## 0.2.0

- Stop ends Claude's turn in the chat as well, and the next message no longer joins the interrupted one.
- Start over: every hunk back to review, and the files marked as Viewed on GitHub unmarked (asks first).
- The map has three views, Flow (Claude's blocks), Tree and List; a block, folder or file's icon marks
  all its hunks ok, or back to review.

## 0.1.0

- First version: a review session on your Claude Code CLI, a chat with a sentence-by-sentence voice
  player, Claude's dictation in tap mode, stage cues (show, open, refs), a map of hunks in logical
  order with hotspots, and the memory of what is explained and ok.
