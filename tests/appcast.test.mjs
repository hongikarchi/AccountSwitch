import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { appcast, edSignature, verifies } from '../scripts/appcast.mjs';

test('the macOS update feed is signed as Sparkle checks it', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  // Info.plist holds the raw 32-byte key in base64, as Sparkle's generate_keys prints it.
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const archive = Buffer.from('zip bytes');
  const signature = edSignature(archive, pem);
  assert.equal(Buffer.from(signature, 'base64').length, 64);
  assert.equal(verifies(archive, signature, raw), true);
  assert.equal(verifies(Buffer.from('other bytes'), signature, raw), false);

  const xml = appcast({
    version: '0.2.0',
    url: 'https://example.com/AccountSwitch-mac.zip',
    length: archive.length,
    signature,
    date: new Date('2026-10-01T00:00:00Z'),
  });
  assert.match(xml, /<sparkle:version>0\.2\.0<\/sparkle:version>/);
  assert.match(xml, new RegExp(`sparkle:edSignature="${signature.replace(/[+/=]/g, '\\$&')}"`));
  assert.match(xml, / length="9" /);
  assert.match(xml, /Thu, 01 Oct 2026 00:00:00 GMT/);
});
