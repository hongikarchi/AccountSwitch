import { StepStop } from './install-deps.ts';
import type { LatestSource } from './types.ts';

// SPEC 3.3, latest installers: the newest release of a fallback installer, found when the step
// runs, with the SHA-256 its publisher states on its own host. Anything not of the expected shape
// ends the item instead of guessing.

export interface LatestInstaller {
  url: string;
  sha256: string;
  version: string;
}

/** Reads one small document through the download host list. */
export type ReadText = (url: string) => Promise<Buffer>;

const UNKNOWN = '최신 설치 파일을 찾지 못했어요. 인터넷 연결을 확인하고 다시 시도해 보세요.';
const unknown = () => new StepStop('failed', 'LATEST_UNKNOWN', UNKNOWN);
const VERSION = /^\d+\.\d+\.\d+$/;
const HASH = /^[0-9a-f]{64}$/;

function json(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw unknown();
  }
}

/** The newest LTS on nodejs.org, and its line in that release's SHASUMS256.txt. */
async function nodeLts(read: ReadText): Promise<LatestInstaller> {
  const index = json(await read('https://nodejs.org/dist/index.json'));
  if (!Array.isArray(index)) throw unknown();
  // The index lists the newest release first.
  const entry = index.find((release) => release && typeof release === 'object' && release.lts);
  const version = typeof entry?.version === 'string' ? entry.version.replace(/^v/, '') : '';
  if (!VERSION.test(version)) throw unknown();
  const file = `node-v${version}-x64.msi`;
  const sums = (await read(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`)).toString('utf8');
  const sha256 = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.length === 2 && parts[1] === file)?.[0];
  if (!sha256 || !HASH.test(sha256)) throw unknown();
  return { url: `https://nodejs.org/dist/v${version}/${file}`, sha256, version };
}

type GithubSource = Exclude<LatestSource, 'node-lts'>;

const RELEASES: Record<GithubSource, { repo: string; asset: RegExp }> = {
  'git-for-windows': { repo: 'git-for-windows/git', asset: /^Git-(\d+\.\d+\.\d+)-64-bit\.exe$/ },
  gh: { repo: 'cli/cli', asset: /^gh_(\d+\.\d+\.\d+)_windows_amd64\.msi$/ },
  // Not `Paseo-Setup-<version>.exe`, which holds every architecture.
  paseo: { repo: 'getpaseo/paseo', asset: /^Paseo-Setup-(\d+\.\d+\.\d+)-x64\.exe$/ },
};

/** The newest GitHub release's installer asset, by name, with the digest GitHub publishes for it. */
async function githubRelease(read: ReadText, source: GithubSource): Promise<LatestInstaller> {
  const { repo, asset } = RELEASES[source];
  const release = json(await read(`https://api.github.com/repos/${repo}/releases/latest`));
  const assets = (release as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) throw unknown();
  for (const entry of assets) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    const version = asset.exec(name)?.[1];
    if (!version) continue;
    const url = typeof entry.browser_download_url === 'string' ? entry.browser_download_url : '';
    const sha256 =
      typeof entry.digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(entry.digest)?.[1] : '';
    if (!url.startsWith(`https://github.com/${repo}/releases/download/`) || !sha256)
      throw unknown();
    return { url, sha256, version };
  }
  throw unknown();
}

export function findLatest(source: LatestSource, read: ReadText): Promise<LatestInstaller> {
  return source === 'node-lts' ? nodeLts(read) : githubRelease(read, source);
}
