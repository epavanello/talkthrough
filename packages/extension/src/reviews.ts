/**
 * Reviews kept across windows: one JSON file per review in the extension's global storage, so every
 * window and worktree of a repository finds them, and each window writes only the one it has open.
 * vscode-free.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export class ReviewStore<T extends { id: string }> {
  constructor(private readonly dir: string) {}

  private file(id: string) {
    return path.join(this.dir, `${createHash('sha1').update(id).digest('hex').slice(0, 20)}.json`);
  }

  async get(id: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /** Every kept review; unreadable files are left out. */
  async all(): Promise<T[]> {
    const names = (await readdir(this.dir).catch(() => [] as string[])).filter((name) =>
      name.endsWith('.json')
    );
    const texts = await Promise.all(
      names.map((name) => readFile(path.join(this.dir, name), 'utf8').catch(() => ''))
    );
    return texts.flatMap((text) => {
      try {
        return [JSON.parse(text) as T];
      } catch {
        return [];
      }
    });
  }

  /** Written whole, then renamed: a window reading it never sees half a file. */
  async save(review: T) {
    await mkdir(this.dir, { recursive: true });
    const file = this.file(review.id);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(review));
    await rename(temporary, file);
  }

  async remove(id: string) {
    await rm(this.file(id), { force: true });
  }
}
