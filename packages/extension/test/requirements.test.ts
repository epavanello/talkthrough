import { describe, expect, it } from 'vitest';
import { claudeRequirement } from '../src/requirements';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const status = (fields: Record<string, unknown>) =>
  JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', ...fields });

describe('claudeRequirement', () => {
  it('GIVEN a claude.ai sign-in WHEN checked THEN Claude Code is ready', () => {
    expect(
      claudeRequirement(status({ loginExpiresAt: '2026-12-01T00:00:00Z' }), NOW)
    ).toMatchObject({
      state: 'ok',
      detail: 'Signed in with claude.ai (max).'
    });
  });

  it('GIVEN no CLI, no sign-in or an API key WHEN checked THEN it says what to do', () => {
    expect(claudeRequirement(null, NOW)).toMatchObject({
      state: 'missing',
      url: expect.stringContaining('claude')
    });
    expect(claudeRequirement(status({ loggedIn: false }), NOW)).toMatchObject({
      state: 'missing',
      fix: 'claude auth login'
    });
    expect(claudeRequirement(status({ authMethod: 'api_key' }), NOW)).toMatchObject({
      state: 'warn',
      detail: expect.stringContaining('dictation needs one')
    });
  });

  it('GIVEN a sign-in about to expire WHEN checked THEN it warns', () => {
    expect(
      claudeRequirement(status({ loginExpiresAt: '2026-11-08T13:00:00Z' }), NOW)
    ).toMatchObject({
      state: 'warn',
      detail: 'Your sign-in expires in 2 days.',
      fix: 'claude auth login'
    });
  });
});
