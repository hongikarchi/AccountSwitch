import { z } from 'zod';

// The local server answers errors as {code}; the page shows them in Korean.
export const errors: Record<string, string> = {
  NETWORK_UNAVAILABLE: 'AccountSwitch에 연결하지 못했습니다. 프로그램이 켜져 있는지 확인하세요.',
  UNAUTHORIZED: '세션이 끝났습니다. AccountSwitch를 다시 실행하세요.',
  CLI_UNAVAILABLE: 'CLI를 찾지 못했습니다. Claude Code 또는 Codex CLI를 먼저 설치하세요.',
  SUBSCRIPTION_LOGIN_REQUIRED: '이 계정은 아직 로그인되지 않았습니다. 먼저 로그인하세요.',
  PROFILE_IN_USE: '이 서비스의 로그인이 진행 중입니다. 끝난 뒤 다시 시도하세요.',
  PROFILE_LOGIN_IN_PROGRESS: '로그인이 진행 중입니다. 끝난 뒤 다시 시도하세요.',
  PROFILE_LOGOUT_REQUIRED: '먼저 이 계정을 로그아웃하세요.',
  PROFILE_CLEANUP_FAILED: '계정 폴더를 정리하지 못했습니다. 계정은 목록에 남아 있습니다.',
  PROFILE_LIMIT: '계정은 서비스마다 합쳐 30개까지 추가할 수 있습니다.',
  PROFILE_PATH_INVALID: '계정 폴더가 올바르지 않습니다.',
  PROFILE_ACTIVE: '사용 중인 계정입니다. 먼저 다른 계정을 사용으로 바꾼 뒤 다시 시도하세요.',
  CLI_RUNNING:
    '이 서비스의 CLI가 실행 중입니다. 터미널과 VS Code에서 모두 닫은 뒤 다시 시도하세요. 실행 중에 바꾸면 CLI가 이전 로그인을 다시 써 넣습니다.',
  CLI_CHECK_FAILED: '실행 중인 CLI를 확인하지 못했습니다. 바꾸지 않았습니다.',
  CODEX_KEYRING:
    'Codex가 로그인을 시스템 자격 증명 저장소에 두도록 설정돼 있어 바꿀 수 없습니다(~/.codex/config.toml의 cli_auth_credentials_store).',
  DEFAULT_LOGIN_UNREADABLE: '로그인 파일을 읽지 못해 기본 로그인을 바꾸지 않았습니다.',
  DEFAULT_LOGIN_LOCKED:
    '기본 로그인 파일을 쓰지 못했습니다. 그 파일을 연 프로그램을 닫고 다시 시도하세요.',
  LOGIN_NOT_WAITING: '지금은 코드를 받을 수 없습니다. 로그인을 다시 시작하세요.',
  INVALID_INPUT: '입력이 올바르지 않습니다.',
};
export async function api(path: string, method = 'GET', data?: unknown): Promise<unknown> {
  let response;
  try {
    response = await fetch('api/v1' + path, {
      method,
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new Error(errors.NETWORK_UNAVAILABLE);
  }
  const result: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = z.object({ code: z.string() }).safeParse(result).data?.code ?? 'REQUEST_FAILED';
    throw Object.assign(new Error(errors[code] ?? code), { code });
  }
  return result;
}
/** Sign the page in with the token of its launch link, then forget the token. */
export async function connect() {
  const token = location.hash.slice(1);
  if (!token) return;
  await api('/session', 'POST', { token });
  history.replaceState(null, '', location.pathname + location.search);
}
