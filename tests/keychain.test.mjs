import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { macKeychain } from '../src/core/keychain.ts';

// The real login keychain through /usr/bin/security, with a throwaway item (macOS only).
test(
  'macOS keychain: a value round-trips exactly, and a missing item reads as none',
  { skip: process.platform !== 'darwin' && 'macOS only' },
  () => {
    const keychain = macKeychain();
    const service = 'AccountSwitch-test-' + randomUUID();
    try {
      assert.equal(keychain.get(service), undefined);
      const value = JSON.stringify({ claudeAiOauth: { accessToken: 'a', note: 'x'.repeat(6000) } });
      keychain.set(service, value);
      assert.equal(keychain.get(service), value);
      keychain.set(service, '{"b":1}');
      assert.equal(keychain.get(service), '{"b":1}');
      keychain.delete(service);
      assert.equal(keychain.get(service), undefined);
      // Deleting what is not there is not an error.
      keychain.delete(service);
    } finally {
      try {
        keychain.delete(service);
      } catch {
        /* Already gone. */
      }
    }
  },
);
