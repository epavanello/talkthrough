import { readFileSync } from 'node:fs';
import { SHORTCUTS } from '@talkthrough/shared';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  contributes: {
    keybindings: { command: string; key: string; mac?: string }[];
    commands: { command: string }[];
  };
};

describe('package.json', () => {
  it('GIVEN the shortcuts the chat shows WHEN bound THEN package.json binds the same keys to existing commands', () => {
    const bound = manifest.contributes.keybindings.map(({ command, key, mac }) => ({
      command,
      key,
      mac
    }));
    const commands = manifest.contributes.commands.map(({ command }) => command);

    expect(bound).toEqual(SHORTCUTS.map(({ command, key, mac }) => ({ command, key, mac })));
    expect(bound.every(({ command }) => commands.includes(command))).toBe(true);
  });
});
