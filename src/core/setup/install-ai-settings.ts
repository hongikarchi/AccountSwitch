import { join } from 'node:path';
import { loadAiContent } from './ai-content.ts';
import { aiReader, paseoCli, paseoHome } from './ai-settings-pc.ts';
import {
  applyAiSettings,
  parsePrefs,
  pendingRows,
  placesOf,
  planAiSettings,
  PREFS_FILE,
  prefsText,
  type AiWriter,
} from './ai-settings.ts';
import { StepStop } from './install-deps.ts';
import type { StepContext, StepResult } from './install-steps.ts';

// SPEC 3.11: apply the AI work settings with the prefix, mode and kept rows the user saved. Each
// file is backed up before it is replaced; the plan is made again here, so it is never stale.

const UNSET = '브랜치 접두어를 정하고 다시 눌러 주세요.';

const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');

export async function applyAiSettingsStep(context: StepContext): Promise<StepResult> {
  const { check, files, directory } = context.deps;
  const prefsPath = join(directory, PREFS_FILE);
  const prefs = parsePrefs(files.read(prefsPath));
  if (!prefs.branchPrefix) throw new StepStop('needs-user', 'AI_SETTINGS_UNSET', UNSET);
  const cli = paseoCli(check);
  const exec = (request: { program: string; args: string[]; env?: NodeJS.ProcessEnv }) =>
    context.exec({ ...request, env: { ...context.childEnv(), ...request.env } }, { quiet: true });
  const reader = await aiReader(check, exec);
  const home = paseoHome(check);
  const places = placesOf(check.platform, check.home, home);
  const rows = planAiSettings(
    loadAiContent(),
    reader,
    { ...prefs, branchPrefix: prefs.branchPrefix },
    home,
  );
  if (!pendingRows(rows, prefs.keep).length) return { ran: true };

  const backupFolder = places.join(
    check.home,
    '.claude',
    'backups',
    `accountswitch-ai-settings-${stamp(context.deps.now())}`,
  );
  const filesUnder = (folder: string, at = ''): string[] => [
    ...check.listFiles(folder).map((name) => at + name),
    ...check
      .listFolders(folder)
      .flatMap((name) => filesUnder(places.join(folder, name), `${at}${name}/`)),
  ];
  const writer: AiWriter = {
    read: (path) => files.read(path),
    write: (path, data) => files.write(path, data),
    copy: (from, to) => {
      const bytes = files.read(from);
      if (bytes) files.write(to, bytes);
    },
    exists: check.exists,
    filesUnder,
    paseo: async (args) => (cli ? exec(cli(args)) : { code: 1 }),
    log: (line) => context.log.line(line),
    backupFolder,
  };
  const outcome = await applyAiSettings(
    rows,
    prefs.keep,
    writer,
    places,
    check.home,
    prefs.written,
  );
  files.write(prefsPath, prefsText({ ...prefs, written: outcome.written }));
  if (outcome.failed.length)
    return {
      ran: true,
      failure: {
        reason: 'AI_SETTINGS_FAILED',
        message: outcome.failed.map((failed) => failed.message).join(' '),
      },
    };
  return {
    ran: true,
    note: outcome.backedUp
      ? `넣었어요. 바꾼 파일은 ${places.show(backupFolder)}에 백업했어요.`
      : '넣었어요.',
  };
}
