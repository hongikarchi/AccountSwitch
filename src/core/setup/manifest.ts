import type { InstallStep, SetupCatalog, SetupGroup, SetupItem } from './types.ts';

// The setup catalog (SPEC 3.3): the one place for pinned versions, and pure data the page renders
// from. Change this file and SPEC together (CLAUDE.md, ADR-002).

/** Pinned versions. Everything not named here installs latest. */
export const PINS = {
  /** winget's `--version` takes an exact version only, and without it this id installs Node 26. */
  node: '24.22.1',
  /** node-v24.22.1-x64.msi, from https://nodejs.org/dist/v24.22.1/SHASUMS256.txt */
  nodeInstallerSha256: '3bda4baf1ee709b33cf920dd633106ddb23951e322bff9c03ec9f64ab8981b01',
  /** Any Node of this major version is left alone. */
  nodeMajor: '24',
  python: '3.13',
  /** Only the fallback installer; winget picks the newest 3.13. */
  pythonInstaller: '3.13.17',
  /** python-3.13.17-amd64.exe, from https://www.python.org/downloads/release/python-31317/ */
  pythonInstallerSha256: '5da012101ba2e17113a9a1cd901e9ce1441086f2b7ecb5de06ec94163899a190',
  /** Only the fallback installer; winget installs the latest Git. The hash: its release notes. */
  gitInstaller: {
    tag: 'v2.56.0.windows.4',
    file: 'Git-2.56.0.4-64-bit.exe',
    sha256: '4961a4a8cc778d8b6e00a5819e5fe4d078b754555aff7aedc2d77a5d74c2de80',
  },
  rhino: '8',
  rhinomcp: '0.4.1.1',
  cordyceps: '1.5.0',
  blender: '5.2.3',
  /** blender-5.2.3-windows-x64.msi, from .../release/Blender5.2/blender-5.2.3.sha256 */
  blenderInstallerSha256: 'a103d4ece8d9acffd2a95c9d8860355b1f209977cc983b4a3d1e1cfb441c8605',
  blenderSeries: '5.2',
  blenderMcp: '1.5.5',
  /** The commit whose server is byte-identical to PyPI 1.5.5; the project publishes no releases. */
  blenderAddon: {
    commit: '15c775ff78264346a1d09089a799c52c2fd9f797',
    sha256: '82d709a542fd268ed8e0e1da4fa9632df65b912fea850380baf6c47ab45a88fb',
    module: 'blender_mcp_addon',
  },
} as const;

/**
 * SPEC 3.8 part 2: the exact element for "run these commands every time Rhino starts" is still
 * **verify** (likely `StartupCommands`; T-049 finds it by diffing). This matches an entry whose key
 * mentions start and whose value holds the command. It must not match the entry `<guid>.mcpstart`
 * in "Command Use Counts", which only counts past uses and whose value is a number.
 */
const RHINO_STARTUP_COMMAND_PATTERN = 'key="[^"]*start[^"]*"[^>]*>[^<]*mcpstart';

const PROGRAM_FILES = '%ProgramFiles%';
const LOCAL_BIN = '%USERPROFILE%\\.local\\bin';
const PY_FOLDERS = [
  '%SystemRoot%',
  '%LOCALAPPDATA%\\Programs\\Python\\Launcher',
  '%LOCALAPPDATA%\\Programs\\Python\\Python313',
];
const GIT_FOLDERS = [`${PROGRAM_FILES}\\Git\\cmd`, '%LOCALAPPDATA%\\Programs\\Git\\cmd'];
const RHINO_PACKAGES = '%APPDATA%\\McNeel\\Rhinoceros\\packages\\8.0';
const YAK = `${PROGRAM_FILES}\\Rhino 8\\System\\Yak.exe`;
const BLENDER_VERSIONS = '%APPDATA%\\Blender Foundation\\Blender';
const BLENDER_USER = `${BLENDER_VERSIONS}\\${PINS.blenderSeries}`;
const BLENDER_FOLDER = `Blender ${PINS.blenderSeries}`;
const BLENDER_ROOT = `${PROGRAM_FILES}\\Blender Foundation`;

/** What goes on the user PATH if an install left it off (SPEC 3.5 step 4). */
const onPath = (program: string, folders: string[]) =>
  folders.map((folder) => ({ folder, program }));

/** winget can be missing from PATH even when installed. */
const WINGET = '%LOCALAPPDATA%\\Microsoft\\WindowsApps\\winget.exe';
/** `0x8A15010C`, INSTALL_CANCELLED_BY_USER, as a Node child process reports it (SPEC 3.6). */
const WINGET_DECLINED = [2316632332];
/** The Inno Setup fallback of Git (SPEC 3.6). */
const INNO_DECLINED = [2];
/** msiexec and the Python bundle. SPEC 3.6: **verify** by pressing 아니요 once (T-047). */
const MSI_DECLINED = [1602, 1223];
/** Stands for the downloaded file in `download-installer`. */
const FILE = '<file>';

/** Every winget install runs these flags plus what the table in SPEC 3.3 adds. */
function winget(id: string, ...extra: string[]): InstallStep {
  return {
    kind: 'winget',
    program: WINGET,
    id,
    args: [
      'install',
      '--id',
      id,
      '-e',
      '--source',
      'winget',
      '--accept-source-agreements',
      '--accept-package-agreements',
      '--disable-interactivity',
      ...extra,
    ],
    declinedExitCodes: WINGET_DECLINED,
  };
}
function msiFallback(url: string, sha256: string): InstallStep {
  return {
    kind: 'download-installer',
    url,
    sha256,
    program: 'msiexec',
    // Never a restart on its own: a file in use could cost an unsaved model (SPEC 3.6).
    args: ['/i', FILE, '/passive', '/norestart'],
    declinedExitCodes: MSI_DECLINED,
  };
}

/** One bundle of Python packages: what the check looks for is what the install installs. */
function pipItem(
  id: string,
  group: SetupItem['group'],
  label: string,
  description: string,
  packages: string[],
): SetupItem {
  return {
    id,
    label,
    description,
    group,
    dependsOn: ['python'],
    check: {
      kind: 'pip',
      launcher: 'py',
      knownFolders: PY_FOLDERS,
      python: PINS.python,
      packages,
    },
    install: {
      summary: 'pip으로 없는 패키지만 설치해요.',
      automatic: true,
      steps: [{ kind: 'pip', launcher: 'py', python: PINS.python, packages }],
    },
    pinnedVersion: 'latest',
    mayElevate: false,
  };
}

/** A user-scope MCP registration; the arguments of `claude mcp add` live in one place. */
function mcpInstall(summary: string, args: string[]) {
  const step: InstallStep = { kind: 'claude-mcp-add', args: ['mcp', 'add', '-s', 'user', ...args] };
  return { summary, automatic: true, steps: [step] };
}

const groups: SetupGroup[] = [
  {
    id: 'base',
    label: '기본',
    description: 'Claude Code와 GPT로 작업하는 데 필요한 기본 프로그램이에요.',
    optional: false,
  },
  {
    id: 'claude',
    label: 'Claude Code',
    description: '터미널에서 Claude와 함께 작업하는 프로그램이에요.',
    optional: true,
    cli: true,
  },
  {
    id: 'codex',
    label: 'GPT',
    description: '터미널에서 ChatGPT 계정으로 작업하는 프로그램이에요.',
    optional: true,
    cli: true,
  },
  {
    id: 'rhino',
    label: 'Rhino',
    description: 'Claude Code가 Rhino와 Grasshopper를 다룰 수 있게 연결해요.',
    optional: true,
  },
  {
    id: 'blender',
    label: 'Blender',
    description: 'Blender를 설치하고 Claude Code와 연결해요.',
    optional: true,
  },
];

const items: SetupItem[] = [
  {
    id: 'git',
    label: 'Git',
    description: '파일의 변경 기록을 관리하는 프로그램이에요.',
    group: 'base',
    dependsOn: [],
    check: {
      kind: 'command',
      commands: [{ program: 'git', args: ['--version'], versionPattern: 'git version (\\S+)' }],
      knownFolders: GIT_FOLDERS,
      orFilesExist: GIT_FOLDERS.map((folder) => `${folder}\\git.exe`),
    },
    install: {
      summary: 'winget으로 설치하고, 안 되면 공식 설치 파일을 받아요.',
      automatic: true,
      pathFolders: onPath('git', GIT_FOLDERS),
      steps: [
        winget('Git.Git'),
        {
          kind: 'download-installer',
          url: `https://github.com/git-for-windows/git/releases/download/${PINS.gitInstaller.tag}/${PINS.gitInstaller.file}`,
          sha256: PINS.gitInstaller.sha256,
          program: FILE,
          args: ['/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'],
          declinedExitCodes: INNO_DECLINED,
        },
      ],
    },
    pinnedVersion: 'latest',
    // An account in Administrators gets the prompt; a standard account installs per user without.
    mayElevate: true,
  },
  {
    id: 'node',
    label: `Node.js ${PINS.nodeMajor}`,
    description: 'Codex CLI를 돌리는 데 필요한 실행 환경이에요.',
    group: 'base',
    dependsOn: [],
    check: {
      kind: 'command',
      commands: [{ program: 'node', args: ['-v'], versionPattern: 'v?(\\d+\\.\\d+\\.\\d+)' }],
      knownFolders: [`${PROGRAM_FILES}\\nodejs`],
      acceptVersion: `${PINS.nodeMajor}.x`,
    },
    install: {
      summary: 'winget으로 설치하고, 안 되면 공식 설치 파일을 받아요.',
      automatic: true,
      pathFolders: onPath('node', [`${PROGRAM_FILES}\\nodejs`]),
      steps: [
        winget('OpenJS.NodeJS.LTS', '--version', PINS.node),
        msiFallback(
          `https://nodejs.org/dist/v${PINS.node}/node-v${PINS.node}-x64.msi`,
          PINS.nodeInstallerSha256,
        ),
      ],
    },
    pinnedVersion: PINS.node,
    mayElevate: true,
  },
  {
    id: 'uv',
    label: 'uv',
    description: 'Python 도구를 설치하고 실행해 주는 프로그램이에요.',
    group: 'base',
    dependsOn: [],
    check: {
      kind: 'command',
      commands: [
        { program: 'uv', args: ['--version'], versionPattern: 'uv (\\S+)' },
        { program: 'uvx', args: ['--version'] },
      ],
      knownFolders: [LOCAL_BIN],
    },
    install: {
      summary: '공식 설치 스크립트로 내 계정에만 설치해요.',
      automatic: true,
      pathFolders: [...onPath('uv', [LOCAL_BIN]), ...onPath('uvx', [LOCAL_BIN])],
      steps: [{ kind: 'powershell-script', url: 'https://astral.sh/uv/install.ps1' }],
    },
    pinnedVersion: 'latest',
    mayElevate: false,
  },
  {
    id: 'python',
    label: `Python ${PINS.python}`,
    description: '모델링과 문서 작업 스크립트를 돌리는 언어예요.',
    group: 'base',
    dependsOn: [],
    check: {
      kind: 'command',
      commands: [
        {
          program: 'py',
          args: [`-${PINS.python}`, '--version'],
          versionPattern: 'Python (\\S+)',
        },
      ],
      knownFolders: PY_FOLDERS,
    },
    install: {
      summary: 'winget으로 내 계정에만 설치하고, 안 되면 공식 설치 파일을 받아요.',
      automatic: true,
      pathFolders: [
        ...onPath('py', ['%LOCALAPPDATA%\\Programs\\Python\\Launcher']),
        ...onPath('python', ['%LOCALAPPDATA%\\Programs\\Python\\Python313']),
      ],
      steps: [
        winget(`Python.Python.${PINS.python}`, '--scope', 'user'),
        {
          kind: 'download-installer',
          url: `https://www.python.org/ftp/python/${PINS.pythonInstaller}/python-${PINS.pythonInstaller}-amd64.exe`,
          sha256: PINS.pythonInstallerSha256,
          program: FILE,
          args: ['/passive', '/norestart', 'InstallAllUsers=0', 'PrependPath=1'],
          declinedExitCodes: MSI_DECLINED,
        },
      ],
    },
    pinnedVersion: `${PINS.python}.x`,
    // No in the normal case; an older all-users `py` launcher can prompt, upgraded in place.
    mayElevate: false,
  },
  {
    id: 'env',
    label: '터미널 기본 설정',
    description: '스크립트 실행 허용, 프로그램 경로, 한글 깨짐 방지 설정을 맞춰요.',
    group: 'base',
    dependsOn: [],
    check: {
      kind: 'environment',
      userPathFolder: LOCAL_BIN,
      userVariables: { PYTHONUTF8: '1' },
      allowedPolicies: ['RemoteSigned', 'Unrestricted', 'Bypass'],
    },
    install: {
      summary: '빠진 설정만 내 계정에 추가해요.',
      automatic: true,
      steps: [
        {
          kind: 'environment',
          userPathFolder: LOCAL_BIN,
          userVariables: { PYTHONUTF8: '1' },
          executionPolicy: 'RemoteSigned',
        },
      ],
    },
    pinnedVersion: null,
    mayElevate: false,
  },
  pipItem(
    'py-base',
    'base',
    'Python 기본 패키지',
    '엑셀, PDF, 이미지, 웹 자료를 다루는 패키지예요.',
    [
      'openpyxl',
      'pypdf',
      'pdfplumber',
      'pymupdf',
      'pillow',
      'numpy',
      'requests',
      'beautifulsoup4',
      'python-dotenv',
    ],
  ),
  pipItem('py-gis', 'base', 'Python 지도(GIS) 패키지', 'SHP 파일과 좌표계를 다뤄요.', [
    'pyshp',
    'pyproj',
    'shapely',
    'rtree',
  ]),
  pipItem('py-3d', 'base', 'Python 3D 패키지', 'Rhino 파일과 3D 모양을 코드로 다뤄요.', [
    'rhino3dm',
    'trimesh',
  ]),
  {
    id: 'claude',
    label: 'Claude Code',
    description: '터미널에서 Claude와 함께 작업하는 프로그램이에요.',
    group: 'claude',
    dependsOn: [],
    check: { kind: 'cli', provider: 'claude-cli', versionPattern: '(\\d+\\.\\d+\\.\\S+)' },
    install: {
      summary: '공식 설치 스크립트로 설치해요.',
      automatic: true,
      pathFolders: onPath('claude', [LOCAL_BIN]),
      // It ends by running `claude.exe install`, which may write ~/.claude.json (SPEC 3.7).
      steps: [
        { kind: 'powershell-script', url: 'https://claude.ai/install.ps1', insideClaudeLock: true },
      ],
    },
    pinnedVersion: 'latest',
    mayElevate: false,
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    description: '터미널에서 ChatGPT 계정으로 작업하는 프로그램이에요.',
    group: 'codex',
    dependsOn: ['node'],
    check: { kind: 'cli', provider: 'codex-cli', versionPattern: '(\\d+\\.\\d+\\.\\S+)' },
    install: {
      summary: 'npm으로 설치해요. Node.js가 먼저 필요해요.',
      automatic: true,
      pathFolders: onPath('codex', ['%APPDATA%\\npm']),
      steps: [{ kind: 'npm-global', package: '@openai/codex' }],
    },
    pinnedVersion: 'latest',
    mayElevate: false,
  },
  {
    id: 'rhino',
    label: `Rhino ${PINS.rhino}`,
    description: '3D 모델링 프로그램이에요. 직접 설치해 주세요.',
    group: 'rhino',
    dependsOn: [],
    check: { kind: 'file', path: `${PROGRAM_FILES}\\Rhino 8\\System\\Rhino.exe` },
    install: {
      summary: '자동으로 설치할 수 없어요. 직접 설치해 주세요.',
      automatic: false,
      steps: [
        {
          kind: 'manual',
          message: 'Rhino 8을 먼저 설치하세요',
          url: 'https://www.rhino3d.com/download/',
        },
      ],
    },
    pinnedVersion: PINS.rhino,
    mayElevate: false,
  },
  {
    id: 'rhinomcp-plugin',
    label: 'rhinomcp 플러그인',
    description: 'Claude Code가 Rhino 안에서 스크립트를 실행하게 해 줘요.',
    group: 'rhino',
    dependsOn: ['rhino'],
    check: {
      kind: 'versioned-folder',
      root: `${RHINO_PACKAGES}\\rhinomcp`,
      version: PINS.rhinomcp,
    },
    install: {
      summary: 'Rhino 패키지 관리자로 설치해요.',
      automatic: true,
      steps: [{ kind: 'yak', program: YAK, package: 'rhinomcp', version: PINS.rhinomcp }],
    },
    pinnedVersion: PINS.rhinomcp,
    mayElevate: false,
  },
  {
    id: 'rhinomcp-mcp',
    label: 'rhinomcp 연결',
    description: 'Claude Code에 rhinomcp를 등록해요.',
    group: 'rhino',
    dependsOn: ['claude', 'uv'],
    check: { kind: 'mcp', name: 'rhino', package: 'rhinomcp', version: PINS.rhinomcp },
    install: mcpInstall('Claude Code에 등록해요.', [
      'rhino',
      '-e',
      'RHINO_MCP_HOST=127.0.0.1',
      '--',
      'uvx',
      `rhinomcp@${PINS.rhinomcp}`,
    ]),
    pinnedVersion: PINS.rhinomcp,
    mayElevate: false,
  },
  {
    id: 'cordyceps-plugin',
    label: 'Cordyceps 플러그인',
    description: 'Claude Code가 Grasshopper를 다루게 해 줘요.',
    group: 'rhino',
    dependsOn: ['rhino'],
    check: {
      kind: 'versioned-folder',
      root: `${RHINO_PACKAGES}\\cordyceps`,
      version: PINS.cordyceps,
      marker: 'Cordyceps.gha',
    },
    install: {
      summary: 'Rhino 패키지 관리자로 설치해요.',
      automatic: true,
      steps: [{ kind: 'yak', program: YAK, package: 'cordyceps', version: PINS.cordyceps }],
    },
    pinnedVersion: PINS.cordyceps,
    mayElevate: false,
  },
  {
    id: 'cordyceps-mcp',
    label: 'Cordyceps 연결',
    description: 'Claude Code에 Cordyceps를 등록해요.',
    group: 'rhino',
    dependsOn: ['claude'],
    check: { kind: 'mcp', name: 'cordyceps', url: 'http://127.0.0.1:26929/mcp' },
    install: mcpInstall('Claude Code에 등록해요.', [
      '--transport',
      'http',
      'cordyceps',
      'http://127.0.0.1:26929/mcp',
    ]),
    pinnedVersion: null,
    mayElevate: false,
  },
  {
    id: 'rhino-settings',
    label: 'Rhino 설정',
    description: '읽기 전용 경고, 시작 명령, Grasshopper 시작 파일, 도구 안내를 맞춰요.',
    group: 'rhino',
    dependsOn: ['rhino'],
    check: {
      kind: 'rhino-settings',
      settingsFile: '%APPDATA%\\McNeel\\Rhinoceros\\8.0\\settings\\settings-Scheme__Default.xml',
      readOnlyWarningPattern: '<entry key="EnableFileLockingOpenWarning">\\s*True\\s*</entry>',
      startupCommandPattern: RHINO_STARTUP_COMMAND_PATTERN,
      starterFile: '%DOCUMENTS%\\AccountSwitch\\cordyceps-start.gh',
      roleNoteFile: '%USERPROFILE%\\.claude\\CLAUDE.md',
      roleNoteStart: '<!-- accountswitch:start -->',
      roleNoteEnd: '<!-- accountswitch:end -->',
    },
    install: {
      summary: 'Rhino가 꺼져 있을 때 설정 파일을 바꿔요. 먼저 백업해요.',
      automatic: true,
      steps: [{ kind: 'rhino-settings' }],
    },
    pinnedVersion: null,
    mayElevate: false,
  },
  {
    id: 'blender',
    label: `Blender ${PINS.blender}`,
    description: '3D 모델링과 렌더링 프로그램이에요.',
    group: 'blender',
    dependsOn: [],
    check: {
      kind: 'blender',
      root: BLENDER_ROOT,
      folderPattern: '^Blender \\d+\\.\\d+$',
      preferredFolder: BLENDER_FOLDER,
      program: 'blender.exe',
      versionPattern: '^Blender (\\d+\\.\\d+\\.\\d+)',
      uninstallNamePattern: '^Blender(\\s+\\d+(\\.\\d+)*(\\s+LTS)?)?$',
    },
    install: {
      summary: 'winget으로 설치하고, 안 되면 공식 설치 파일을 받아요.',
      automatic: true,
      // The package declares UpgradeBehavior: uninstallPrevious (SPEC 3.3).
      warnIfOtherVersion: '설치하면 지금 있는 다른 버전의 Blender가 지워질 수 있어요.',
      steps: [
        winget('BlenderFoundation.Blender', '--version', PINS.blender),
        msiFallback(
          `https://download.blender.org/release/Blender${PINS.blenderSeries}/blender-${PINS.blender}-windows-x64.msi`,
          PINS.blenderInstallerSha256,
        ),
      ],
    },
    pinnedVersion: PINS.blender,
    mayElevate: true,
  },
  {
    id: 'blender-mcp-addon',
    label: 'blender-mcp 애드온',
    description: 'Blender가 Claude Code의 요청을 받을 수 있게 해 줘요.',
    group: 'blender',
    dependsOn: ['blender'],
    check: {
      kind: 'blender-addon',
      addonsFolder: `${BLENDER_USER}\\scripts\\addons`,
      userPrefs: `${BLENDER_USER}\\config\\userpref.blend`,
      module: PINS.blenderAddon.module,
    },
    install: {
      summary: '고정된 버전의 애드온을 받아 Blender에 설치하고, 정보 수집은 끈 채로 켜요.',
      automatic: true,
      steps: [
        {
          kind: 'blender-addon',
          url: `https://raw.githubusercontent.com/ahujasid/mcp-for-blender/${PINS.blenderAddon.commit}/addon.py`,
          sha256: PINS.blenderAddon.sha256,
          saveAs: `${PINS.blenderAddon.module}.py`,
          module: PINS.blenderAddon.module,
          blender: `${BLENDER_ROOT}\\${BLENDER_FOLDER}\\blender.exe`,
          userPrefs: `${BLENDER_USER}\\config\\userpref.blend`,
          versionsFolder: BLENDER_VERSIONS,
          series: PINS.blenderSeries,
        },
      ],
    },
    pinnedVersion: PINS.blenderMcp,
    mayElevate: false,
  },
  {
    id: 'blender-mcp',
    label: 'blender-mcp 연결',
    description: 'Claude Code에 blender-mcp를 등록해요.',
    group: 'blender',
    dependsOn: ['claude', 'uv'],
    check: { kind: 'mcp', name: 'blender', package: 'blender-mcp', version: PINS.blenderMcp },
    // Its server sends data to the project's database unless told not to (SPEC 3.3).
    install: mcpInstall('Claude Code에 등록해요. 정보 수집은 꺼 둬요.', [
      'blender',
      '-e',
      'DISABLE_TELEMETRY=true',
      '--',
      'uvx',
      `blender-mcp@${PINS.blenderMcp}`,
    ]),
    pinnedVersion: PINS.blenderMcp,
    mayElevate: false,
  },
];

export const catalog: SetupCatalog = { groups, items };
