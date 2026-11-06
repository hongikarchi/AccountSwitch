import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { StepStop, type Fetcher, type InstallFiles } from './install-deps.ts';
import { PINS } from './manifest.ts';

// Everything the engine downloads itself, only from the hosts of SPEC 3.3, checked on every
// redirect. `fetch` would follow a redirect on its own, so redirects are followed by hand here.

const MAX_REDIRECTS = 5;
export const MAX_INSTALLER_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

const anyPath = () => true;
const ADDON_PATH = `/ahujasid/mcp-for-blender/${PINS.blenderAddon.commit}/addon.py`;

/** Host, then which of its addresses. Exact names only, so `nodejs.org.example.com` is out. */
const ALLOWED: Record<string, (path: string) => boolean> = {
  'nodejs.org': (path) => path.startsWith('/dist/'),
  'www.python.org': (path) => path.startsWith('/ftp/python/'),
  'github.com': (path) => /^\/(git-for-windows\/git|astral-sh\/uv)\/releases\//.test(path),
  'release-assets.githubusercontent.com': anyPath,
  'download.blender.org': (path) => path.startsWith('/release/'),
  'claude.ai': (path) => path === '/install.ps1',
  'downloads.claude.ai': anyPath,
  'astral.sh': (path) => path.startsWith('/uv/'),
  'releases.astral.sh': anyPath,
  'raw.githubusercontent.com': (path) => path === ADDON_PATH,
};

export function isAllowedDownload(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const allowed = Object.hasOwn(ALLOWED, url.hostname) ? ALLOWED[url.hostname] : undefined;
  return !!allowed && allowed(url.pathname);
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

const FAILED = '내려받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 보세요.';
const BLOCKED = '허용되지 않은 주소로 연결되어서 내려받지 않았어요.';

/** Follow redirects by hand until an answer with a body; every address must pass the list. */
async function open(fetcher: Fetcher, address: string, signal: AbortSignal) {
  let current = address;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedDownload(current)) throw new StepStop('failed', 'DOWNLOAD_BLOCKED', BLOCKED);
    const response = await fetcher(current, { redirect: 'manual', signal });
    // A fetcher that followed a redirect by itself still does not get past the list.
    if (response.url && !isAllowedDownload(response.url))
      throw new StepStop('failed', 'DOWNLOAD_BLOCKED', BLOCKED);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) break;
    return response;
  }
  throw new StepStop('failed', 'DOWNLOAD_FAILED', FAILED, true);
}

/** Say what stopped a download: cancel and timeout end the item, anything else may fall back. */
function explain(error: unknown, cancel: AbortSignal, timedOut: AbortSignal) {
  if (error instanceof StepStop) return error;
  if (cancel.aborted) return new StepStop('failed', 'CANCELLED', '취소했어요.');
  if (timedOut.aborted)
    return new StepStop('failed', 'TIMEOUT', '시간이 너무 오래 걸려서 멈췄어요.');
  return new StepStop('failed', 'DOWNLOAD_FAILED', FAILED, true);
}

export interface DownloadOptions {
  fetcher: Fetcher;
  /** A cancel of the run. */
  cancel: AbortSignal;
  timeoutMs: number;
}

/** A small file, into memory: an install script or the add-on, looked at before it is saved. */
export async function fetchBytes(address: string, options: DownloadOptions) {
  const timedOut = AbortSignal.timeout(Math.max(1, options.timeoutMs));
  const signal = AbortSignal.any([options.cancel, timedOut]);
  try {
    const response = await open(options.fetcher, address, signal);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_TEXT_BYTES) throw new StepStop('failed', 'DOWNLOAD_FAILED', FAILED);
    return bytes;
  } catch (error) {
    throw explain(error, options.cancel, timedOut);
  }
}

/** The file name in an address, for the saved installer; nothing that could leave the folder. */
export function downloadFileName(address: string) {
  // Not decoded: `%` is not in the allowed set, so an encoded separator is simply refused.
  const name = new URL(address).pathname.split('/').pop() ?? '';
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.'))
    throw new StepStop('failed', 'DOWNLOAD_BLOCKED', BLOCKED);
  return name;
}

export const downloadsFolder = (directory: string) => join(directory, 'downloads');

/** A large file, straight to disk: an installer. Returns where it is. */
export async function saveDownload(
  address: string,
  directory: string,
  files: InstallFiles,
  options: DownloadOptions,
) {
  const timedOut = AbortSignal.timeout(Math.max(1, options.timeoutMs));
  const signal = AbortSignal.any([options.cancel, timedOut]);
  const path = join(downloadsFolder(directory), downloadFileName(address));
  try {
    const response = await open(options.fetcher, address, signal);
    if (!response.body) throw new StepStop('failed', 'DOWNLOAD_FAILED', FAILED, true);
    await files.save(path, response.body, signal, MAX_INSTALLER_BYTES);
    return path;
  } catch (error) {
    throw explain(error, options.cancel, timedOut);
  }
}
