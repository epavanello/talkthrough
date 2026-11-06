/**
 * What a review needs on this machine: Claude Code signed in with a claude.ai account (its
 * dictation needs one), the GitHub CLI signed in, Python 3 (the pseudo-terminal bridge), and macOS's
 * `say` for the voice. vscode-free.
 */
import type { Requirement } from '@talkthrough/shared';
import { run } from './proc';

const DAY = 24 * 60 * 60 * 1000;

/** Runs a command; null when it can't start (not installed). */
const tryRun = (command: string, args: string[]) =>
  run(command, args, { allowFailure: true }).catch(() => null);

interface ClaudeAuth {
  loggedIn?: boolean;
  authMethod?: string;
  loginExpiresAt?: string;
  subscriptionType?: string;
}

/** `claude auth status --json`, read into a requirement. */
export function claudeRequirement(output: string | null, now = Date.now()): Requirement {
  const name = 'Claude Code';
  if (output === null)
    return {
      name,
      state: 'missing',
      detail: 'Not installed, or not where talkthrough.claudePath says.',
      url: 'https://docs.claude.com/en/docs/claude-code/setup'
    };
  let auth: ClaudeAuth = {};
  try {
    auth = JSON.parse(output) as ClaudeAuth;
  } catch {
    // An older CLI without JSON status: assume signed in, the session will say otherwise
    return { name, state: 'ok', detail: 'Installed.' };
  }
  if (!auth.loggedIn)
    return { name, state: 'missing', detail: 'Not signed in.', fix: 'claude auth login' };
  if (auth.authMethod !== 'claude.ai')
    return {
      name,
      state: 'warn',
      detail: 'Signed in without a claude.ai account: typing works, dictation needs one.',
      fix: 'claude auth login'
    };
  const days = auth.loginExpiresAt
    ? Math.floor((Date.parse(auth.loginExpiresAt) - now) / DAY)
    : null;
  if (days !== null && days < 3)
    return {
      name,
      state: 'warn',
      detail: days < 1 ? 'Your sign-in expires today.' : `Your sign-in expires in ${days} days.`,
      fix: 'claude auth login'
    };
  return {
    name,
    state: 'ok',
    detail: `Signed in with claude.ai${auth.subscriptionType ? ` (${auth.subscriptionType})` : ''}.`
  };
}

export async function checkRequirements(claude: string): Promise<Requirement[]> {
  const [claudeStatus, gh, python] = await Promise.all([
    tryRun(claude, ['auth', 'status', '--json']),
    tryRun('gh', ['auth', 'status']),
    tryRun('python3', ['--version'])
  ]);
  const requirements: Requirement[] = [
    claudeRequirement(
      claudeStatus && claudeStatus.stdout.trim() ? claudeStatus.stdout : claudeStatus ? '' : null
    ),
    !gh
      ? {
          name: 'GitHub CLI',
          state: 'missing',
          detail: 'Not installed: pull requests are read with gh.',
          url: 'https://cli.github.com'
        }
      : gh.code !== 0 && !/Logged in to/i.test(gh.stdout + gh.stderr)
        ? { name: 'GitHub CLI', state: 'missing', detail: 'Not signed in.', fix: 'gh auth login' }
        : { name: 'GitHub CLI', state: 'ok', detail: 'Signed in.' },
    python && python.code === 0
      ? { name: 'Python 3', state: 'ok', detail: (python.stdout || python.stderr).trim() }
      : {
          name: 'Python 3',
          state: 'missing',
          detail: "Not found: it runs Claude's terminal.",
          fix: 'xcode-select --install'
        }
  ];
  if (process.platform !== 'darwin')
    requirements.push({
      name: 'Voice',
      state: 'warn',
      detail: "Replies are read aloud with macOS's say: here they are only written."
    });
  return requirements;
}
