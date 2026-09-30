// Build release/AccountSwitch-Setup-<version>.exe from release/AccountSwitch.exe with Inno Setup 6
// (ISCC.exe on PATH, in its usual folders, or named by the ISCC environment variable).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!existsSync(join(root, 'release', 'AccountSwitch.exe'))) {
  console.error('release/AccountSwitch.exe is missing; run `npm run build:exe` first.');
  process.exit(1);
}
const onPath = (process.env.PATH ?? '')
  .split(';')
  .map((folder) => folder && join(folder, 'ISCC.exe'));
const iscc = [
  process.env.ISCC,
  ...onPath,
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6', 'ISCC.exe'),
  join(process.env.ProgramFiles ?? '', 'Inno Setup 6', 'ISCC.exe'),
].find((file) => file && existsSync(file));
if (!iscc) {
  console.error('Inno Setup 6 (ISCC.exe) was not found. Install it, or set ISCC to its path.');
  process.exit(1);
}
execFileSync(
  iscc,
  ['/Qp', `/DAppVersion=${version}`, join(root, 'installer', 'AccountSwitch.iss')],
  {
    stdio: 'inherit',
  },
);
console.log(`Built release\\AccountSwitch-Setup-${version}.exe`);
