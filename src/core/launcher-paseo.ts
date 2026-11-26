import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from './errors.ts';
import { folderProblem } from './launcher.ts';
import { providers, type Provider } from './providers.ts';
import { runCommand, type CommandRunner } from './setup/commands.ts';
import { paseoCli, type PaseoCli } from './setup/ai-settings-pc.ts';

// "Claude 열기" and "GPT 열기" through Paseo (SPEC 4.1, ADR-010): the model list, the saved
// choice, and the agent made in the chosen folder. The desktop shell only picks the folder.

const CLI_TIMEOUT_MS = 30_000;
const MODELS_KEPT_MS = 10 * 60_000;
const DAEMON_WAIT_MS = 20_000;

/** Paseo's name for each service. */
export const paseoProvider: Record<Provider, 'claude' | 'codex'> = {
  'claude-cli': 'claude',
  'codex-cli': 'codex',
};

export const FIRST_MESSAGE =
  '이 폴더에서 관제탑으로 일해 주세요. 이 폴더가 git 저장소인데 아직 Paseo 방식으로 세팅되지 않았으면 먼저 paseo-workflow 스킬로 세팅하세요. 다른 폴더는 건드리지 마세요. 그다음 무엇을 할지 물어봐 주세요.';

/** A model id as Paseo writes them; anything else never reaches its command line. */
export const modelId = z.string().regex(/^[A-Za-z0-9][\w.:\-[\]]{0,119}$/);

/** `관제탑 - <folder name>`; a drive root has no name of its own. */
export function agentTitle(folder: string) {
  return `관제탑 - ${win32.basename(folder) || folder}`;
}

/** The agent link the running Paseo window opens, as Paseo's own `buildAgentDeepLink`. */
export function agentLink(serverId: string, agentId: string) {
  return `paseo://h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}

/**
 * The CLI's environment: without the marks of a Paseo agent this engine may have been started
 * from, which would put the new agent in that agent's workspace whatever `--cwd` says (measured).
 */
export function paseoEnvironment(source: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source))
    if (
      !/^(PASEO_AGENT_ID|PASEO_AGENT_CWD|PASEO_WORKSPACE_ID|PASEO_CLI|PASEO_DESKTOP_CLI)$/i.test(
        key,
      )
    )
      env[key] = value;
  return { ...env, ...extra };
}

/** The desktop app's environment: Electron, not Node (as Paseo's `cleanEnvForDesktopLaunch`). */
export function desktopEnvironment(source: NodeJS.ProcessEnv) {
  const env = paseoEnvironment(source);
  for (const key of Object.keys(env))
    if (/^(ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|PASEO_NODE_ENV)$/i.test(key))
      delete env[key];
  return env;
}

/** The JSON a Paseo command printed, from its first `{` or `[`; undefined when there is none. */
export function paseoJson(stdout: string): unknown {
  const start = stdout.search(/[[{]/);
  if (start < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
}

const modelList = z.array(z.object({ id: z.string(), model: z.string().optional() }).loose());
const providerList = z.array(z.object({ provider: z.string(), status: z.string() }).loose());
const workspaceList = z.array(
  z
    .object({
      workspaceId: z.string(),
      isolation: z.string().optional(),
      cwd: z.string().optional(),
      background: z.boolean().optional(),
    })
    .loose(),
);
const runAnswer = z.object({ agentId: z.string().min(1) }).loose();
const statusAnswer = z.object({ serverId: z.string().min(1) }).loose();

const savedSchema = z.object({
  version: z.literal(1),
  models: z.record(z.string(), z.string()).default({}),
});

export interface Model {
  id: string;
  label: string;
}
export type Models = Record<Provider, { models: Model[]; chosen: string | null }>;

export interface PaseoLauncherOptions {
  /** `launcher.json` in the data folder. */
  file: string;
  run?: CommandRunner;
  /** Starts the desktop app, detached; tests record it instead. */
  startDesktop?: (program: string, args: string[], env: NodeJS.ProcessEnv) => void;
  cli?: () => PaseoCli | undefined;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function startDetached(program: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(program, args, {
    env,
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.once('error', () => undefined);
  child.unref();
}

export class PaseoLauncher {
  private options: Required<PaseoLauncherOptions>;
  private kept?: { until: number; lists: Record<Provider, Model[]> };

  constructor(options: PaseoLauncherOptions) {
    this.options = {
      run: runCommand,
      startDesktop: startDetached,
      cli: () =>
        paseoCli({
          platform: process.platform,
          env: process.env,
          home: homedir(),
          exists: existsSync,
        }),
      platform: process.platform,
      env: process.env,
      now: Date.now,
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      ...options,
    };
  }

  /** Whether Paseo's CLI is on this PC. */
  available() {
    return !!this.options.cli();
  }

  private async paseo(cli: PaseoCli, args: string[]) {
    const request = cli(args);
    const result = await this.options.run({
      program: request.program,
      args: request.args,
      env: paseoEnvironment(this.options.env, request.env),
      timeoutMs: CLI_TIMEOUT_MS,
    });
    return paseoJson(result.stdout);
  }

  private async lists(): Promise<Record<Provider, Model[]>> {
    const empty = { 'claude-cli': [], 'codex-cli': [] } as Record<Provider, Model[]>;
    if (this.kept && this.kept.until > this.options.now()) return this.kept.lists;
    const cli = this.options.cli();
    if (!cli) return empty;
    const known = providerList.safeParse(await this.paseo(cli, ['provider', 'ls', '--json'])).data;
    if (!known) return empty;
    const lists = { ...empty };
    let failed = false;
    for (const service of providers) {
      const name = paseoProvider[service];
      if (!known.some((p) => p.provider === name && p.status === 'available')) continue;
      const models = modelList.safeParse(
        await this.paseo(cli, ['provider', 'models', name, '--json']),
      ).data;
      if (!models) {
        failed = true;
        continue;
      }
      lists[service] = models
        .filter((m) => modelId.safeParse(m.id).success)
        .map((m) => ({ id: m.id, label: m.model || m.id }));
    }
    // A failed lookup is asked again next time.
    if (!failed) this.kept = { until: this.options.now() + MODELS_KEPT_MS, lists };
    return lists;
  }

  private saved(): Record<string, string> {
    try {
      return savedSchema.parse(JSON.parse(readFileSync(this.options.file, 'utf8'))).models;
    } catch {
      return {};
    }
  }

  /** Paseo's models per service, with the one to show selected. */
  async models(): Promise<Models> {
    const lists = await this.lists();
    const saved = this.saved();
    const result = {} as Models;
    for (const service of providers) {
      const models = lists[service];
      const chosen = models.find((m) => m.id === saved[service])?.id ?? models[0]?.id ?? null;
      result[service] = { models, chosen };
    }
    return result;
  }

  /** Remember the model chosen for a service. */
  choose(service: Provider, model: string) {
    const value = { version: 1, models: { ...this.saved(), [service]: modelId.parse(model) } };
    const temporary = `${this.options.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, this.options.file);
  }

  /** The daemon's server id; starts the desktop app and waits when the daemon does not answer. */
  private async serverId(cli: PaseoCli) {
    const ask = async () =>
      statusAnswer.safeParse(await this.paseo(cli, ['status', '--json'])).data?.serverId;
    let id = await ask();
    if (id) return id;
    const program = cli([]).program;
    this.options.startDesktop(program, [], desktopEnvironment(this.options.env));
    const until = this.options.now() + DAEMON_WAIT_MS;
    while (!id && this.options.now() < until) {
      await this.options.sleep(1000);
      id = await ask();
    }
    if (!id) throw new DomainError('PASEO_FAILED');
    return id;
  }

  /** The visible local workspace of this folder, if Paseo has one. */
  private async workspace(cli: PaseoCli, folder: string) {
    const list = workspaceList.safeParse(await this.paseo(cli, ['workspace', 'ls', '--json'])).data;
    const same = (path?: string) => !!path && resolve(path).toLowerCase() === folder.toLowerCase();
    return list?.find((w) => w.isolation === 'local' && !w.background && same(w.cwd))?.workspaceId;
  }

  /** Make the coordinator agent in the folder and show it in the Paseo window. */
  async open(service: Provider, folder: string, model: string) {
    if (this.options.platform !== 'win32') throw new DomainError('UNSUPPORTED_PLATFORM');
    const problem = folderProblem(folder);
    if (problem) throw new DomainError(problem);
    const id = modelId.parse(model);
    const cli = this.options.cli();
    if (!cli) throw new DomainError('PASEO_UNAVAILABLE');
    const directory = resolve(folder);
    const server = await this.serverId(cli);
    const workspace = await this.workspace(cli, directory);
    const args = ['run', '--cwd', directory];
    if (workspace) args.push('--workspace', workspace);
    args.push(
      '--provider',
      `${paseoProvider[service]}/${id}`,
      '--title',
      agentTitle(directory),
      '--no-wait',
      '--json',
      FIRST_MESSAGE,
    );
    const agent = runAnswer.safeParse(await this.paseo(cli, args)).data?.agentId;
    if (!agent) throw new DomainError('PASEO_FAILED');
    this.options.startDesktop(
      cli([]).program,
      [agentLink(server, agent)],
      desktopEnvironment(this.options.env),
    );
    return { folder: directory, agentId: agent };
  }
}
