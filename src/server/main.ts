import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.ts';

// Start the local app and open it in the default browser. A second start opens the running one.
const directory =
  process.env.ACCOUNTSWITCH_DATA ||
  join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'AccountSwitch');
mkdirSync(directory, { recursive: true });
const launchFile = join(directory, 'launch.json');
const noOpen = process.argv.includes('--no-open');

function open(url: string) {
  if (noOpen) return;
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

try {
  const running = JSON.parse(readFileSync(launchFile, 'utf8')) as { url: string; pid: number };
  process.kill(running.pid, 0);
  const alive = await fetch(new URL('api/v1/accounts', running.url)).catch(() => undefined);
  if (alive) {
    open(running.url);
    console.log(`AccountSwitch is already running: ${new URL(running.url).origin}`);
    process.exit(0);
  }
} catch {
  /* Not running. */
}

const app = await startServer({ directory, port: Number(process.env.ACCOUNTSWITCH_PORT) || 0 });
writeFileSync(launchFile, JSON.stringify({ url: app.launchUrl, pid: process.pid }), {
  mode: 0o600,
});
console.log(`AccountSwitch: ${app.url}`);
open(app.launchUrl);
const stop = () => void app.close().finally(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
