// Build the macOS app into release/mac: AccountSwitch.app (the menu bar app from
// src/desktop/mac with the app server next to it in Contents/MacOS), signed ad hoc (no Apple
// developer ID), then AccountSwitch-mac.zip (for updates) and AccountSwitch.dmg (to download).
// Run `npm run build:exe` first on the Mac (`npm run build:mac` does).
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('The macOS app is built on macOS.');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const engine = join(root, 'release', 'engine', 'AccountSwitch-engine');
if (!existsSync(engine)) {
  console.error('release/engine/AccountSwitch-engine is missing; run `npm run build:exe` first.');
  process.exit(1);
}
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });

const source = join(root, 'src', 'desktop', 'mac');
run('swift', ['build', '-c', 'release', '--arch', 'arm64', '--package-path', source]);
const bin = execFileSync(
  'swift',
  ['build', '-c', 'release', '--arch', 'arm64', '--package-path', source, '--show-bin-path'],
  { cwd: root, encoding: 'utf8' },
).trim();

const out = join(root, 'release', 'mac');
const app = join(out, 'AccountSwitch.app');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
cpSync(join(bin, 'AccountSwitch'), join(app, 'Contents', 'MacOS', 'AccountSwitch'));
// Executables belong in Contents/MacOS; codesign refuses them under Resources.
cpSync(engine, join(app, 'Contents', 'MacOS', 'AccountSwitch-engine'));
chmodSync(join(app, 'Contents', 'MacOS', 'AccountSwitch-engine'), 0o755);
cpSync(join(root, 'LICENSE'), join(app, 'Contents', 'Resources', 'LICENSE.txt'));

// The app icon from the 1024-pixel picture.
const iconset = join(out, 'AppIcon.iconset');
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512])
  for (const scale of [1, 2]) {
    const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    run(
      'sips',
      [
        '-z',
        String(size * scale),
        String(size * scale),
        join(source, 'icon.png'),
        '--out',
        join(iconset, name),
      ],
      { stdio: 'ignore' },
    );
  }
run('iconutil', ['-c', 'icns', iconset, '-o', join(app, 'Contents', 'Resources', 'AppIcon.icns')]);
rmSync(iconset, { recursive: true });

const plist = {
  CFBundleIdentifier: 'com.hongikarchi.accountswitch',
  CFBundleName: 'AccountSwitch',
  CFBundleDisplayName: 'AccountSwitch',
  CFBundleExecutable: 'AccountSwitch',
  CFBundlePackageType: 'APPL',
  CFBundleShortVersionString: version,
  CFBundleVersion: version,
  CFBundleIconFile: 'AppIcon',
  LSMinimumSystemVersion: '13.0',
  // A menu bar app: no Dock icon until its window is shown; one copy at a time.
  LSUIElement: true,
  LSMultipleInstancesProhibited: true,
  NSHighResolutionCapable: true,
  NSHumanReadableCopyright: 'MIT License',
};
const value = (item) =>
  typeof item === 'boolean'
    ? `<${item}/>`
    : `<string>${String(item).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</string>`;
writeFileSync(
  join(app, 'Contents', 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(plist)
  .map(([key, item]) => `  <key>${key}</key>\n  ${value(item)}`)
  .join('\n')}
</dict>
</plist>
`,
);
run('plutil', ['-lint', join(app, 'Contents', 'Info.plist')]);

// Ad hoc: without a developer ID, but Apple silicon runs only signed code, and a signed bundle
// is "from an unidentified developer" rather than "damaged".
run('codesign', ['--force', '--deep', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);

// The update archive keeps the bundle's links and permissions (ditto), and a disk image to download.
run('ditto', ['-c', '-k', '--keepParent', app, join(out, 'AccountSwitch-mac.zip')]);
const stage = join(out, 'dmg');
mkdirSync(stage);
run('ditto', [app, join(stage, 'AccountSwitch.app')]);
symlinkSync('/Applications', join(stage, 'Applications'));
run('hdiutil', [
  'create',
  '-volname',
  'AccountSwitch',
  '-srcfolder',
  stage,
  '-ov',
  '-format',
  'UDZO',
  join(out, 'AccountSwitch.dmg'),
]);
rmSync(stage, { recursive: true });
console.log('Built release/mac: AccountSwitch.app, AccountSwitch-mac.zip, AccountSwitch.dmg');
