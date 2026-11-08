import { z } from 'zod';
import {
  expandPath,
  pathHasFolder,
  powershellPath,
  programInFolder,
  readWindowsSnapshot,
  type WindowsSnapshot,
} from './environment.ts';
import { StepStop } from './install-deps.ts';
import type { StepContext, StepResult } from './install-steps.ts';
import type { InstallStep, SetupItem } from './types.ts';

// What Windows itself gets told: the user PATH, a user variable, the execution policy, and whether a
// program runs. Decisions are pure functions; the writes run in PowerShell through the runner.

/** Windows refuses a longer environment value. */
const MAX_PATH_VALUE = 32000;

/**
 * Append one entry to the user PATH as it stands in the registry, unexpanded. Every other entry
 * stays exactly as it was. Not changed when already there, written either way, in any letter case.
 */
export function appendPathEntry(
  raw: string | null | undefined,
  entry: string,
  expand: (value: string) => string,
) {
  const current = raw ?? '';
  const expanded = current.split(';').map(expand).join(';');
  if (pathHasFolder(expanded, expand(entry))) return { value: current, changed: false };
  const kept = current.replace(/[;\s]+$/, '');
  const value = kept ? `${kept};${entry}` : entry;
  if (value.length > MAX_PATH_VALUE) throw new Error('USER_PATH_TOO_LONG');
  return { value, changed: true };
}

export type PolicyPlan =
  /** Nothing to do: scripts are allowed. */
  | 'fine'
  | 'set'
  /** A group policy wins over CurrentUser (SPEC 3.5). */
  | 'blocked-by-group'
  /** The user chose something else on purpose. */
  | 'left-alone';

const ALLOWED_POLICIES = ['RemoteSigned', 'Unrestricted', 'Bypass'];

/** SPEC 3.5: set only from `Undefined` or `Restricted`, and only with no group policy over it. */
export function planExecutionPolicy(policies: Record<string, string>): PolicyPlan {
  const enforced = [policies.MachinePolicy, policies.UserPolicy].find(
    (policy) => policy && policy !== 'Undefined',
  );
  if (enforced) return ALLOWED_POLICIES.includes(enforced) ? 'fine' : 'blocked-by-group';
  const current = policies.CurrentUser ?? 'Undefined';
  if (ALLOWED_POLICIES.includes(current)) return 'fine';
  return current === 'Undefined' || current === 'Restricted' ? 'set' : 'left-alone';
}

/** Whether `tasklist /FO CSV /NH` lists exactly this program. Another language's "none" won't. */
export function tasklistHas(stdout: string, image: string) {
  const wanted = `"${image.toLowerCase()}",`;
  return stdout.split(/\r?\n/).some((line) => line.trim().toLowerCase().startsWith(wanted));
}

/** True, false, or undefined when Windows did not say. Looks only; nothing here ever stops one. */
export async function isProgramRunning(context: StepContext, image: string) {
  const result = await context.exec(
    {
      program: context.path('%SystemRoot%\\System32\\tasklist.exe'),
      args: ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'],
    },
    { label: `tasklist: ${image}`, quiet: true },
  );
  if (result.code !== 0) return undefined;
  return tasklistHas(result.stdout, image);
}

const READ_USER_PATH = [
  "$ErrorActionPreference='Stop'",
  '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)',
  "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')",
  '$v=$null',
  "if($k){$v=$k.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}",
  '@{value=$v}|ConvertTo-Json -Compress',
].join(';');

// The value travels in the environment, so no quoting can break it. Never `setx`: it truncates.
export const WRITE_USER_PATH = [
  "$ErrorActionPreference='Stop'",
  "$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')",
  "$k.SetValue('Path',$env:ACCOUNTSWITCH_VALUE,[Microsoft.Win32.RegistryValueKind]::ExpandString)",
  '$k.Close()',
].join(';');

export const BROADCAST_SETTING_CHANGE = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -Namespace AccountSwitch -Name Native -MemberDefinition \'[DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string l,uint f,uint t,out UIntPtr r);\'',
  '$r=[UIntPtr]::Zero',
  "[void][AccountSwitch.Native]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$r)",
].join(';');

export const SET_USER_VARIABLE =
  "$ErrorActionPreference='Stop';[Environment]::SetEnvironmentVariable($env:ACCOUNTSWITCH_NAME,$env:ACCOUNTSWITCH_VALUE,'User')";

export const SET_EXECUTION_POLICY =
  "$ErrorActionPreference='Stop';Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy $env:ACCOUNTSWITCH_VALUE -Force";

const rawPathSchema = z.object({ value: z.string().nullable() });

function powershell(
  context: StepContext,
  script: string,
  label: string,
  extraEnv: Record<string, string> = {},
) {
  const { env, home } = context.deps.check;
  return context.exec(
    {
      program: powershellPath(env, home),
      args: ['-NoProfile', '-NonInteractive', '-Command', script],
      env: { ...context.childEnv(), ...extraEnv },
    },
    // The output of these is PATH and the like, which has no place in a log.
    { label: `PowerShell: ${label}`, quiet: true },
  );
}

const SETTINGS_FAILED = 'Windows 설정을 바꾸지 못했어요. 로그를 확인해 보세요.';
const failed = () => new StepStop('failed', 'SETTINGS_WRITE_FAILED', SETTINGS_FAILED);

/**
 * Append folders to the user PATH and tell running programs. If the current value cannot be read,
 * nothing is written: writing then could only lose what the user had.
 */
export async function addToUserPath(context: StepContext, folders: string[]) {
  const read = await powershell(context, READ_USER_PATH, 'read user PATH');
  if (read.code !== 0) throw failed();
  let raw: string | null;
  try {
    raw = rawPathSchema.parse(JSON.parse(read.stdout.slice(read.stdout.indexOf('{')))).value;
  } catch {
    throw failed();
  }
  let value = raw ?? '';
  let changed = false;
  for (const folder of folders) {
    const next = appendPathEntry(value, folder, context.path);
    value = next.value;
    changed ||= next.changed;
  }
  if (!changed) return;
  const write = await powershell(context, WRITE_USER_PATH, 'write user PATH', {
    ACCOUNTSWITCH_VALUE: value,
  });
  if (write.code !== 0) throw failed();
  await broadcast(context);
}

/** A failed broadcast only means open programs learn later, so it does not fail the item. */
async function broadcast(context: StepContext) {
  await powershell(context, BROADCAST_SETTING_CHANGE, 'WM_SETTINGCHANGE');
}

/** SPEC 3.5 step 4: the item's program is there, but no PATH leads to its folder. */
export async function ensureItemOnPath(context: StepContext, item: SetupItem) {
  const { check } = context.deps;
  const present = (item.install.pathFolders ?? []).filter(({ folder, program }) =>
    programInFolder(context.path(folder), program, check.exists),
  );
  if (!present.length) return;
  const snapshot = await readWindowsSnapshot(check.run, check.env, check.home);
  if (!snapshot) throw failed();
  const off = [...new Set(present.map(({ folder }) => folder))].filter((folder) => {
    const expanded = context.path(folder);
    return (
      !pathHasFolder(snapshot.machinePath, expanded) && !pathHasFolder(snapshot.userPath, expanded)
    );
  });
  if (off.length) await addToUserPath(context, off);
}

/** The `env` item (SPEC 3.5). Sets what is missing; a policy it may not change goes to the user. */
export async function applyEnvironment(
  context: StepContext,
  step: Extract<InstallStep, { kind: 'environment' }>,
): Promise<StepResult> {
  const { check } = context.deps;
  const snapshot: WindowsSnapshot | undefined = await readWindowsSnapshot(
    check.run,
    check.env,
    check.home,
  );
  if (!snapshot)
    throw new StepStop(
      'failed',
      'CHECK_FAILED',
      'Windows 설정을 읽지 못했어요. 다시 시도해 보세요.',
    );
  if (!/^[A-Za-z]+$/.test(step.executionPolicy)) throw failed();

  const folder = expandPath(step.userPathFolder, check.env, check.home);
  if (!pathHasFolder(snapshot.userPath, folder))
    await addToUserPath(context, [step.userPathFolder]);

  let variableChanged = false;
  for (const [name, value] of Object.entries(step.userVariables)) {
    if (name === 'PYTHONUTF8' && snapshot.pythonUtf8 === value) continue;
    const set = await powershell(context, SET_USER_VARIABLE, `user variable ${name}`, {
      ACCOUNTSWITCH_NAME: name,
      ACCOUNTSWITCH_VALUE: value,
    });
    if (set.code !== 0) throw failed();
    variableChanged = true;
  }
  if (variableChanged) await broadcast(context);

  const plan = planExecutionPolicy(snapshot.executionPolicy);
  if (plan === 'set') {
    const set = await powershell(context, SET_EXECUTION_POLICY, 'execution policy', {
      ACCOUNTSWITCH_VALUE: step.executionPolicy,
    });
    if (set.code !== 0) throw failed();
  }
  if (plan === 'blocked-by-group')
    return {
      ran: true,
      needsUser: {
        reason: 'POLICY_BLOCKED',
        message: '회사나 학교의 정책이 스크립트 실행을 막고 있어요. 관리자에게 문의하세요.',
      },
    };
  if (plan === 'left-alone')
    return {
      ran: true,
      needsUser: {
        reason: 'POLICY_LEFT_ALONE',
        message:
          '스크립트 실행 설정을 이미 다른 값으로 정해 두셨어요. 그대로 뒀으니 필요하면 직접 바꿔 주세요.',
      },
    };
  return { ran: true };
}
