// The Sparkle update feed for macOS: release/mac/appcast.xml describing AccountSwitch-mac.zip of
// this version, with its EdDSA signature (ed25519 over the zip's bytes, base64), which installed
// copies check against the public key in their Info.plist before updating.
// Usage: SPARKLE_PRIVATE_KEY=<PEM> node scripts/appcast.mjs
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY = 'https://github.com/hongikarchi/AccountSwitch';

/** Sparkle's edSignature of an archive: base64 of the 64-byte ed25519 signature. */
export function edSignature(archive, privateKeyPem) {
  return sign(null, archive, createPrivateKey(privateKeyPem)).toString('base64');
}

/** Check a signature with the public key as Info.plist holds it (base64 of the raw 32 bytes). */
export function verifies(archive, signature, publicKeyBase64) {
  // SPKI DER for ed25519: a fixed 12-byte prefix, then the raw key.
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const key = createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(publicKeyBase64, 'base64')]),
    format: 'der',
    type: 'spki',
  });
  return verify(null, archive, key, Buffer.from(signature, 'base64'));
}

export function appcast({ version, url, length, signature, date = new Date() }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>AccountSwitch</title>
    <link>${REPOSITORY}</link>
    <item>
      <title>AccountSwitch ${version}</title>
      <pubDate>${date.toUTCString()}</pubDate>
      <sparkle:version>${version}</sparkle:version>
      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <sparkle:releaseNotesLink>${REPOSITORY}/releases/tag/v${version}</sparkle:releaseNotesLink>
      <enclosure url="${url}" length="${length}" type="application/octet-stream" sparkle:edSignature="${signature}"/>
    </item>
  </channel>
</rss>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const key = process.env.SPARKLE_PRIVATE_KEY;
  if (!key) {
    console.error('SPARKLE_PRIVATE_KEY (the update signing key) is not set.');
    process.exit(1);
  }
  const archive = readFileSync(join(root, 'release', 'mac', 'AccountSwitch-mac.zip'));
  const signature = edSignature(archive, key);
  const publicKey = readFileSync(
    join(root, 'src', 'desktop', 'mac', 'sparkle-public-key.txt'),
    'utf8',
  ).trim();
  // A key that does not match the apps' public key would make every installed copy refuse.
  if (!verifies(archive, signature, publicKey)) {
    console.error('SPARKLE_PRIVATE_KEY does not match src/desktop/mac/sparkle-public-key.txt.');
    process.exit(1);
  }
  writeFileSync(
    join(root, 'release', 'mac', 'appcast.xml'),
    appcast({
      version,
      url: `${REPOSITORY}/releases/download/v${version}/AccountSwitch-mac.zip`,
      length: archive.length,
      signature,
    }),
  );
  console.log('Built release/mac/appcast.xml');
}
