import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { DomainError } from './errors.ts';

// macOS: Claude Code keeps its login in the login keychain, not in .credentials.json. The item's
// service is "Claude Code-credentials" for ~/.claude, and for a CLAUDE_CONFIG_DIR that name plus
// the first 8 hex digits of the SHA-256 of the directory string exactly as exported (NFC). The
// value is the same JSON as .credentials.json. Items are read and written with Apple's own
// `security` tool, as Claude Code does, so the keychain never asks for permission.

/** A generic-password store keyed by service name (the account is the macOS user). */
export interface Keychain {
  get(service: string): string | undefined;
  set(service: string, value: string): void;
  delete(service: string): void;
}

/** The keychain service Claude Code uses for a config directory (undefined: ~/.claude). */
export function claudeKeychainService(configDir?: string) {
  if (configDir === undefined) return 'Claude Code-credentials';
  const digest = createHash('sha256').update(configDir.normalize('NFC'), 'utf8').digest('hex');
  return 'Claude Code-credentials-' + digest.slice(0, 8);
}

// The absolute path, never one found on PATH: this reads and writes credentials.
const SECURITY = '/usr/bin/security';
const NOT_FOUND = 44;

function account() {
  return process.env.USER || userInfo().username || 'claude-code-user';
}
function run(args: string[]) {
  try {
    return { status: 0, output: execFileSync(SECURITY, args, { encoding: 'utf8', timeout: 5000 }) };
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (status === NOT_FOUND) return { status, output: '' };
    // Locked, denied, timed out or missing: never treated as "no login".
    throw new DomainError('KEYCHAIN_UNAVAILABLE');
  }
}

/** The macOS login keychain through /usr/bin/security. */
export function macKeychain(): Keychain {
  return {
    get(service) {
      const { status, output } = run([
        'find-generic-password',
        '-a',
        account(),
        '-s',
        service,
        '-w',
      ]);
      return status === NOT_FOUND ? undefined : output.replace(/\n$/, '');
    },
    set(service, value) {
      // Hex keeps any character intact; -U replaces an existing item.
      run([
        'add-generic-password',
        '-U',
        '-a',
        account(),
        '-s',
        service,
        '-X',
        Buffer.from(value, 'utf8').toString('hex'),
      ]);
    },
    delete(service) {
      run(['delete-generic-password', '-a', account(), '-s', service]);
    },
  };
}
