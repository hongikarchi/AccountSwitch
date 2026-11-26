// SPEC 3.3 `paseo-settings`: "종료 후에도 데몬 계속 실행" in Paseo's desktop-settings.json. Pure, so
// the check and the step read the file the same way.
//
// Measured in Paseo 0.17.4: the store writes `JSON.stringify(document, null, 2)` plus a newline, and
// resets `keepRunningAfterQuit` to its default whenever `migrations.daemonStopOnQuitDefaultApplied`
// is not true. A file without that flag would undo the change, so it is never written.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * - `on`: the setting is on.
 * - `off`: a file Paseo has finished setting up, with the setting off; it can be turned on.
 * - `missing`: no file yet.
 * - `not-ready`: Paseo has not applied its own default yet, so a change would be undone.
 * - `unreadable`: not the shape Paseo writes; left alone.
 */
export type KeepRunningState = 'on' | 'off' | 'missing' | 'not-ready' | 'unreadable';

function parse(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function keepRunningState(text: string | undefined): KeepRunningState {
  if (text === undefined) return 'missing';
  const document = parse(text);
  if (!document) return 'unreadable';
  const { settings, migrations } = document;
  if (settings !== undefined && !isObject(settings)) return 'unreadable';
  const daemon = isObject(settings) ? settings.daemon : undefined;
  if (daemon !== undefined && !isObject(daemon)) return 'unreadable';
  if (isObject(daemon) && daemon.keepRunningAfterQuit === true) return 'on';
  if (!isObject(migrations) || migrations.daemonStopOnQuitDefaultApplied !== true)
    return 'not-ready';
  return 'off';
}

/** The file with only `settings.daemon.keepRunningAfterQuit` set to true, in Paseo's own format. */
export function withKeepRunning(text: string): string {
  const document = parse(text);
  if (!document) throw new Error('not a Paseo settings file');
  const settings = isObject(document.settings) ? document.settings : {};
  const daemon = isObject(settings.daemon) ? settings.daemon : {};
  const next = {
    ...document,
    settings: { ...settings, daemon: { ...daemon, keepRunningAfterQuit: true } },
  };
  return `${JSON.stringify(next, null, 2)}\n`;
}
