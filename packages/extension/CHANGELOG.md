# Changelog

## 0.5.5

- A background task Claude starts no longer shows up in the chat as a long message of yours, and
  Claude is told to do its work inside the turn instead.
- The opening question of a tour (or the kickoff of a review) takes one line; click it to read it
  all.
- Claude reads the repository's history (the log, and any commit with its diff), read-only: a tour or
  a review can tell how the work grew.

## 0.5.4

- The voice pauses when VS Code loses focus and goes on when you are back; a reply that comes while
  you are away plays a ping, and is read once you return.
- Every file Claude mentions is a link: the one it shows opens with the voice, one it only names is a
  link you click (the voice says only its name). A path Claude writes as code anyway becomes a link
  too.
- Claude finds the app's address on its own and checks it before opening the browser (a new probe of
  local addresses); it asks you only when nothing answers, saying which command and port it found.

## 0.5.3

- In Cursor and other editors that keep the secondary side bar for themselves, Talkthrough has an
  icon of its own in the activity bar, instead of a section among the files.

## 0.5.2

- Send sits in the message box, as in a chat, and Next steps back while you type: the two were easy to
  mix up.
- Ctrl+Alt+B shows or hides the browser panel; opened with no page yet, its address bar takes the
  first one.
- Claude finds the app's port in the dev setup (the dev script's --port, the framework's config,
  .env) instead of assuming one, and checks it before asking you to start the server.
- Replaying an older reply no longer jumps to the bottom when it ends, and a new reply scrolls all the
  way into view.
- A reply's boxes on the page come back after a reload, or after the page changed: a box remembers its
  element by a selector, not by the browser's short-lived reference ("Unknown ref"). Its page link
  keeps its full address in a kept review too.
- Hovering a sentence no longer shows through its code and page links.

## 0.5.1

- The Tour button starts the tour: in 0.5.0 only Enter did.
- Model and effort are on the start screen too: pick them before a review or a tour starts. While
  Claude works they are locked (a change restarts the session), and say so.
- Your changes show how many files each scope holds; an empty one is greyed out and says why
  ("nothing staged"), instead of starting and failing.
- What can't start yet is greyed out and says why: a tour or your changes without Claude Code, a pull
  request without the GitHub CLI. Disabled buttons look disabled in every theme.
- Secondary buttons (Staged, Uncommitted, Talk…) have a border: some themes give them no background.

## 0.5.0

- **Review your own changes**, before the PR: staged, uncommitted (new files included) or the whole
  branch against main. Claude reviews them as a careful colleague and flags leftovers; your index and
  working tree are untouched. When your changes move, Update reviews only what changed.
- **Tours**: ask how something works ("how does the sign-up form work?") and Claude finds the code,
  draws a tour of it in the order it runs, and walks you through it a stop at a time, with the files
  highlighted and the app beside them. Tours are kept and go on later, like reviews.
- **The app in a browser panel**, beside the code: Claude opens the page a change concerns, clicks
  through the flow, and draws numbered, labelled boxes on what the PR changed (dashed) or what to do
  (pulsing), while it talks. The page is live: you watch, and you can click and type in it too, to sign
  in say. It runs [agent-browser](https://github.com/vercel-labs/agent-browser), which comes with the
  extension (nothing to install), on your Chrome with a profile of its own per repository, so sign-ins
  stay; downloads and uploads are denied. Without Chrome, the start screen offers to download one.
- Replies can carry `[[page /path]]` and `[[mark @ref label]]` cues: the page opens and the box appears
  when the voice gets there, next to the diff of the code that renders it. A reply about the page
  that is open names it with its link, so one click shows it again, even after closing the panel or
  reloading VS Code (a click that can't open it says why).
  A box's label goes where there is room (above or below, toward the page's middle by an edge), and
  never makes the page scroll sideways. A box follows its element as the page moves, and goes when
  the element does (another route, a closed dialog).
- With the voice off, sentences are plain text (only the code and page links are clickable) and the
  player's controls are greyed out.
- Talk is ⌘D (Ctrl+D), as in Claude Code: anywhere in VS Code during a review, except an editor you
  type in and the terminal, where the key keeps its own meaning. The buttons no longer show their
  shortcuts: their tooltips and the shortcuts list do.
- Cancel stops a dictation and sends nothing. While dictation starts, the last message sent no
  longer shows as if it were being heard.
- Talk while a dictation is being transcribed no longer starts another one.
- A short dictation ("Done.") is sent: Claude Code sends one by itself only from three words on, and
  the chat stayed on "Transcribing…".

- Claude can search the code again ("who calls this?", "where is this route used?"): Claude Code no
  longer has a Grep tool, and the read-only session denied `grep`. It now searches the PR head with a
  tool of its own, wherever the checkout is.
- The review session runs no shell commands at all: it reads files and uses the review's tools.
  The overview Claude reads lists the PR's commits.

## 0.4.2

- After a resume, a model or effort change, "Your turn" waits until Claude has its review tools: a
  prompt sent sooner ran without them, and Claude said the Talkthrough server was disconnected.

## 0.4.1

- Cues on paths with brackets, such as SvelteKit's `routes/[eventId]/+page.server.ts`, work: they open
  their diff and show as chips instead of raw text, and the voice no longer reads them. Replies already
  in a review are read again when it opens.

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
