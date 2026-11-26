import { win32 } from 'node:path';

// SPEC 3.3: the rhinomcp server follows the Rhino plugin on disk. Its registration runs this
// launcher through `uv run --no-project --quiet`, and the launcher picks the version each time it
// starts, so a plugin that Rhino updated by itself never leaves the server behind.

/** The launcher's text: Python, standard library only, written whole by the `launcher` step. */
export function rhinomcpLauncher() {
  return `# rhinomcp launcher, written by AccountSwitch (SPEC 3.3). AccountSwitch replaces this file whole.
# Starts the rhinomcp server at the version of the Rhino plugin on this PC, so the two always match.
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

PACKAGE = "rhinomcp"
ROOT = os.path.join(os.environ.get("APPDATA", ""), "McNeel", "Rhinoceros", "packages", "8.0", PACKAGE)
PYPI = "https://pypi.org/pypi/" + PACKAGE


def key(version):
    return [int(part) for part in version.split(".") if part.isdigit()]


def plugin_version():
    try:
        names = [
            name
            for name in os.listdir(ROOT)
            if name[:1].isdigit() and os.path.isdir(os.path.join(ROOT, name))
        ]
    except OSError:
        return None
    return max(names, key=key) if names else None


def released(version):
    """True when PyPI has it, False when PyPI says it does not, None without an answer."""
    try:
        with urllib.request.urlopen(PYPI + "/" + version + "/json", timeout=3) as answer:
            return answer.status == 200
    except urllib.error.HTTPError as error:
        return False if error.code == 404 else None
    except Exception:
        return None


def newest_released_up_to(version):
    try:
        with urllib.request.urlopen(PYPI + "/json", timeout=3) as answer:
            releases = json.load(answer).get("releases", {})
    except Exception:
        return None
    usable = [
        name
        for name, files in releases.items()
        if name[:1].isdigit()
        and files
        and not all(entry.get("yanked") for entry in files)
        and key(name) <= key(version)
    ]
    return max(usable, key=key) if usable else None


def main():
    version = plugin_version()
    spec = PACKAGE
    if version:
        spec = PACKAGE + "@" + version
        # Yak has shipped a release up to 20 hours before PyPI.
        if released(version) is False:
            older = newest_released_up_to(version)
            if older:
                spec = PACKAGE + "@" + older
    uv = os.environ.get("UV") or shutil.which("uv")
    if not uv:
        print("rhinomcp launcher: uv not found", file=sys.stderr, flush=True)
        return 1
    print("rhinomcp launcher: plugin " + str(version) + ", running " + spec, file=sys.stderr, flush=True)
    # The server talks MCP over this process's own standard input and output.
    return subprocess.call([uv, "tool", "run", spec], stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
`;
}

/** What `uv` is given to run the launcher; the registration adds the launcher's path. */
export const LAUNCHER_RUN = ['run', '--no-project', '--quiet'];

/** One spelling for a command line: case, slashes, and the doubled backslashes of TOML text. */
const normal = (text: string) => text.replace(/\\\\/g, '\\').replace(/\//g, '\\').toLowerCase();

/** Whether a registered command line is `uv run --no-project --quiet <launcher>`, uv by any path. */
export function runsLauncher(command: string, launcher: string) {
  const line = normal(command).trim();
  const first = line.split(/\s+/, 1)[0] ?? '';
  if (!/^uv(\.exe)?$/.test(win32.basename(first))) return false;
  return line.slice(first.length).trim() === normal([...LAUNCHER_RUN, launcher].join(' '));
}
