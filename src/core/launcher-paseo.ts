import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { DomainError } from './errors.ts';
import { folderProblem } from './launcher.ts';
import { runCommand, type CommandRunner } from './setup/commands.ts';
import { paseoCli, type PaseoCli } from './setup/ai-settings-pc.ts';

// "Paseo 열기" (SPEC 4.1, ADR-012): the folder's Paseo workspace, registered if needed, and the
// Paseo window brought to it. No agent is made and no message is sent; the desktop shell only
// picks the folder and, when there is no agent to link to, brings the window forward.

const CLI_TIMEOUT_MS = 30_000;
const DAEMON_WAIT_MS = 20_000;

/** The agent link the running Paseo window opens, as Paseo's own `buildAgentDeepLink`. */
export function agentLink(serverId: string, agentId: string) {
  return `paseo://h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}

/**
 * The CLI's environment: without the marks of a Paseo agent this engine may have been started
 * from, which would make the CLI act in that agent's workspace whatever the path says (measured).
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

/**
 * The JSON a Paseo command printed, from the first line starting with `{` or `[`: lines before it,
 * such as "Created workspace <id> - <folder name>", may hold brackets of a folder's name.
 */
export function paseoJson(stdout: string): unknown {
  const start = stdout.search(/^[[{]/m);
  if (start < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
}

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
const workspaceAnswer = z.object({ workspaceId: z.string().min(1) }).loose();
const agentList = z.array(
  z
    .object({
      id: z.string().min(1),
      workspaceId: z.string().optional(),
      background: z.boolean().optional(),
    })
    .loose(),
);
const statusAnswer = z.object({ serverId: z.string().min(1) }).loose();

export interface PaseoLauncherOptions {
  run?: CommandRunner;
  /** Starts the desktop app, detached; tests record it instead. */
  startDesktop?: (program: string, args: string[], env: NodeJS.ProcessEnv) => void;
  cli?: () => PaseoCli | undefined;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** What the Paseo window was given: an agent of the folder, or nothing (the shell shows it). */
export type Shown = 'agent' | 'window';

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

  constructor(options: PaseoLauncherOptions = {}) {
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

  /** The daemon's server id; starts the desktop app and waits when the daemon does not answer. */
  private async serverId(cli: PaseoCli) {
    const ask = async () =>
      statusAnswer.safeParse(await this.paseo(cli, ['status', '--json'])).data?.serverId;
    let id = await ask();
    if (id) return id;
    this.options.startDesktop(cli([]).program, [], desktopEnvironment(this.options.env));
    const until = this.options.now() + DAEMON_WAIT_MS;
    while (!id && this.options.now() < until) {
      await this.options.sleep(1000);
      id = await ask();
    }
    if (!id) throw new DomainError('PASEO_FAILED');
    return id;
  }

  /** The visible local workspace of this folder, made (with its project) when there is none. */
  private async workspace(cli: PaseoCli, folder: string) {
    const list = workspaceList.safeParse(await this.paseo(cli, ['workspace', 'ls', '--json'])).data;
    const same = (path?: string) => !!path && resolve(path).toLowerCase() === folder.toLowerCase();
    const found = list?.find((w) => w.isolation === 'local' && !w.background && same(w.cwd));
    if (found) return found.workspaceId;
    const made = workspaceAnswer.safeParse(
      await this.paseo(cli, [
        'workspace',
        'create',
        '--isolation',
        'local',
        '--path',
        folder,
        '--no-background',
        '--json',
      ]),
    ).data?.workspaceId;
    if (!made) throw new DomainError('PASEO_FAILED');
    return made;
  }

  /** An agent of the workspace the window can be sent to, if it has one. */
  private async agentOf(cli: PaseoCli, workspace: string) {
    const list = agentList.safeParse(await this.paseo(cli, ['ls', '--global', '--json'])).data;
    return list?.find((a) => a.workspaceId === workspace && !a.background)?.id;
  }

  /**
   * Register the folder in Paseo and bring the window to it. Paseo takes from outside only an
   * agent link (ADR-012): with an agent in the folder's workspace the window opens it; without
   * one the answer is `window`, and the page has the shell bring Paseo forward.
   */
  async open(folder: string): Promise<{ folder: string; workspaceId: string; shown: Shown }> {
    if (this.options.platform !== 'win32') throw new DomainError('UNSUPPORTED_PLATFORM');
    const problem = folderProblem(folder);
    if (problem) throw new DomainError(problem);
    const cli = this.options.cli();
    if (!cli) throw new DomainError('PASEO_UNAVAILABLE');
    const directory = resolve(folder);
    const server = await this.serverId(cli);
    const workspaceId = await this.workspace(cli, directory);
    const agent = await this.agentOf(cli, workspaceId);
    if (!agent) return { folder: directory, workspaceId, shown: 'window' };
    this.options.startDesktop(
      cli([]).program,
      [agentLink(server, agent)],
      desktopEnvironment(this.options.env),
    );
    return { folder: directory, workspaceId, shown: 'agent' };
  }
}
