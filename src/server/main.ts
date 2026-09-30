import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { restoreDefaultLogins } from '../core/restore.ts';
import { startServer } from './server.ts';

// Start the local app and open it in the default browser. A second start opens the running one.
// --desktop: run under the PC program (src/desktop/shell), which shows the page in its own window:
// no browser, the address is given on standard output, and the app stops when its input closes.
const directory =
  process.env.ACCOUNTSWITCH_DATA ||
  join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'AccountSwitch');
mkdirSync(directory, { recursive: true });
const launchFile = join(directory, 'launch.json');
const desktop = process.argv.includes('--desktop');
const noOpen = desktop || process.argv.includes('--no-open');

function open(url: string) {
  if (noOpen) return;
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

// No top-level await: the installed executable runs this as one CommonJS script.
async function main() {
  // The uninstaller: give the CLIs their original logins back, then stop.
  if (process.argv.includes('--restore-default-login')) {
    const result = await restoreDefaultLogins(join(directory, 'profiles'));
    console.log(`AccountSwitch restored: ${result.restored.join(', ') || 'none'}`);
    for (const failure of result.failed) console.error(failure);
    process.exit(result.failed.length ? 1 : 0);
  }
  try {
    const running = JSON.parse(readFileSync(launchFile, 'utf8')) as { url: string; pid: number };
    process.kill(running.pid, 0);
    const alive = await fetch(new URL('api/v1/accounts', running.url)).catch(() => undefined);
    if (alive) {
      open(running.url);
      // The PC program shows the running one instead (it does not own it).
      if (desktop) console.log(`AccountSwitch attached: ${running.url}`);
      else console.log(`AccountSwitch is already running: ${new URL(running.url).origin}`);
      process.exit(0);
    }
  } catch {
    /* Not running. */
  }

  const app = await startServer({ directory, port: Number(process.env.ACCOUNTSWITCH_PORT) || 0 });
  writeFileSync(launchFile, JSON.stringify({ url: app.launchUrl, pid: process.pid }), {
    mode: 0o600,
  });
  const stop = () => void app.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (desktop) {
    // Only the PC program reads this output. Closing its input (or its end) stops the app.
    console.log(`AccountSwitch launch: ${app.launchUrl}`);
    process.stdin.on('end', stop).on('close', stop).resume();
    return;
  }
  console.log(`AccountSwitch: ${app.url}`);
  console.log('Closing this window stops AccountSwitch.');
  open(app.launchUrl);
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
