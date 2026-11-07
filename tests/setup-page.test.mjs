import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from '../src/core/setup/manifest.ts';
import {
  ELEVATION_NOTE,
  actionFor,
  autoOpens,
  byGroup,
  canStart,
  checkSummary,
  checkedInOrder,
  clock,
  confirmationsFor,
  defaultChecked,
  failureMessage,
  groupCount,
  isRunActive,
  parseOverview,
  parseReport,
  parseRun,
  picksCli,
  runAnnouncement,
  runOutcome,
  runRequest,
  runSummary,
  stepFromCheck,
  stepFromRun,
  toggleGroup,
  visibleItems,
} from '../src/ui/setup-logic.ts';

const item = (id) => catalog.items.find((entry) => entry.id === id);
/** A check report where everything is installed, except what `overrides` says. */
function report(overrides = {}) {
  return {
    platform: 'win32',
    supported: true,
    startedAt: '2026-11-06T00:00:00.000Z',
    finishedAt: '2026-11-06T00:00:01.000Z',
    pathSource: 'registry',
    results: catalog.items.map((entry) => ({
      id: entry.id,
      pinnedVersion: entry.pinnedVersion,
      status: 'installed',
      ...overrides[entry.id],
    })),
  };
}
const missing = { status: 'missing' };
const none = new Set();

test('auto mode checks what is missing and nothing else', () => {
  const checked = defaultChecked(
    catalog,
    report({
      git: missing,
      node: { status: 'version-mismatch', foundVersion: '22.1.0' },
      uv: { status: 'timeout' },
      python: { status: 'error' },
    }),
    none,
  );
  assert.deepEqual([...checked], ['git']);
});

test('optional groups stay out until the user ticks the group', () => {
  const state = report({ git: missing, 'rhinomcp-mcp': missing, blender: missing });
  const first = defaultChecked(catalog, state, none);
  assert.deepEqual([...first], ['git']);
  assert.ok(visibleItems(catalog, none).every((entry) => entry.group === 'base'));

  const on = toggleGroup(catalog, state, { checked: first, openGroups: none }, 'blender', true);
  assert.deepEqual(checkedInOrder(catalog, on.checked), ['git', 'blender']);
  assert.ok(on.openGroups.has('blender'));

  const off = toggleGroup(catalog, state, on, 'blender', false);
  assert.deepEqual(checkedInOrder(catalog, off.checked), ['git']);
  assert.ok(!off.openGroups.has('blender'));
});

test('ticking a group does not check what is already there or of another version', () => {
  const state = report({
    blender: { status: 'version-mismatch', foundVersion: '4.5.0' },
    'blender-mcp-addon': missing,
  });
  const on = toggleGroup(catalog, state, { checked: none, openGroups: none }, 'blender', true);
  assert.deepEqual(checkedInOrder(catalog, on.checked), ['blender-mcp-addon']);
});

test('the checked items go in catalog order, and only they go', () => {
  const checked = new Set(['codex', 'git']);
  assert.deepEqual(runRequest(checkedInOrder(catalog, checked), 'auto', []), {
    items: ['git', 'codex'],
    mode: 'auto',
  });
});

test('a run of only what the user must do cannot start', () => {
  assert.equal(canStart(catalog, new Set(['rhino'])), false);
  assert.equal(canStart(catalog, new Set(['rhino', 'rhinomcp-plugin'])), true);
  assert.equal(canStart(catalog, none), false);
});

test('an existing install is offered only where the catalog says how', () => {
  const mismatch = { id: 'x', pinnedVersion: null, status: 'version-mismatch' };
  assert.deepEqual(actionFor(item('node'), mismatch), { kind: 'none' });
  assert.deepEqual(actionFor(item('rhinomcp-plugin'), mismatch), { kind: 'none' });
  assert.deepEqual(actionFor(item('rhinomcp-mcp'), mismatch), { kind: 'register-again' });
  assert.equal(actionFor(item('blender'), mismatch).kind, 'install');
  assert.equal(
    actionFor(item('blender'), mismatch).warning,
    item('blender').install.warnIfOtherVersion,
  );
});

test('a state nobody could check is unknown, not missing', () => {
  for (const status of ['timeout', 'error']) {
    const result = { id: 'git', pinnedVersion: 'latest', status, message: '답이 없어요.' };
    assert.deepEqual(actionFor(item('git'), result), { kind: 'none' });
    const view = stepFromCheck(catalog, item('git'), result);
    assert.equal(view.node, 'unknown');
    assert.equal(view.meta, '확인하지 못함');
    assert.deepEqual(view.notes, [{ text: '답이 없어요.', tone: 'muted' }]);
  }
});

test('a missing Blender has no warning; another version has to be agreed to', () => {
  assert.deepEqual(actionFor(item('blender'), { status: 'missing' }), { kind: 'install' });
  assert.deepEqual(confirmationsFor(catalog, report({ blender: missing }), ['blender']), []);
  const asked = confirmationsFor(
    catalog,
    report({ blender: { status: 'version-mismatch', foundVersion: '4.5.0' } }),
    ['blender'],
  );
  assert.equal(asked.length, 1);
  assert.equal(asked[0].text, item('blender').install.warnIfOtherVersion);
  assert.equal(asked[0].replace, false);
  assert.deepEqual(runRequest(['blender'], 'check', asked), { items: ['blender'], mode: 'check' });
  // Auto mode keeps another version whatever is asked, so it offers nothing and asks nothing.
  const other = { status: 'version-mismatch', foundVersion: '4.5.0' };
  assert.deepEqual(actionFor(item('blender'), other, 'auto'), { kind: 'none' });
  assert.deepEqual(confirmationsFor(catalog, report({ blender: other }), ['blender'], 'auto'), []);
});

test('an MCP item with another version goes in replace only after being asked', () => {
  const state = report({
    'rhinomcp-mcp': { status: 'version-mismatch', foundVersion: '0.3.0' },
    'cordyceps-mcp': { status: 'version-mismatch', message: '다른 주소로 등록되어 있어요.' },
  });
  const asked = confirmationsFor(catalog, state, ['rhinomcp-mcp', 'cordyceps-mcp']);
  assert.deepEqual(
    asked.map((entry) => [entry.id, entry.replace]),
    [
      ['rhinomcp-mcp', true],
      ['cordyceps-mcp', true],
    ],
  );
  assert.match(asked[0].text, /0\.4\.1\.1 버전으로 다시 등록/);
  assert.doesNotMatch(asked[1].text, /버전으로/);
  assert.deepEqual(runRequest(['rhinomcp-mcp'], 'check', [asked[0]]), {
    items: ['rhinomcp-mcp'],
    mode: 'check',
    replace: ['rhinomcp-mcp'],
  });
  // A registration that is simply missing has nothing to replace.
  assert.deepEqual(
    confirmationsFor(catalog, report({ 'rhinomcp-mcp': missing }), ['rhinomcp-mcp']),
    [],
  );
});

test('a row says what the check found', () => {
  const row = (id, result) =>
    stepFromCheck(catalog, item(id), { id, pinnedVersion: item(id).pinnedVersion, ...result });
  assert.equal(row('git', { status: 'installed', foundVersion: '2.56.0' }).meta, '설치됨 · 2.56.0');
  assert.equal(row('git', { status: 'installed', foundVersion: '2.56.0' }).node, 'done');
  assert.equal(row('git', { status: 'missing' }).meta, '없음');
  assert.equal(row('git', { status: 'missing' }).node, 'pending');
  const other = row('node', { status: 'version-mismatch', foundVersion: '22.1.0' });
  assert.equal(other.node, 'mismatch');
  assert.equal(other.meta, '버전 다름 · 찾은 버전 22.1.0 · 필요한 버전 24.22.1');
  assert.equal(stepFromCheck(catalog, item('git'), undefined).meta, '확인하는 중');
});

test('a row says in Korean which packages, parts and programs are missing', () => {
  const packages = stepFromCheck(catalog, item('py-gis'), {
    id: 'py-gis',
    pinnedVersion: 'latest',
    status: 'missing',
    missingPackages: ['pyproj', 'rtree'],
  });
  assert.equal(packages.meta, '일부 없음');
  assert.deepEqual(packages.notes, [{ text: '없는 패키지: pyproj, rtree', tone: 'muted' }]);

  const parts = stepFromCheck(catalog, item('env'), {
    id: 'env',
    pinnedVersion: null,
    status: 'missing',
    parts: [
      { id: 'a', label: '프로그램 경로', ok: true },
      { id: 'b', label: '한글 깨짐 방지', ok: false },
    ],
  });
  assert.equal(parts.meta, '일부 없음');
  assert.deepEqual(parts.parts, [
    { label: '프로그램 경로', ok: true },
    { label: '한글 깨짐 방지', ok: false },
  ]);

  const result = { id: 'codex', pinnedVersion: 'latest', status: 'missing', waitingFor: ['node'] };
  const waiting = stepFromCheck(catalog, item('codex'), result);
  assert.deepEqual(waiting.notes, [{ text: '먼저 필요해요: Node.js 24', tone: 'muted' }]);
  const coming = stepFromCheck(catalog, item('codex'), result, { checked: new Set(['node']) });
  assert.deepEqual(coming.notes, [
    { text: 'Node.js 24 설치가 끝나면 이어서 설치해요.', tone: 'muted' },
  ]);
});

test('what only the user can install is never promised to follow by itself', () => {
  const view = stepFromCheck(
    catalog,
    item('rhinomcp-plugin'),
    { id: 'rhinomcp-plugin', pinnedVersion: '0.4.1.1', status: 'missing', waitingFor: ['rhino'] },
    { checked: new Set(['rhino', 'rhinomcp-plugin']) },
  );
  assert.deepEqual(view.notes, [{ text: '먼저 필요해요: Rhino 8', tone: 'muted' }]);
});

test('버전 다름 with nothing to offer says the program is left alone', () => {
  const view = stepFromCheck(catalog, item('node'), {
    id: 'node',
    pinnedVersion: '24.22.1',
    status: 'version-mismatch',
    foundVersion: '22.1.0',
  });
  assert.deepEqual(view.notes, [{ text: '이미 있는 프로그램은 그대로 둬요.', tone: 'muted' }]);
  const offered = stepFromCheck(catalog, item('blender'), {
    id: 'blender',
    pinnedVersion: '5.2.3',
    status: 'version-mismatch',
    foundVersion: '4.5.2',
  });
  assert.deepEqual(offered.notes, []);
});

test('Rhino missing is the user’s step, with the link of its manual step', () => {
  const view = stepFromCheck(catalog, item('rhino'), {
    id: 'rhino',
    pinnedVersion: '8',
    status: 'missing',
  });
  assert.equal(view.node, 'needs-user');
  assert.deepEqual(view.manual, {
    message: 'Rhino 8을 먼저 설치하세요',
    url: 'https://www.rhino3d.com/download/',
  });
});

test('after a run a row keeps what the run said until it is installed', () => {
  const result = { id: 'git', pinnedVersion: 'latest', status: 'missing' };
  const failed = stepFromCheck(catalog, item('git'), result, {
    lastRun: { id: 'git', status: 'failed', message: '내려받지 못했어요.' },
  });
  assert.equal(failed.node, 'failed');
  assert.deepEqual(failed.notes, [{ text: '내려받지 못했어요.', tone: 'danger' }]);
  const fixed = stepFromCheck(
    catalog,
    item('git'),
    { ...result, status: 'installed' },
    {
      lastRun: { id: 'git', status: 'failed', message: '내려받지 못했어요.' },
    },
  );
  assert.equal(fixed.node, 'done');
  assert.deepEqual(fixed.notes, []);
});

test('the run screen shows the elevation sentence only while such an item runs', () => {
  assert.equal(
    ELEVATION_NOTE,
    "권한 확인 창이 뜨면 '예'를 누르세요. 창이 안 보이면 작업 표시줄을 확인하세요.",
  );
  assert.equal(stepFromRun(item('node'), { id: 'node', status: 'running' }).elevating, true);
  assert.equal(stepFromRun(item('uv'), { id: 'uv', status: 'running' }).elevating, false);
  assert.equal(stepFromRun(item('node'), { id: 'node', status: 'pending' }).elevating, false);
  assert.equal(stepFromRun(item('node'), { id: 'node', status: 'done' }).elevating, false);
});

test('a failed run row shows the reason in the server’s words', () => {
  const declined = stepFromRun(item('node'), {
    id: 'node',
    status: 'failed',
    reason: 'ELEVATION_DECLINED',
    message: "권한 확인에서 '아니요'를 눌렀어요",
  });
  assert.equal(declined.node, 'failed');
  assert.deepEqual(declined.notes, [{ text: "권한 확인에서 '아니요'를 눌렀어요", tone: 'danger' }]);
  const silent = stepFromRun(item('node'), {
    id: 'node',
    status: 'failed',
    reason: 'ELEVATION_DECLINED',
  });
  assert.equal(silent.notes[0].text, "권한 확인에서 '아니요'를 눌렀어요");
  assert.equal(stepFromRun(item('git'), { id: 'git', status: 'failed' }).notes[0].tone, 'danger');
});

test('needs-user shows one action: the link, or the server’s sentence', () => {
  const rhino = stepFromRun(item('rhino'), {
    id: 'rhino',
    status: 'needs-user',
    message: 'Rhino 8을 먼저 설치하세요',
  });
  assert.equal(rhino.node, 'needs-user');
  assert.equal(rhino.manual.url, 'https://www.rhino3d.com/download/');
  assert.deepEqual(rhino.notes, []);
  const closing = stepFromRun(item('rhino-settings'), {
    id: 'rhino-settings',
    status: 'needs-user',
    message: 'Rhino를 닫고 다시 시도하세요',
  });
  assert.equal(closing.manual, undefined);
  assert.deepEqual(closing.notes, [{ text: 'Rhino를 닫고 다시 시도하세요', tone: 'muted' }]);
});

test('a run item the catalog does not know still gets a row', () => {
  const view = stepFromRun(undefined, { id: 'new-item', status: 'done' });
  assert.equal(view.label, 'new-item');
});

test('counts', () => {
  const state = report({ git: missing, node: missing });
  assert.equal(checkSummary(catalog, state, none), '8개 중 6개 완료');
  assert.equal(groupCount(catalog, report({ rhino: missing }), 'rhino'), '6개 중 5개 설치됨');
  assert.equal(groupCount(catalog, null, 'rhino'), '6개');
  const run = {
    phase: 'finished',
    mode: 'auto',
    cancelling: false,
    startedAt: '',
    items: [
      { id: 'git', status: 'done' },
      { id: 'node', status: 'failed' },
      { id: 'uv', status: 'skipped' },
      { id: 'rhino', status: 'needs-user' },
      { id: 'codex', status: 'pending' },
    ],
  };
  assert.equal(runSummary(run), '5개 중 1개 완료');
  assert.deepEqual(runOutcome(run), {
    title: '설치를 마쳤어요',
    detail: '완료 1개 · 실패 1개 · 건너뜀 1개 · 직접 해야 할 일 1개 · 시작하지 않음 1개',
  });
  assert.equal(runOutcome({ ...run, phase: 'cancelled' }).title, '설치를 취소했어요');
});

test('a run is active while running or waiting, and over otherwise', () => {
  assert.equal(isRunActive({ phase: 'running' }), true);
  assert.equal(isRunActive({ phase: 'waiting' }), true);
  assert.equal(isRunActive({ phase: 'finished' }), false);
  assert.equal(isRunActive({ phase: 'cancelled' }), false);
  assert.equal(isRunActive(null), false);
});

test('progress is announced in words', () => {
  const run = (status, id = 'node') => ({
    phase: 'running',
    mode: 'auto',
    cancelling: false,
    startedAt: '',
    items: [{ id, status }],
  });
  assert.equal(
    runAnnouncement(catalog, run('running')),
    `Node.js 24 설치하는 중. ${ELEVATION_NOTE}`,
  );
  assert.equal(runAnnouncement(catalog, run('running', 'uv')), 'uv 설치하는 중.');
  assert.match(runAnnouncement(catalog, run('failed')), /Node\.js 24 설치에 실패했어요/);
  assert.equal(
    runAnnouncement(catalog, { ...run('running'), cancelling: true }),
    '취소하는 중이에요.',
  );
});

test('rows split by group in catalog order', () => {
  const groups = byGroup(catalog, [{ group: 'rhino' }, { group: 'base' }, { group: 'rhino' }]);
  assert.deepEqual(
    groups.map(({ group, rows }) => [group.id, rows.length]),
    [
      ['base', 1],
      ['rhino', 2],
    ],
  );
});

test('a time is shown the way the 계정 tab shows it', () => {
  assert.equal(clock(new Date(2026, 10, 6, 17, 9).toISOString()), '오후 05:09');
  assert.equal(clock(new Date(2026, 10, 6, 0, 30).toISOString()), '오전 12:30');
  assert.equal(clock(undefined), '');
  assert.equal(clock('not a date'), '');
});

test('the wizard opens by itself only when the engine says so', () => {
  assert.equal(autoOpens({ autoOpen: { open: true } }), true);
  assert.equal(autoOpens({ autoOpen: { open: false } }), false);
  assert.equal(autoOpens({}), false);
  assert.equal(autoOpens(undefined), false);
  assert.equal(autoOpens('open'), false);
});

test('an answer of the wrong shape is an error, not a crash in a render', () => {
  assert.throws(() => parseOverview({}));
  assert.throws(() => parseOverview({ catalog: { items: [] } }));
  assert.throws(() => parseReport({ results: 'none' }));
  assert.throws(() => parseRun({}));
  assert.throws(() => parseRun({ run: { phase: 'running' } }));
  assert.equal(parseRun({ run: null }), null);
  assert.equal(parseOverview({ catalog }).catalog, catalog);
});

test('a failure is told in Korean, never as a bare code', () => {
  const known = { NETWORK_UNAVAILABLE: '연결하지 못했습니다.' };
  const coded = (code, text) => Object.assign(new Error(text), { code });
  assert.equal(
    failureMessage(coded('NETWORK_UNAVAILABLE', '연결하지 못했습니다.'), known),
    '연결하지 못했습니다.',
  );
  assert.doesNotMatch(
    failureMessage(coded('SETUP_RUN_ACTIVE', 'SETUP_RUN_ACTIVE'), known),
    /SETUP_RUN/,
  );
  assert.equal(failureMessage(new Error('네트워크 오류'), known), '네트워크 오류');
  assert.match(failureMessage('what', known), /다시 시도/);
});

test('the cards are the optional groups in order, and the base group comes along', () => {
  assert.deepEqual(
    catalog.groups.filter((group) => group.optional).map((group) => group.label),
    ['Claude Code', 'GPT', 'Rhino', 'Blender'],
  );
  for (const id of ['py-gis', 'py-3d'])
    assert.equal(catalog.items.find((item) => item.id === id).group, 'base');
  const state = report({
    git: missing,
    claude: missing,
    codex: missing,
    'blender-mcp': missing,
    'rhinomcp-mcp': missing,
  });
  const items = (picked) =>
    checkedInOrder(catalog, defaultChecked(catalog, state, new Set(picked)));
  assert.deepEqual(items(['claude']), ['git', 'claude']);
  assert.deepEqual(items(['codex']), ['git', 'codex']);
  assert.deepEqual(items(['claude', 'blender']), ['git', 'claude', 'blender-mcp']);
  assert.deepEqual(items(['claude', 'codex', 'rhino', 'blender']), [
    'git',
    'claude',
    'codex',
    'rhinomcp-mcp',
    'blender-mcp',
  ]);
});

test('다음 needs Claude Code or GPT', () => {
  assert.equal(picksCli(catalog, new Set()), false);
  assert.equal(picksCli(catalog, new Set(['rhino', 'blender'])), false);
  assert.equal(picksCli(catalog, new Set(['claude'])), true);
  assert.equal(picksCli(catalog, new Set(['codex', 'rhino'])), true);
});

test('without Claude Code picked, its connections stay unticked until it is', () => {
  const state = report({
    codex: missing,
    claude: missing,
    'blender-mcp': missing,
    blender: missing,
  });
  const picked = new Set(['codex', 'blender']);
  const checked = defaultChecked(catalog, state, picked);
  assert.deepEqual(checkedInOrder(catalog, checked), ['codex', 'blender']);
  const on = toggleGroup(catalog, state, { checked, openGroups: picked }, 'claude', true);
  assert.deepEqual(checkedInOrder(catalog, on.checked), [
    'claude',
    'codex',
    'blender',
    'blender-mcp',
  ]);
});
