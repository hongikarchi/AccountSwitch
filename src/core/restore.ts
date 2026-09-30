import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AccountProfiles } from './account-profiles.ts';
import { DefaultLogin } from './default-login.ts';
import { providers } from './providers.ts';

/**
 * Put each service's original login (the one before any switch) back into ~/.claude / ~/.codex,
 * so removing the program leaves the CLIs as they were. Run by the uninstaller; accounts stay in
 * the data folder. One service failing does not stop the other.
 */
export async function restoreDefaultLogins(root: string, home?: string) {
  const result = { restored: [] as string[], failed: [] as string[] };
  if (!existsSync(join(root, 'profiles.json'))) return result;
  const profiles = new AccountProfiles(root, () => false);
  const login = new DefaultLogin({ root, ...(home ? { home } : {}) });
  for (const provider of providers) {
    if (profiles.selected(provider) === 'default') continue;
    try {
      const release = await login.lock(provider);
      try {
        profiles.select(provider, 'default', (from, to) => login.swap(provider, from, to));
      } finally {
        release();
      }
      result.restored.push(provider);
    } catch (error) {
      result.failed.push(`${provider}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return result;
}
