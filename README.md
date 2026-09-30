# AccountSwitch

Claude Code와 Codex CLI(ChatGPT)의 **구독 계정을 여러 개** 등록해 두고, 각 계정의 로그인 상태와 사용량(5시간·7일)을 한 화면에서 보는 Windows용 로컬 웹 앱입니다.

> 상태: 초기 개발 중(0.1.0). 계정 추가·로그인·이름 변경·제거, 사용량 보기, "사용"으로 고른 계정을 터미널·VS Code의 기본 로그인으로 바꾸기가 됩니다.

## 어떻게 동작하나

- 계정 하나 = 공식 CLI의 설정 폴더 하나입니다. Claude는 `CLAUDE_CONFIG_DIR`, Codex는 `CODEX_HOME`으로 그 폴더를 지정해 **공식 CLI가 직접** 로그인·토큰 저장을 합니다. 이 앱은 비밀번호나 토큰을 따로 저장하지 않습니다.
- "기존 CLI 로그인"은 원래 쓰던 `~/.claude`·`~/.codex` 로그인입니다.
- 계정 목록(이름·ID)은 `%LOCALAPPDATA%\AccountSwitch\profiles\profiles.json`, 추가한 계정의 CLI 폴더는 같은 `profiles\<ID>\` 아래에 있습니다.
- 화면은 `127.0.0.1`에서만 열리고, 실행할 때 만든 일회용 토큰으로 로그인한 브라우저 창만 API를 쓸 수 있습니다.

## 기본 로그인 전환

계정의 "사용"을 누르면 그 계정의 로그인이 `~/.claude`·`~/.codex`로 옮겨져, 터미널·VS Code에서 따로 설정하지 않아도 그 계정이 쓰입니다.

- **로그인만 옮깁니다.** Claude는 `~/.claude/.credentials.json`의 `claudeAiOauth`와 `~/.claude.json`의 `oauthAccount`·그 계정에 대한 캐시(사용량·모델·조직 설정 등), Codex는 `~/.codex/auth.json`만 바꿉니다. 설정·이력·MCP 로그인 등 다른 내용은 그대로입니다.
- **복사하지 않고 옮깁니다.** 로그인 토큰은 쓸 때마다 새로 바뀌므로 한 로그인이 두 곳에 있으면 한쪽이 끊깁니다. 바꿀 때마다 지금 들어 있는 로그인(그동안 갱신된 것)을 원래 계정 폴더에 되돌려 놓고 고른 계정을 넣습니다. 원래 쓰던 로그인은 `profiles\default-<서비스>\`에 있다가 "기존 CLI 로그인"을 다시 "사용"하면 돌아옵니다.
- **처음 바꿀 때의 원래 로그인**은 `profiles\original-<서비스>\`에 한 번 그대로 보관합니다(손으로 되살릴 때용, 이후 덮어쓰지 않음).
- **CLI가 실행 중이면 바꾸지 않습니다.** 실행 중인 CLI는 이전 로그인을 파일에 다시 써 넣기 때문입니다. 터미널과 VS Code의 Claude Code(`claude.exe`)·Codex(`codex.exe`)를 모두 닫은 뒤 바꾸세요.
- 앱 밖(터미널)에서 다른 계정으로 로그인해 두었다면, 그 로그인은 원래 주인 폴더를 덮지 않고 `profiles\set-aside-<서비스>-<시각>\`에 따로 둡니다.
- 사용 중인 계정은 로그인·로그아웃·제거를 할 수 없습니다. 먼저 다른 계정으로 바꾸세요.
- Codex가 로그인을 시스템 자격 증명 저장소에 두도록 설정돼 있으면(`cli_auth_credentials_store`가 `file`이 아님) 바꾸지 않습니다.
- 이전 버전에서 "사용"으로 골라 둔 계정은 실제 기본 로그인을 바꾸지 않았으므로, 처음 실행할 때 "기존 CLI 로그인"으로 돌아갑니다.

## 사용량 조회 (기본 켜짐, 끌 수 있음)

각 계정의 로그인 토큰으로 Claude·ChatGPT의 **공개 문서가 없는** 사용량 주소를 3분마다 조회합니다(`api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage`). 공식 API가 아니므로 예고 없이 바뀌거나 막힐 수 있고, 서비스 약관상 문제가 될 수 있습니다. 원하지 않으면 화면의 "계정별 사용량 조회"를 끄세요. 끄면 사용량 주소로 아무것도 보내지 않습니다. 토큰은 새로 발급하거나 고쳐 쓰지 않고, 기록이나 화면에 내보내지 않습니다.

## 설치

[Releases](https://github.com/hongikarchi/AccountSwitch/releases)에서 `AccountSwitch-Setup-<버전>.exe`를 받아 실행합니다. 관리자 권한 없이 `%LOCALAPPDATA%\Programs\AccountSwitch`에 설치되고 시작 메뉴에 등록됩니다. Node.js는 필요 없습니다.

- 서명되지 않은 파일이라 처음 실행할 때 Windows SmartScreen 경고가 나올 수 있습니다("추가 정보" → "실행").
- 실행하면 콘솔 창이 함께 열립니다. 이 창이 앱 서버이며, 닫으면 AccountSwitch가 꺼집니다.
- **삭제하기 전에** 다른 계정을 "사용" 중이면 "기존 CLI 로그인"을 다시 "사용"해 원래 로그인으로 되돌리세요. 삭제해도 계정 데이터(`%LOCALAPPDATA%\AccountSwitch`)는 지우지 않습니다. 원래 로그인이 그 안에 보관돼 있을 수 있기 때문입니다.

## 필요한 것

- Windows 10/11
- 쓰려는 CLI: [Claude Code](https://docs.claude.com/en/docs/claude-code) (`~/.local/bin/claude.exe` 또는 PATH), [Codex CLI](https://github.com/openai/codex) (npm 전역 설치 또는 PATH)
  - 다른 위치에 있으면 `ACCOUNTSWITCH_CLAUDE_PATH`, `ACCOUNTSWITCH_CODEX_PATH`로 실행 파일 경로를 지정합니다.

## 소스에서 실행

[Node.js](https://nodejs.org/) 24.15 이상이 필요합니다.

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
npm run build:exe        # release\AccountSwitch.exe (Node 24.15 이상으로 실행해야 함: 실행 중인 Node가 exe에 들어감)
npm run build:installer  # release\AccountSwitch-Setup-<버전>.exe (Inno Setup 6 필요)
```

`package.json`의 버전과 같은 태그(`v0.1.0`)를 올리면 GitHub Actions(`.github/workflows/release.yml`)가 시험·빌드 후 설치 파일을 Releases에 올립니다.

| 위치 | 내용 |
|---|---|
| `src/core/account-profiles.ts` | 계정 목록 (추가·이름 변경·선택·제거, 폴더 경로 검사) |
| `src/core/default-login.ts` | 기본 로그인 전환 (로그인 옮기기, CLI 실행 확인) |
| `src/core/account-login.ts` | 공식 CLI로 로그인·로그아웃 (주소·코드 표시, 10분 제한) |
| `src/core/account-usage.ts` | 로그인한 사람·요금제, 사용량 조회와 한도 표시 |
| `src/core/cli.ts` | CLI 찾기, 계정별 환경 변수, 로그인 상태 확인 |
| `src/server/` | `127.0.0.1` 로컬 서버와 API (`/api/v1/accounts/*`) |
| `src/ui/` | React 화면 |
| `scripts/`, `installer/` | 실행 파일(Node SEA)과 Inno Setup 설치 파일 빌드 |

## 다음 단계

1. **한도 자동 전환**: 선택 계정이 기준(%)을 넘으면 여유가 가장 많은 계정으로 바꿉니다(`AccountUsageService.choose`는 이미 있음). CLI가 실행 중이면 바꿀 수 없으므로, CLI가 꺼질 때까지 기다렸다 바꾸는 처리가 필요합니다.
2. **코드 서명·아이콘**: SmartScreen 경고를 없애는 코드 서명, 실행 파일 아이콘, 콘솔 창 없이 트레이에서 실행.

## 출처

[VIDE](https://github.com/hongikarchi/VIDE)의 AI 계정 기능에서 분리했습니다.

## 라이선스

[MIT](LICENSE)
