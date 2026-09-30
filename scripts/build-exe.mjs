// Build release/engine/AccountSwitch-engine(.exe) (the app server the PC program runs; alone it
// opens the page in the browser): the server bundled into one CommonJS script, the built page
// (dist/ui) embedded as assets, injected into a copy of the Node runtime running this script
// (Node single executable application). Run `npm run build:web` first (`npm run build:exe` does).
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const [major, minor] = process.versions.node.split('.').map(Number);
// The executable ships this very runtime, so it must meet the app's own Node requirement.
if (major < 24 || (major === 24 && minor < 15)) {
  console.error(
    `Node 24.15 or later is needed to build the executable (this is ${process.version}).`,
  );
  process.exit(1);
}
const mac = process.platform === 'darwin';
if (process.platform !== 'win32' && !mac) {
  console.error('The executable is built on Windows or macOS.');
  process.exit(1);
}

const out = join(root, 'release', 'engine');
const work = join(out, 'build');
const exe = join(out, mac ? 'AccountSwitch-engine' : 'AccountSwitch-engine.exe');
rmSync(out, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'server', 'main.ts')],
  outfile: join(work, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  legalComments: 'none',
  logOverride: { 'empty-import-meta': 'silent' },
});

const ui = join(root, 'dist', 'ui');
const files = (folder) =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)],
  );
const assets = Object.fromEntries(
  files(ui).map((file) => ['ui/' + relative(ui, file).replaceAll('\\', '/'), file]),
);
if (!assets['ui/index.html']) {
  console.error('dist/ui/index.html is missing; run `npm run build:web` first.');
  process.exit(1);
}
const config = join(work, 'sea-config.json');
writeFileSync(
  config,
  JSON.stringify({
    main: join(work, 'main.cjs'),
    output: join(work, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
    assets,
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
copyFileSync(process.execPath, exe);
if (mac) {
  // Node's signature would no longer match after the injection; remove it first.
  execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
} else {
  // Injecting leaves Node's own signature invalid, which some antivirus rates worse than none, so
  // remove it first. Required on CI (GitHub sets CI); optional on a developer machine.
  const signtool = findSigntool();
  if (signtool) execFileSync(signtool, ['remove', '/s', exe], { stdio: 'inherit' });
  else if (process.env.CI) {
    console.error('signtool.exe (Windows SDK) was not found; set SIGNTOOL to its path.');
    process.exit(1);
  } else console.warn('signtool.exe not found: the executable keeps an invalid Node signature.');
}
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'postject', 'dist', 'cli.js'),
    exe,
    'NODE_SEA_BLOB',
    join(work, 'sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(mac ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ],
  { stdio: 'inherit' },
);
if (mac) {
  // Apple silicon runs no unsigned code: sign it for this machine (ad hoc, no developer ID).
  execFileSync('codesign', ['--sign', '-', '--force', exe], { stdio: 'inherit' });
  chmodSync(exe, 0o755);
}
rmSync(work, { recursive: true, force: true });
console.log('Built ' + relative(root, exe));

/** signtool.exe: SIGNTOOL, PATH, or the newest x64 one of the Windows 10/11 SDK. */
function findSigntool() {
  const onPath = (process.env.PATH ?? '')
    .split(';')
    .map((folder) => folder && join(folder, 'signtool.exe'));
  const kits = join(process.env['ProgramFiles(x86)'] ?? '', 'Windows Kits', '10', 'bin');
  let sdk = [];
  try {
    sdk = readdirSync(kits)
      .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
      .map((name) => join(kits, name, 'x64', 'signtool.exe'));
  } catch {
    /* No Windows SDK. */
  }
  return [process.env.SIGNTOOL, ...onPath, ...sdk].find((file) => file && existsSync(file));
}
