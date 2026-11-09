import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blenderArguments, blenderExpression } from '../src/core/setup/install-blender.ts';
import { StepStop, realInstallFiles } from '../src/core/setup/install-deps.ts';
import {
  downloadFileName,
  fetchBytes,
  isAllowedDownload,
  saveDownload,
  sha256Hex,
} from '../src/core/setup/install-download.ts';
import { describeCommand, readLogTail, redactLog } from '../src/core/setup/install-log.ts';
import { applyMarkedBlock, roleNote } from '../src/core/setup/install-rhino.ts';
import {
  addStartupCommand,
  hasStartupCommand,
  readOnlyWarningOn,
  setReadOnlyWarning,
} from '../src/core/setup/rhino-xml.ts';
import { installEnvironment } from '../src/core/setup/install-steps.ts';
import {
  appendPathEntry,
  planExecutionPolicy,
  tasklistHas,
} from '../src/core/setup/install-windows.ts';
import { catalog, PINS } from '../src/core/setup/manifest.ts';
import { memoryFiles } from './setup-install-helpers.mjs';

// --- Hosts (SPEC 3.3)

const ADDON = `https://raw.githubusercontent.com/ahujasid/mcp-for-blender/${PINS.blenderAddon.commit}/addon.py`;

test('every address the catalog downloads from passes the host list', () => {
  const urls = catalog.items
    .flatMap((item) => item.install.steps)
    .flatMap((step) => ('url' in step && step.kind !== 'manual' ? [step.url] : []));
  assert.ok(urls.length >= 7);
  for (const url of urls) assert.equal(isAllowedDownload(url), true, url);
});

test('the host list takes the redirects the publishers really use', () => {
  for (const url of [
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sp=r',
    'https://downloads.claude.ai/claude-code-releases/install.ps1',
    'https://releases.astral.sh/uv/install.ps1',
    'https://github.com/astral-sh/uv/releases/download/0.9.0/uv.zip',
  ])
    assert.equal(isAllowedDownload(url), true, url);
});

test('the host list refuses everything else', () => {
  for (const url of [
    'http://nodejs.org/dist/v24.22.1/node-v24.22.1-x64.msi',
    'https://nodejs.org.example.com/dist/x.msi',
    'https://example.com/nodejs.org/dist/x.msi',
    'https://user:pw@nodejs.org/dist/x.msi',
    'https://nodejs.org:8443/dist/x.msi',
    'https://nodejs.org/other/x.msi',
    'https://github.com/someone/else/releases/download/1/x.exe',
    'https://raw.githubusercontent.com/ahujasid/mcp-for-blender/main/addon.py',
    'https://raw.githubusercontent.com/someone/else/main/addon.py',
    'https://claude.ai/other.ps1',
    'https://constructor/x',
    'file:///C:/Windows/System32/cmd.exe',
    'not a url',
  ])
    assert.equal(isAllowedDownload(url), false, url);
});

const cancelNever = () => new AbortController().signal;
const options = (fetcher) => ({ fetcher, cancel: cancelNever(), timeoutMs: 5000 });

test('redirects are followed by hand and each one is checked', async () => {
  const asked = [];
  const bytes = await fetchBytes(
    'https://claude.ai/install.ps1',
    options(async (url, init) => {
      asked.push(url);
      assert.equal(init.redirect, 'manual');
      return url === 'https://claude.ai/install.ps1'
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://downloads.claude.ai/install.ps1' },
          })
        : new Response('script');
    }),
  );
  assert.equal(bytes.toString(), 'script');
  assert.deepEqual(asked, [
    'https://claude.ai/install.ps1',
    'https://downloads.claude.ai/install.ps1',
  ]);
});

test('a redirect to another host is refused before anything is asked of that host', async () => {
  const asked = [];
  await assert.rejects(
    fetchBytes(
      'https://claude.ai/install.ps1',
      options(async (url) => {
        asked.push(url);
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/evil.ps1' },
        });
      }),
    ),
    (error) => error instanceof StepStop && error.reason === 'DOWNLOAD_BLOCKED' && !error.fallback,
  );
  assert.deepEqual(asked, ['https://claude.ai/install.ps1']);
});

test('a relative redirect stays checked, and a chain has an end', async () => {
  await assert.rejects(
    fetchBytes(
      'https://claude.ai/install.ps1',
      options(
        async () =>
          new Response(null, { status: 301, headers: { location: '/elsewhere/install.ps1' } }),
      ),
    ),
    (error) => error.reason === 'DOWNLOAD_BLOCKED',
  );
  let hops = 0;
  await assert.rejects(
    fetchBytes(
      'https://claude.ai/install.ps1',
      options(async () => {
        hops++;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://claude.ai/install.ps1' },
        });
      }),
    ),
    (error) => error.reason === 'DOWNLOAD_FAILED',
  );
  assert.equal(hops, 6);
});

test('a fetcher that followed a redirect by itself is refused too', async () => {
  await assert.rejects(
    fetchBytes(
      'https://claude.ai/install.ps1',
      options(async () => {
        const response = new Response('x');
        Object.defineProperty(response, 'url', { value: 'https://example.com/x' });
        return response;
      }),
    ),
    (error) => error.reason === 'DOWNLOAD_BLOCKED',
  );
});

test('a server error and a broken connection may fall back; a cancel may not', async () => {
  await assert.rejects(
    fetchBytes(
      'https://claude.ai/install.ps1',
      options(async () => new Response('', { status: 500 })),
    ),
    (error) => error.reason === 'DOWNLOAD_FAILED' && error.fallback,
  );
  await assert.rejects(
    fetchBytes(
      'https://claude.ai/install.ps1',
      options(async () => {
        throw new TypeError('fetch failed');
      }),
    ),
    (error) => error.reason === 'DOWNLOAD_FAILED' && error.fallback,
  );
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(
    fetchBytes('https://claude.ai/install.ps1', {
      cancel: cancel.signal,
      timeoutMs: 5000,
      fetcher: async (_url, init) => {
        init.signal.throwIfAborted();
        return new Response('x');
      },
    }),
    (error) => error.reason === 'CANCELLED' && !error.fallback,
  );
});

test('a saved installer keeps the name of its address, and only a plain name', async () => {
  const files = memoryFiles();
  const path = await saveDownload(
    'https://nodejs.org/dist/v24.22.1/node-v24.22.1-x64.msi',
    'data',
    files,
    options(async () => new Response('msi')),
  );
  assert.equal(path, join('data', 'downloads', 'node-v24.22.1-x64.msi'));
  assert.equal(files.read(path).toString(), 'msi');
});

test('a saved installer cannot leave the downloads folder', () => {
  for (const url of [
    'https://nodejs.org/dist/..%2f..%2fevil.msi',
    'https://nodejs.org/dist/..%5cevil.msi',
    'https://nodejs.org/dist/a%20b.msi',
    'https://nodejs.org/dist/%E0%A4%A.msi',
    'https://nodejs.org/dist/',
  ])
    assert.throws(() => downloadFileName(url), StepStop, url);
});

test('the hash check is SHA-256 of the bytes', () => {
  const bytes = Buffer.from('addon');
  assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'));
  assert.equal(PINS.blenderAddon.sha256.length, 64);
  assert.ok(isAllowedDownload(ADDON));
});

// --- PATH (SPEC 3.5)

const expand = (value) => value.replaceAll('%USERPROFILE%', 'C:\\Users\\tester');
const BIN_ENTRY = '%USERPROFILE%\\.local\\bin';

test('appending keeps every other entry exactly as it was, %VARIABLES% included', () => {
  const { value, changed } = appendPathEntry(
    '%USERPROFILE%\\a;C:\\Tools;;C:\\길 있는\\폴더\\',
    BIN_ENTRY,
    expand,
  );
  assert.equal(changed, true);
  assert.equal(value, `%USERPROFILE%\\a;C:\\Tools;;C:\\길 있는\\폴더\\;${BIN_ENTRY}`);
});

test('appending to nothing, or after a trailing separator', () => {
  assert.deepEqual(appendPathEntry(null, BIN_ENTRY, expand), { value: BIN_ENTRY, changed: true });
  assert.deepEqual(appendPathEntry('', BIN_ENTRY, expand), { value: BIN_ENTRY, changed: true });
  assert.equal(appendPathEntry('C:\\Tools;', BIN_ENTRY, expand).value, `C:\\Tools;${BIN_ENTRY}`);
});

test('a folder already there is not added, however it is written', () => {
  for (const raw of [
    BIN_ENTRY,
    'C:\\Users\\tester\\.local\\bin',
    'c:\\users\\TESTER\\.local\\bin\\',
    `C:\\Tools;${BIN_ENTRY};C:\\More`,
  ]) {
    const result = appendPathEntry(raw, BIN_ENTRY, expand);
    assert.equal(result.changed, false, raw);
    assert.equal(result.value, raw);
  }
});

test('a PATH that would grow past what Windows takes is not written', () => {
  assert.throws(() => appendPathEntry('C:\\x;'.repeat(7000), BIN_ENTRY, expand), /TOO_LONG/);
});

test('the execution policy changes only from Undefined or Restricted, under no group policy', () => {
  const cases = [
    [{ CurrentUser: 'Undefined' }, 'set'],
    [{ CurrentUser: 'Restricted' }, 'set'],
    [{}, 'set'],
    [{ CurrentUser: 'RemoteSigned' }, 'fine'],
    [{ CurrentUser: 'Bypass' }, 'fine'],
    [{ CurrentUser: 'AllSigned' }, 'left-alone'],
    [{ MachinePolicy: 'Restricted', CurrentUser: 'Undefined' }, 'blocked-by-group'],
    [{ UserPolicy: 'AllSigned', CurrentUser: 'RemoteSigned' }, 'blocked-by-group'],
    [{ MachinePolicy: 'RemoteSigned', CurrentUser: 'Undefined' }, 'fine'],
    [{ MachinePolicy: 'Undefined', UserPolicy: 'Undefined', CurrentUser: 'Undefined' }, 'set'],
  ];
  for (const [policies, plan] of cases)
    assert.equal(planExecutionPolicy(policies), plan, JSON.stringify(policies));
});

test('tasklist: only that exact program counts, in any letter case and any language', () => {
  assert.equal(tasklistHas('"Rhino.exe","10","Console","1","1 K"\r\n', 'Rhino.exe'), true);
  assert.equal(tasklistHas('"RHINO.EXE","10","Console","1","1 K"\r\n', 'Rhino.exe'), true);
  assert.equal(tasklistHas('"Rhino.Compute.exe","10","C","1","1 K"\r\n', 'Rhino.exe'), false);
  assert.equal(tasklistHas('"NotRhino.exe","10","C","1","1 K"\r\n', 'Rhino.exe'), false);
  assert.equal(tasklistHas('정보: 지정된 조건에 맞는 작업이 없습니다.\r\n', 'Rhino.exe'), false);
});

// --- Rhino settings (SPEC 3.8)

const settingsFile = (fileSettings) =>
  [
    '\uFEFF<?xml version="1.0" encoding="utf-8"?>',
    '<settings id="2.0">',
    '  <settings>',
    '    <child key="Private">',
    '      <entry key="x">한글 값</entry>',
    '    </child>',
    '    <child key="Options">',
    fileSettings,
    '      <child key="Advanced">',
    '        <entry key="y">1</entry>',
    '      </child>',
    '    </child>',
    '  </settings>',
    '</settings>',
    '',
  ].join('\r\n');

const WARNING = (value) =>
  [
    '      <child key="FileSettings">',
    `        <entry key="EnableFileLockingOpenWarning">${value}</entry>`,
    '      </child>',
  ].join('\r\n');

test('the warning turns on and not one other byte changes', () => {
  const before = settingsFile(WARNING('False'));
  const result = setReadOnlyWarning(before);
  assert.equal(result.changed, true);
  assert.equal(result.xml, settingsFile(WARNING('True')));
  assert.equal(readOnlyWarningOn(result.xml), true);
  assert.equal(readOnlyWarningOn(before), false);
});

test('a warning already on changes nothing', () => {
  const before = settingsFile(WARNING('True'));
  assert.deepEqual(setReadOnlyWarning(before), { xml: before, changed: false });
});

test('a missing entry or FileSettings is Rhino’s default, on, and nothing is added', () => {
  // Measured: Rhino 8 drops an entry that holds its default when it saves (2026-11-09).
  const noEntry = settingsFile(
    ['      <child key="FileSettings">', '        <entry key="z">1</entry>', '      </child>'].join(
      '\r\n',
    ),
  );
  for (const xml of [
    noEntry,
    settingsFile('      <child key="Other" />'),
    settingsFile('      <child key="FileSettings" />'),
  ]) {
    assert.equal(readOnlyWarningOn(xml), true);
    assert.deepEqual(setReadOnlyWarning(xml), { xml, changed: false });
  }
});

test('an entry of the same name outside FileSettings is not touched, nor read', () => {
  const stray = settingsFile(
    [
      '      <child key="FileSettings">',
      '      </child>',
      '      <child key="Elsewhere">',
      '        <entry key="EnableFileLockingOpenWarning">False</entry>',
      '      </child>',
    ].join('\r\n'),
  );
  assert.equal(readOnlyWarningOn(stray), true);
  assert.deepEqual(setReadOnlyWarning(stray), { xml: stray, changed: false });
  const nested = settingsFile(
    [
      '      <child key="FileSettings">',
      '        <child key="Deeper">',
      '          <entry key="EnableFileLockingOpenWarning">False</entry>',
      '        </child>',
      '      </child>',
    ].join('\r\n'),
  );
  assert.equal(readOnlyWarningOn(nested), true);
});

test('a file without Options is left alone', () => {
  for (const edit of [setReadOnlyWarning, (xml) => addStartupCommand(xml, '_mcpstart')]) {
    assert.deepEqual(edit('<settings id="2.0"><settings /></settings>'), { problem: 'no-options' });
    assert.deepEqual(edit('<child key="Options">never closed'), { problem: 'no-options' });
  }
});

const GENERAL = (value) =>
  [
    '      <child key="General">',
    `        <entry key="StartupCommands">${value}</entry>`,
    '      </child>',
  ].join('\r\n');

test('the start command goes in a General at the end of Options, as Rhino writes it', () => {
  const before = settingsFile(WARNING('True'));
  const result = addStartupCommand(before, '_mcpstart');
  assert.equal(result.changed, true);
  assert.equal(
    result.xml,
    before.replace(
      '        <entry key="y">1</entry>\r\n      </child>\r\n',
      `        <entry key="y">1</entry>\r\n      </child>\r\n${GENERAL('_mcpstart')}\r\n`,
    ),
  );
  assert.equal(hasStartupCommand(result.xml, '_mcpstart'), true);
  assert.equal(hasStartupCommand(before, '_mcpstart'), false);
  assert.deepEqual(addStartupCommand(result.xml, '_mcpstart'), {
    xml: result.xml,
    changed: false,
  });
});

test('the user’s start commands stay, and mcpstart in any spelling counts once', () => {
  const mine = settingsFile(GENERAL('_Grid _Enter'));
  assert.equal(
    addStartupCommand(mine, '_mcpstart').xml,
    settingsFile(GENERAL('_Grid _Enter _mcpstart')),
  );
  for (const value of ['mcpstart', '-_McpStart', '_Grid\r\n_mcpstart'])
    assert.equal(hasStartupCommand(settingsFile(GENERAL(value)), '_mcpstart'), true, value);
  assert.equal(hasStartupCommand(settingsFile(GENERAL('_mcpstartx')), '_mcpstart'), false);
  const empty = settingsFile(
    [
      '      <child key="General">',
      '        <entry key="StartupCommands" />',
      '      </child>',
    ].join('\r\n'),
  );
  assert.equal(addStartupCommand(empty, '_mcpstart').xml, settingsFile(GENERAL('_mcpstart')));
  const noEntry = settingsFile(
    ['      <child key="General">', '        <entry key="q">1</entry>', '      </child>'].join(
      '\r\n',
    ),
  );
  assert.ok(
    addStartupCommand(noEntry, '_mcpstart').xml.includes(
      '<entry key="q">1</entry>\r\n        <entry key="StartupCommands">_mcpstart</entry>\r\n      </child>',
    ),
  );
});

test('a General nested deeper is not Options’ own', () => {
  const nested = settingsFile(
    [
      '      <child key="Deeper">',
      GENERAL('_mcpstart').replace(/^/gm, '  '),
      '      </child>',
    ].join('\r\n'),
  );
  assert.equal(hasStartupCommand(nested, '_mcpstart'), false);
  const result = addStartupCommand(nested, '_mcpstart');
  assert.equal(hasStartupCommand(result.xml, '_mcpstart'), true);
  assert.ok(result.xml.includes(`  ${GENERAL('_mcpstart').split('\r\n')[1]}`), 'left in place');
});

const START = '<!-- accountswitch:start -->';
const END = '<!-- accountswitch:end -->';

test('the note goes into a new file, and after what a file already holds', () => {
  assert.equal(applyMarkedBlock(undefined, START, END, 'body').text, `${START}\nbody\n${END}\n`);
  assert.equal(
    applyMarkedBlock('# Mine\nkeep\n', START, END, 'body').text,
    `# Mine\nkeep\n\n${START}\nbody\n${END}\n`,
  );
  assert.equal(
    applyMarkedBlock('no newline', START, END, 'body').text,
    `no newline\n\n${START}\nbody\n${END}\n`,
  );
  assert.equal(
    applyMarkedBlock('# Mine\r\nkeep\r\n', START, END, 'a\nb').text,
    `# Mine\r\nkeep\r\n\r\n${START}\r\na\r\nb\r\n${END}\r\n`,
  );
});

test('only the text between the markers is ever replaced', () => {
  const before = `above\n${START}\nold note\n${END}\nbelow\n`;
  const result = applyMarkedBlock(before, START, END, 'new note');
  assert.equal(result.text, `above\n${START}\nnew note\n${END}\nbelow\n`);
  assert.equal(result.changed, true);
});

test('writing the same note twice changes nothing', () => {
  const once = applyMarkedBlock('mine\n', START, END, 'note').text;
  const twice = applyMarkedBlock(once, START, END, 'note');
  assert.equal(twice.text, once);
  assert.equal(twice.changed, false);
});

test('markers that are not one pair in order leave the file alone', () => {
  for (const broken of [
    `${START}\nonly start\n`,
    `only end\n${END}\n`,
    `${END}\nbackwards\n${START}\n`,
    `${START}\n${START}\n${END}\n`,
    `${START}\n${END}\n${START}\n${END}\n`,
  ])
    assert.deepEqual(applyMarkedBlock(broken, START, END, 'x'), { problem: 'markers' }, broken);
});

test('the note says what SPEC 3.8 asks, and the check finds its markers', () => {
  const note = roleNote();
  assert.match(note, /`rhino`/);
  assert.match(note, /`cordyceps`/);
  assert.match(note, /Never kill Rhino by process name/);
  // Part 2 starts rhinomcp with Rhino. Part 3 is the user's: place the component, then reconnect,
  // since a session never picks up a server that was off when it started (SPEC 3.8).
  assert.match(note, /rhinomcp starts with Rhino/);
  assert.match(note, /place the Cordyceps component/);
  assert.match(note, /`\/mcp` and reconnect `cordyceps`/);
  assert.match(note, /new session/);
  const { check } = catalog.items.find((item) => item.id === 'rhino-settings');
  assert.equal(check.roleNoteStart, START);
  assert.equal(check.roleNoteEnd, END);
});

// --- Blender (SPEC 3.3)

test('the Blender command keeps the user prefs and saves with telemetry off', () => {
  const args = blenderArguments('blender_mcp_addon');
  assert.deepEqual(args.slice(0, 4), ['-b', '--python-exit-code', '1', '--python-expr']);
  assert.ok(!args.includes('--factory-startup'));
  assert.ok(!args.join(' ').includes('factory'));
  const expression = args[4];
  const order = [
    'addon_install',
    "addon_enable(module='blender_mcp_addon')",
    'telemetry_consent = False',
    'save_userpref',
  ].map((part) => expression.indexOf(part));
  assert.ok(order.every((at) => at >= 0));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  // The path travels in the environment: no double quote for Windows to get wrong.
  assert.ok(!expression.includes('"'));
  assert.ok(expression.includes("os.environ['ACCOUNTSWITCH_ADDON_FILE']"));
});

test('a module name that could break out of the expression is refused', () => {
  assert.throws(() => blenderExpression("x'); import os; ('"), /INVALID_MODULE_NAME/);
});

// --- Logs (SPEC 3.4)

test('secrets and environment dumps do not survive into a log', () => {
  const text = redactLog(
    [
      'Authorization: Bearer abc.def.ghi',
      `api_key=${'k'.repeat(20)}`,
      '"accessToken":"sk-ant-oat01-abcdefghijkl"',
      'plain sk-ant-api03-abcdefghijklmnop end',
      'ghp_abcdefghijklmnop',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl',
      'PATH=C:\\secret\\folder',
      'ANTHROPIC_API_KEY=abcdef',
      'Downloading numpy-2.0.whl (15 MB)',
    ].join('\n'),
  );
  for (const secret of [
    'abc.def.ghi',
    'kkkkkkkk',
    'sk-ant',
    'ghp_',
    'eyJ',
    'secret\\folder',
    'abcdef',
  ])
    assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes('Downloading numpy-2.0.whl (15 MB)'));
  assert.ok(text.includes('PATH=***'));
});

test('a command line in the log shows the name of an env value, not the value', () => {
  const line = describeCommand('C:\\b\\claude.exe', [
    'mcp',
    'add',
    '-s',
    'user',
    'rhino',
    '-e',
    'SOME_NAME=the-value',
    '--',
    'uvx',
    'rhinomcp@0.4.1.1',
  ]);
  assert.ok(line.includes('SOME_NAME=***'));
  assert.ok(!line.includes('the-value'));
  assert.ok(line.includes('rhinomcp@0.4.1.1'));
});

test('controls and terminal colors are dropped; Korean is kept', () => {
  assert.equal(redactLog('\u001b[32m설치\u001b[0m 완료\r\n\u0007끝'), '설치 완료\n끝');
});

test('the log answer ends with the newest text and starts where a character starts', () => {
  const files = memoryFiles();
  const date = new Date(2026, 10, 6, 10, 0, 0);
  const path = join('data', 'logs', 'setup-2026-11-06.log');
  files.write(path, '가'.repeat(30000) + '끝');
  const text = readLogTail(files, 'data', date);
  assert.ok(text.endsWith('끝'));
  assert.ok(!text.includes('\uFFFD'));
  assert.ok(Buffer.byteLength(text) <= 64 * 1024);
  assert.equal(readLogTail(files, 'data', new Date(2026, 10, 7, 10, 0, 0)), '');
});

test('what the commands inherit holds no key, no account folder and no session', () => {
  const env = installEnvironment({
    PATH: 'C:\\x',
    ANTHROPIC_API_KEY: 'x',
    anthropic_auth_token: 'x',
    CLAUDE_CONFIG_DIR: 'x',
    CLAUDE_CODE_OAUTH_TOKEN: 'x',
    CLAUDECODE: '1',
    OPENAI_API_KEY: 'x',
    CODEX_HOME: 'x',
  });
  assert.deepEqual(Object.keys(env), ['PATH']);
});

// --- Real files, in a temporary folder only

test('the real file functions, against a temporary folder', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'accountswitch-install-files-'));
  try {
    const path = join(folder, 'deep', 'er', 'file.txt');
    assert.equal(realInstallFiles.read(path), undefined);
    realInstallFiles.write(path, '첫째');
    assert.equal(await readFile(path, 'utf8'), '첫째');
    realInstallFiles.write(path, '둘째');
    assert.equal(realInstallFiles.read(path).toString(), '둘째');
    realInstallFiles.copy(path, `${path}.bak`);
    assert.equal(await readFile(`${path}.bak`, 'utf8'), '둘째');
    realInstallFiles.append(join(folder, 'logs', 'a.log'), 'one\n');
    realInstallFiles.append(join(folder, 'logs', 'a.log'), 'two\n');
    assert.equal(realInstallFiles.tail(join(folder, 'logs', 'a.log'), 4).toString(), 'two\n');
    assert.equal(realInstallFiles.tail(join(folder, 'none.log'), 4).length, 0);
    realInstallFiles.remove(path);
    realInstallFiles.remove(path);
    assert.equal(realInstallFiles.read(path), undefined);

    const saved = join(folder, 'dl', 'x.msi');
    const signal = new AbortController().signal;
    await realInstallFiles.save(saved, new Response('payload').body, signal, 100);
    assert.equal(await readFile(saved, 'utf8'), 'payload');
    await assert.rejects(
      realInstallFiles.save(`${saved}2`, new Response('payload').body, signal, 3),
    );
    assert.equal(realInstallFiles.read(`${saved}2`), undefined);
    assert.equal(realInstallFiles.read(`${saved}2.part`), undefined);

    // Bytes around the edit survive a read and a write, BOM and line endings included.
    const settings = join(folder, 'settings.xml');
    await writeFile(settings, settingsFile(WARNING('False')));
    const edited = setReadOnlyWarning(realInstallFiles.read(settings).toString('utf8'));
    realInstallFiles.write(settings, edited.xml);
    const bytes = await readFile(settings);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(bytes.toString('utf8'), settingsFile(WARNING('True')));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a note from an older version does not count, so it is written again', async () => {
  const { hasRoleNote } = await import('../src/core/setup/role-note.ts');
  const block = (body) => `mine\n${START}\n${body}\n${END}\n`;
  assert.equal(hasRoleNote(block(roleNote()), START, END), true);
  assert.equal(hasRoleNote(block(roleNote()).replaceAll('\n', '\r\n'), START, END), true);
  assert.equal(hasRoleNote(block('## Rhino tools (an older text)'), START, END), false);
  assert.equal(hasRoleNote('mine\n', START, END), false);
});
