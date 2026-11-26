import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from '../src/core/setup/manifest.ts';
import { ACTION_LABELS } from '../src/core/setup/ai-settings-rules.ts';
import {
  BACKUP_NOTE,
  MODES,
  PREFIX_HINT,
  actionLabel,
  canKeepRow,
  isValidPrefix,
  keepableIds,
  keptAfter,
  parsePlan,
  planFailure,
  planMatches,
  planPath,
  prefixView,
  saveBody,
  shownAction,
} from '../src/ui/ai-settings-logic.ts';
import {
  actionFor,
  cardGroups,
  checkSummary,
  defaultChecked,
  hasPanel,
  hasPrograms,
  isListed,
  isPanelGroup,
} from '../src/ui/setup-logic.ts';

// The catalog as the engine sends it on each platform (SPEC 1, 3.11). The item is added here while
// the manifest does not have it yet, so these tests hold before and after it does.
const aiGroup = {
  id: 'ai',
  label: 'AI 작업 설정',
  description: 'Claude·GPT·Paseo로 일하는 규칙과 스킬을 넣어요.',
  optional: true,
};
const aiItem = {
  id: 'ai-settings',
  label: 'AI 작업 설정',
  description: 'Claude·GPT·Paseo로 일하는 규칙과 스킬을 넣어요.',
  group: 'ai',
  dependsOn: [],
  check: { kind: 'ai-settings' },
  install: { summary: '', automatic: true, steps: [{ kind: 'ai-settings' }] },
  pinnedVersion: null,
  mayElevate: false,
  platforms: ['win32', 'darwin'],
};
const windows = catalog.items.some(hasPanel)
  ? catalog
  : { groups: [...catalog.groups, aiGroup], items: [...catalog.items, aiItem] };
const panelItem = windows.items.find(hasPanel);
const mac = {
  groups: windows.groups.filter((group) => group.id === panelItem.group),
  items: windows.items.filter(hasPanel),
};
const withoutPanel = {
  groups: windows.groups.filter((group) => group.id !== panelItem.group),
  items: windows.items.filter((item) => !hasPanel(item)),
};

function report(list, overrides = {}) {
  return {
    platform: 'win32',
    supported: true,
    startedAt: '2026-11-26T00:00:00.000Z',
    finishedAt: '2026-11-26T00:00:01.000Z',
    pathSource: 'registry',
    results: list.items.map((entry) => ({
      id: entry.id,
      pinnedVersion: entry.pinnedVersion,
      status: 'installed',
      ...overrides[entry.id],
    })),
  };
}
const none = new Set();

const row = (id, action, extra = {}) => ({
  id,
  part: 'skill',
  target: `~/.claude/skills/${id}/`,
  action,
  canKeep: action === 'replace' || action === 'update',
  ...extra,
});

test('the AI group is no program card, and its group is known by its item', () => {
  assert.deepEqual(
    cardGroups(windows).map((group) => group.label),
    ['Claude Code', 'GPT', 'Paseo', 'Rhino', 'Blender'],
  );
  assert.equal(isPanelGroup(windows, panelItem.group), true);
  assert.equal(isPanelGroup(windows, 'rhino'), false);
  assert.equal(isPanelGroup(windows, 'nothing'), false);
});

test('macOS has nothing to pick, so the tab is the checklist with every row counted', () => {
  assert.equal(hasPrograms(windows), true);
  assert.equal(hasPrograms(mac), false);
  assert.equal(isListed(mac, panelItem.group, none), true);
  assert.equal(
    checkSummary(mac, report(mac, { [panelItem.id]: { status: 'missing' } }), none),
    '1개 중 0개 완료',
  );
  assert.equal(checkSummary(mac, report(mac), none), '1개 중 1개 완료');
});

test('on Windows the AI row counts like Rhino: once it has been part of a run', () => {
  const state = report(windows, { [panelItem.id]: { status: 'missing' } });
  assert.equal(isListed(windows, panelItem.group, none), false);
  assert.equal(
    checkSummary(windows, state, none),
    checkSummary(withoutPanel, report(withoutPanel), none),
  );
  assert.equal(isListed(windows, panelItem.group, new Set([panelItem.group])), true);
});

test('the AI item is never checked for an auto-mode run, even with its group open', () => {
  const state = report(windows, {
    git: { status: 'missing' },
    [panelItem.id]: { status: 'missing' },
  });
  const open = new Set(['claude', panelItem.group]);
  assert.deepEqual([...defaultChecked(windows, state, open)], ['git']);
  assert.deepEqual(
    [...defaultChecked(mac, report(mac, { [panelItem.id]: { status: 'missing' } }), none)],
    [],
  );
  // Missing, its row offers 설치, which unfolds the panel.
  assert.equal(actionFor(panelItem, { id: panelItem.id, status: 'missing' }).kind, 'install');
});

test('the prefix takes lowercase letters, digits and -, and previews both branches', () => {
  for (const good of ['team', 'a', 'kim-2', 'abc-', '0x', 'a'.repeat(31), '  team  '])
    assert.equal(isValidPrefix(good), true, good);
  for (const bad of ['', 'Team', '-a', 'a_b', 'a.b', 'a b', '한글', 'a'.repeat(32)])
    assert.equal(isValidPrefix(bad), false, bad);
  assert.deepEqual(prefixView(' team '), {
    valid: true,
    lines: [
      { label: '통합 브랜치', branch: 'team_develop' },
      { label: '작업 브랜치', branch: 'team_작업이름' },
    ],
  });
});

test('an invalid prefix gets one short hint, as an error only once something is typed', () => {
  assert.equal(PREFIX_HINT, "영문 소문자, 숫자, '-'만 쓸 수 있어요.");
  assert.deepEqual(prefixView(''), { valid: false, hint: PREFIX_HINT, error: false });
  assert.deepEqual(prefixView('   '), { valid: false, hint: PREFIX_HINT, error: false });
  assert.deepEqual(prefixView('Team'), { valid: false, hint: PREFIX_HINT, error: true });
});

test('the two choices of 방식, 채워 넣기 first', () => {
  assert.deepEqual(
    MODES.map((mode) => [mode.id, mode.title, mode.detail]),
    [
      ['fill', '채워 넣기', '이미 있는 것은 두고 없는 것만 넣어요.'],
      ['replace', '바꾸기', '우리 설정으로 맞추고, 바꾸는 파일은 먼저 백업해요.'],
    ],
  );
  assert.equal(BACKUP_NOTE, '바꾸는 파일은 먼저 ~/.claude/backups/ 에 백업해요.');
});

test('the plan is asked for with the typed prefix and the mode, or with nothing on opening', () => {
  assert.equal(planPath(), '/setup/ai-settings');
  assert.equal(planPath('team', 'fill'), '/setup/ai-settings?prefix=team&mode=fill');
  assert.equal(planPath(' a-b ', 'replace'), '/setup/ai-settings?prefix=a-b&mode=replace');
  // Never a second parameter smuggled in through the field.
  assert.equal(
    planPath('a&mode=replace', 'fill'),
    '/setup/ai-settings?prefix=a%26mode%3Dreplace&mode=fill',
  );
});

test('only a row that can be kept, and does not keep already, offers 내 것 유지', () => {
  const rows = [
    row('a', 'replace'),
    row('b', 'add'),
    row('c', 'keep', { canKeep: true }),
    row('d', 'update'),
    row('e', 'same', { canKeep: false }),
  ];
  assert.deepEqual(keepableIds(rows), ['a', 'd']);
  assert.equal(canKeepRow(rows[2]), false);
  const kept = new Set(['a', 'b']);
  assert.equal(shownAction(rows[0], kept), 'keep');
  assert.equal(actionLabel(rows[0], kept), '내 것 유지');
  // Not keepable, so asking for it changes nothing.
  assert.equal(shownAction(rows[1], kept), 'add');
  assert.equal(actionLabel(rows[3], kept), '새 버전');
});

test('every action has its word in the table', () => {
  for (const action of ['add', 'same', 'fill', 'update', 'keep', 'replace', 'skip'])
    assert.match(ACTION_LABELS[action], /[가-힣]/);
});

test('the kept rows reset when the plan has other rows, and stay for the same rows', () => {
  const before = [row('a', 'replace'), row('b', 'add')];
  const kept = new Set(['a']);
  assert.equal(keptAfter(kept, before, [row('a', 'keep'), row('b', 'same')]), kept);
  assert.deepEqual([...keptAfter(kept, before, [row('a', 'replace')])], []);
  assert.deepEqual([...keptAfter(kept, before, [row('b', 'add'), row('a', 'replace')])], []);
  assert.deepEqual([...keptAfter(kept, undefined, before)], []);
});

test('설치 saves the trimmed prefix, the mode, and the kept rows of this plan only', () => {
  const rows = [row('a', 'replace'), row('b', 'add'), row('d', 'update')];
  assert.deepEqual(saveBody(' team ', 'replace', new Set(['d', 'b', 'gone', 'a']), rows), {
    branchPrefix: 'team',
    mode: 'replace',
    keep: ['a', 'd'],
  });
  assert.deepEqual(saveBody('team', 'fill', new Set(), rows), {
    branchPrefix: 'team',
    mode: 'fill',
    keep: [],
  });
});

test('설치 waits for the plan of what the panel shows now', () => {
  const loaded = {
    plan: { branchPrefix: 'team', mode: 'fill', rows: [] },
    prefix: 'team',
    mode: 'fill',
    stamp: 's1',
  };
  assert.equal(planMatches(loaded, ' team ', 'fill', 's1'), true);
  assert.equal(planMatches(loaded, 'team2', 'fill', 's1'), false);
  assert.equal(planMatches(loaded, 'team', 'replace', 's1'), false);
  // A new check since: the plan is asked again first.
  assert.equal(planMatches(loaded, 'team', 'fill', 's2'), false);
  assert.equal(planMatches(null, 'team', 'fill', 's1'), false);
});

test('a plan of the right shape is read as it is', () => {
  const answer = {
    branchPrefix: null,
    mode: 'fill',
    rows: [
      {
        id: 'rules:claude',
        part: 'rules',
        target: '~/.claude/CLAUDE.md',
        action: 'replace',
        canKeep: true,
      },
      {
        id: 'paseo',
        part: 'paseo',
        target: 'Paseo',
        action: 'skip',
        detail: 'Paseo가 없어서 건너뛰어요.',
        canKeep: false,
        extra: 'ignored',
      },
    ],
  };
  const plan = parsePlan(answer);
  assert.equal(plan.branchPrefix, null);
  assert.equal(plan.mode, 'fill');
  assert.deepEqual(plan.rows[1], {
    id: 'paseo',
    part: 'paseo',
    target: 'Paseo',
    action: 'skip',
    detail: 'Paseo가 없어서 건너뛰어요.',
    canKeep: false,
  });
  assert.equal('detail' in plan.rows[0], false);
  assert.equal(
    parsePlan({ ...answer, branchPrefix: 'team', mode: 'replace' }).branchPrefix,
    'team',
  );
});

test('a plan of the wrong shape is an error, not a crash in a render', () => {
  const good = {
    id: 'settings',
    part: 'settings',
    target: '~/.claude/settings.json',
    action: 'fill',
    canKeep: true,
  };
  const plan = (change) => ({ branchPrefix: 'team', mode: 'fill', rows: [good], ...change });
  const bad = [
    undefined,
    null,
    'plan',
    [],
    {},
    plan({ rows: 'none' }),
    plan({ mode: 'other' }),
    plan({ mode: undefined }),
    plan({ branchPrefix: 5 }),
    plan({ rows: [null] }),
    plan({ rows: [{ ...good, id: '' }] }),
    plan({ rows: [{ ...good, id: 3 }] }),
    plan({ rows: [{ ...good, target: undefined }] }),
    plan({ rows: [{ ...good, part: 'other' }] }),
    plan({ rows: [{ ...good, action: 'delete' }] }),
    plan({ rows: [{ ...good, action: 'constructor' }] }),
    plan({ rows: [{ ...good, detail: 4 }] }),
    plan({ rows: [{ ...good, canKeep: 'yes' }] }),
    plan({ rows: [good, good] }),
  ];
  for (const answer of bad)
    assert.throws(() => parsePlan(answer), /요청을 처리하지 못했어요/, JSON.stringify(answer));
});

test('a refused prefix says so; any other failure is the page’s usual sentence', () => {
  const coded = (code, text) => Object.assign(new Error(text), { code });
  const known = {
    NETWORK_UNAVAILABLE: 'AccountSwitch에 연결하지 못했습니다.',
    INVALID_INPUT: '입력이 올바르지 않습니다.',
  };
  assert.deepEqual(planFailure(coded('INVALID_INPUT', '입력이 올바르지 않습니다.'), known), {
    rejected: true,
    message: PREFIX_HINT,
  });
  assert.deepEqual(planFailure(coded('NETWORK_UNAVAILABLE', known.NETWORK_UNAVAILABLE), known), {
    rejected: false,
    message: known.NETWORK_UNAVAILABLE,
  });
  const other = planFailure(coded('SETUP_RUN_ACTIVE', 'SETUP_RUN_ACTIVE'), known);
  assert.equal(other.rejected, false);
  assert.doesNotMatch(other.message, /SETUP_RUN/);
  assert.match(planFailure('what', known).message, /다시 시도/);
});
