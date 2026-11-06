/** Child processes: run one to completion and read what it printed. vscode-free. */
import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Resolve instead of rejecting on a non-zero exit code. */
  allowFailure?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function run(command: string, args: string[], options: RunOptions = {}) {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.stdin.on('error', () => {}); // EPIPE when the command is missing; 'error' above reports it
    child.on('close', (exitCode) => {
      const code = exitCode ?? 1;
      if (code !== 0 && !options.allowFailure) {
        const output = (stderr || stdout).trim();
        reject(new Error(`${command} ${args[0] ?? ''} failed: ${output}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(options.input ?? '');
  });
}

/** `git <args>` in `repo`, its trimmed output. */
export const git = async (repo: string, ...args: string[]) =>
  (await run('git', args, { cwd: repo })).stdout.trim();
