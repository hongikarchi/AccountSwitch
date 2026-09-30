// Build the PC program into release/app: the window/tray shell (src/desktop/shell, .NET Framework
// 4.8 + WebView2) with the app server next to it (engine/AccountSwitch-engine.exe, made by
// build-exe.mjs). With --installer, also the Velopack installer and update packages in
// release/installer (Setup.exe, Portable.zip, nupkg, releases.win.json).
// Run `npm run build:exe` first (`npm run build:desktop` / `build:installer` do).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const engine = join(root, 'release', 'engine', 'AccountSwitch-engine.exe');
if (!existsSync(engine)) {
  console.error(
    'release/engine/AccountSwitch-engine.exe is missing; run `npm run build:exe` first.',
  );
  process.exit(1);
}
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });

const shell = join(root, 'src', 'desktop', 'shell');
run('dotnet', [
  'build',
  join(shell, 'AccountSwitch.Desktop.csproj'),
  '-c',
  'Release',
  `-p:Version=${version}`,
]);

const app = join(root, 'release', 'app');
rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, 'engine'), { recursive: true });
const output = join(root, '.build', 'desktop', 'bin');
for (const entry of readdirSync(output))
  if (!entry.endsWith('.pdb')) cpSync(join(output, entry), join(app, entry), { recursive: true });
cpSync(engine, join(app, 'engine', 'AccountSwitch-engine.exe'));
cpSync(join(root, 'LICENSE'), join(app, 'LICENSE.txt'));
console.log('Built release\\app');

if (process.argv.includes('--installer')) {
  const installer = join(root, 'release', 'installer');
  run('dotnet', ['tool', 'restore']);
  // The pack id names the install folder (%LOCALAPPDATA%\AccountSwitch.App), which uninstall
  // deletes; it must never be the data folder (%LOCALAPPDATA%\AccountSwitch).
  run('dotnet', [
    'vpk',
    'pack',
    '--packId',
    'AccountSwitch.App',
    '--packVersion',
    version,
    '--packDir',
    app,
    '--runtime',
    'win-x64',
    '--mainExe',
    'AccountSwitch.exe',
    '--packTitle',
    'AccountSwitch',
    '--packAuthors',
    'hongikarchi',
    '--icon',
    join(shell, 'accountswitch.ico'),
    '--outputDir',
    installer,
  ]);
  console.log('Built release\\installer');
}
