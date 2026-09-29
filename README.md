# AccountSwitch

Claude Code와 Codex CLI(ChatGPT)의 **구독 계정을 여러 개** 등록해 두고, 각 계정의 로그인 상태와 사용량(5시간·7일)을 한 화면에서 보는 Windows용 로컬 웹 앱입니다.

> 상태: 초기 개발 중(0.1.0). 계정 추가·로그인·이름 변경·제거와 사용량 보기가 됩니다. "사용"으로 고른 계정을 터미널·VS Code의 기본 로그인으로 바꾸는 기능은 아직 없습니다([다음 단계](#다음-단계)).

## 어떻게 동작하나

- 계정 하나 = 공식 CLI의 설정 폴더 하나입니다. Claude는 `CLAUDE_CONFIG_DIR`, Codex는 `CODEX_HOME`으로 그 폴더를 지정해 **공식 CLI가 직접** 로그인·토큰 저장을 합니다. 이 앱은 비밀번호나 토큰을 따로 저장하지 않습니다.
- "기존 CLI 로그인"은 원래 쓰던 `~/.claude`·`~/.codex` 로그인이며, 이 앱은 그 파일을 바꾸지 않습니다.
- 계정 목록(이름·ID)은 `%LOCALAPPDATA%\AccountSwitch\profiles\profiles.json`, 추가한 계정의 CLI 폴더는 같은 `profiles\<ID>\` 아래에 있습니다.
- 화면은 `127.0.0.1`에서만 열리고, 실행할 때 만든 일회용 토큰으로 로그인한 브라우저 창만 API를 쓸 수 있습니다.

## 사용량 조회 (선택, 기본 꺼짐)

켜면 각 계정의 로그인 토큰으로 Claude·ChatGPT의 **공개 문서가 없는** 사용량 주소를 3분마다 조회합니다(`api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage`). 공식 API가 아니므로 예고 없이 바뀌거나 막힐 수 있고, 서비스 약관상 문제가 될 수 있습니다. 켜기 전에 각 서비스의 약관을 확인하세요. 토큰은 새로 발급하거나 고쳐 쓰지 않고, 기록이나 화면에 내보내지 않습니다.

## 필요한 것

- Windows 10/11
- [Node.js](https://nodejs.org/) 24.15 이상
- 쓰려는 CLI: [Claude Code](https://docs.claude.com/en/docs/claude-code) (`~/.local/bin/claude.exe` 또는 PATH), [Codex CLI](https://github.com/openai/codex) (npm 전역 설치 또는 PATH)
  - 다른 위치에 있으면 `ACCOUNTSWITCH_CLAUDE_PATH`, `ACCOUNTSWITCH_CODEX_PATH`로 실행 파일 경로를 지정합니다.

## 실행

```powershell
npm install
npm start          # 화면을 빌드하고 기본 브라우저로 엽니다
```

- 이미 켜져 있으면 새로 띄우지 않고 켜진 화면을 엽니다.
- `npm start -- --no-open`: 브라우저를 열지 않습니다(주소는 콘솔에 나옵니다).
- `ACCOUNTSWITCH_PORT`: 포트 고정(기본은 빈 포트 자동 선택), `ACCOUNTSWITCH_DATA`: 데이터 폴더 변경.

## 개발

```powershell
npm test           # 단위·서버 시험
npm run typecheck
npm run format
```

| 위치 | 내용 |
|---|---|
| `src/core/account-profiles.ts` | 계정 목록 (추가·이름 변경·선택·제거, 폴더 경로 검사) |
| `src/core/account-login.ts` | 공식 CLI로 로그인·로그아웃 (주소·코드 표시, 10분 제한) |
| `src/core/account-usage.ts` | 로그인한 사람·요금제, 사용량 조회와 한도 표시 |
| `src/core/cli.ts` | CLI 찾기, 계정별 환경 변수, 로그인 상태 확인 |
| `src/server/` | `127.0.0.1` 로컬 서버와 API (`/api/v1/accounts/*`) |
| `src/ui/` | React 화면 |

## 다음 단계

1. **기본 로그인 전환**: 고른 계정을 `~/.claude`·`~/.codex` 기본 로그인으로 바꿔 넣어, 터미널·VS Code에서 따로 설정하지 않아도 그 계정이 쓰이게 합니다. 원래 로그인 파일의 백업·복구와, CLI가 실행 중일 때의 처리를 먼저 만듭니다.
2. **한도 자동 전환**: 선택 계정이 기준(%)을 넘으면 여유가 가장 많은 계정으로 바꿉니다(`AccountUsageService.choose`는 이미 있음).
3. **설치 파일**: Node 없이 설치하는 Windows 설치 파일과 GitHub Releases 배포.

## 출처

[VIDE](https://github.com/hongikarchi/VIDE)의 AI 계정 기능에서 분리했습니다.
