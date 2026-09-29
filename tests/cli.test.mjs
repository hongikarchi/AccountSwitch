import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { accountEnvironment } from '../src/core/cli.ts';

test('an account folder is explicit and service-specific; the default login stays untouched', () => {
  for (const [provider, key] of [
    ['claude-cli', 'CLAUDE_CONFIG_DIR'],
    ['codex-cli', 'CODEX_HOME'],
  ]) {
    assert.equal(accountEnvironment(provider, resolve('profile-a'))[key], resolve('profile-a'));
    assert.equal(accountEnvironment(provider, resolve('profile-b'))[key], resolve('profile-b'));
    assert.equal(accountEnvironment(provider)[key], undefined);
    assert.throws(() => accountEnvironment(provider, '../outside'), /INVALID_PROFILE_DIRECTORY/);
  }
});

test('API keys never reach the CLI, so only the subscription login is used', () => {
  process.env.ANTHROPIC_API_KEY = 'x';
  process.env.OPENAI_API_KEY = 'y';
  try {
    assert.equal(accountEnvironment('claude-cli').ANTHROPIC_API_KEY, undefined);
    assert.equal(accountEnvironment('codex-cli').OPENAI_API_KEY, undefined);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  }
});
