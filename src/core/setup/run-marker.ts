import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// `setup-running` in the data folder (SPEC 3.4): how the PC program knows a run is active, even with
// the window hidden in the tray. Empty on purpose; only its existence means anything.

const FILE = 'setup-running';

export function runMarkerFile(directory: string) {
  return join(directory, FILE);
}

export function setRunMarker(directory: string, active: boolean) {
  const path = runMarkerFile(directory);
  if (!active) return rmSync(path, { force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, '');
}
