# AccountSwitch

Claude Code와 Codex CLI(ChatGPT)의 **구독 계정을 여러 개** 등록해 두고, 각 계정의 로그인 상태와 사용량(5시간·7일, Claude는 Fable 같은 모델별 주간 한도까지)을 한 화면에서 보고, 터미널·VS Code가 쓸 계정을 바꾸는 Windows·macOS 프로그램입니다.

> 상태: 초기 개발 중(0.2.x). 계정 추가·로그인·이름 변경·순서 바꾸기·제거, 사용량 보기, "사용"으로 고른 계정을 터미널·VS Code의 기본 로그인으로 바꾸기, 사용량 기준 자동 전환, 자동 업데이트가 됩니다.

## 화면

- 서비스(Claude·ChatGPT)마다 계정 목록이 있고, 각 계정 아래에 사용량 막대가 붙습니다. 이름 앞의 점과 막대 색으로 서비스를 구분합니다(Claude 주황, ChatGPT 초록).
- 계정 줄을 끌어다 다른 계정 위에 놓으면 순서가 바뀝니다("기존 CLI 로그인" 포함). 순서는 서비스별로 `profiles.json`에 저장됩니다.
- 계정의 "사용"으로 기본 로그인을 바꾸고, `⋯` 메뉴에서 이름 변경·로그인·로그아웃·제거를 합니다.
- 화면 아래에서 사용량 조회·자동 전환을 켜고 끄며, 오른쪽 위에서 테마(시스템·라이트·다크)를 고릅니다.

## 어떻게 동작하나

- 계정 하나 = 공식 CLI의 설정 폴더 하나입니다. Claude는 `CLAUDE_CONFIG_DIR`, Codex는 `CODEX_HOME`으로 그 폴더를 지정해 **공식 CLI가 직접** 로그인·토큰 저장을 합니다. 이 앱은 비밀번호나 토큰을 따로 저장하지 않습니다.
- "기존 CLI 로그인"은 원래 쓰던 `~/.claude`·`~/.codex` 로그인입니다.
- 계정 데이터 폴더는 Windows `%LOCALAPPDATA%\AccountSwitch`, macOS `~/Library/Application Support/AccountSwitch`입니다. 계정 목록(이름·ID)은 그 안의 `profiles\profiles.json`, 추가한 계정의 CLI 폴더는 `profiles\<ID>\`입니다.
- 프로그램은 자기 창과 트레이(macOS는 메뉴 막대) 아이콘을 가진 작은 프로그램(Windows: C#·WebView2, macOS: Swift·WKWebView)이고, 안에서 앱 서버(`AccountSwitch-engine`)를 창 없이 실행합니다. 화면과 기능은 이 서버가 두 OS에 똑같이 제공합니다. 서버는 `127.0.0.1`에서만 열리고, 실행할 때 만든 일회용 토큰으로 로그인한 창만 API를 쓸 수 있습니다.

## 기본 로그인 전환

계정의 "사용"을 누르면 그 계정의 로그인이 `~/.claude`·`~/.codex`로 옮겨져, 터미널·VS Code에서 따로 설정하지 않아도 그 계정이 쓰입니다.

- **로그인만 옮깁니다.** Claude는 `~/.claude/.credentials.json`의 `claudeAiOauth`와 `~/.claude.json`의 `oauthAccount`·그 계정에 대한 캐시(사용량·모델·조직 설정 등), Codex는 `~/.codex/auth.json`만 바꿉니다. 설정·이력·MCP 로그인 등 다른 내용은 그대로입니다.
- **복사하지 않고 옮깁니다.** 로그인 토큰은 쓸 때마다 새로 바뀌므로 한 로그인이 두 곳에 있으면 한쪽이 끊깁니다. 바꿀 때마다 지금 들어 있는 로그인(그동안 갱신된 것)을 원래 계정 폴더에 되돌려 놓고 고른 계정을 넣습니다. 원래 쓰던 로그인은 `profiles\default-<서비스>\`에 있다가 "기존 CLI 로그인"을 다시 "사용"하면 돌아옵니다.
- **처음 바꿀 때의 원래 로그인**은 `profiles\original-<서비스>\`에 한 번 그대로 보관합니다(손으로 되살릴 때용, 이후 덮어쓰지 않음).
- **CLI가 켜져 있어도 바꿀 수 있습니다.** Claude Code가 토큰을 갱신할 때 쓰는 잠금(`~/.claude/.oauth_refresh.lock`, `~/.claude.lock`, `~/.claude.json.lock`)을 같이 잡고 바꾸므로, 켜져 있는 Claude Code가 이전 계정의 토큰을 다시 써 넣지 않고 다음 메시지부터 새 계정을 씁니다. Codex는 토큰을 갱신하기 전에 `auth.json`을 다시 읽어 계정이 바뀌었으면 갱신하지 않습니다(다만 Codex가 갱신 요청을 보내는 몇 초 사이에 바꾸면 이전 계정 토큰이 다시 써질 수 있고, 그때는 그 계정에 다시 로그인하면 됩니다). 켜져 있는 Codex는 다시 시작하면 새 계정을 씁니다.
- 앱 밖(터미널)에서 다른 계정으로 로그인해 두었다면, 그 로그인은 원래 주인 폴더를 덮지 않고 `profiles\set-aside-<서비스>-<시각>\`에 따로 둡니다.
- 사용 중인 계정은 로그인·로그아웃·제거를 할 수 없습니다. 먼저 다른 계정으로 바꾸세요.
- Codex가 로그인을 시스템 자격 증명 저장소에 두도록 설정돼 있으면(`cli_auth_credentials_store`가 `file`이 아님) 바꾸지 않습니다.
- 이전 버전에서 "사용"으로 골라 둔 계정은 실제 기본 로그인을 바꾸지 않았으므로, 처음 실행할 때 "기존 CLI 로그인"으로 돌아갑니다.
- **macOS**: Claude Code는 로그인을 파일이 아니라 로그인 키체인에 둡니다(`~/.claude`는 `Claude Code-credentials`, 계정 폴더는 그 뒤에 폴더 경로 SHA-256의 앞 8자리가 붙은 항목). 앱은 Claude Code처럼 `/usr/bin/security`로 그 항목의 `claudeAiOauth`만 옮기므로 키체인 허용 창이 뜨지 않습니다. 켜져 있는 Claude Code는 키체인 값을 잠시 기억하므로 30초쯤 뒤부터 새 계정을 씁니다. 원래 로그인 보관용 폴더(`default-*`, `original-*`, `set-aside-*`)도 각자의 키체인 항목을 가집니다.

## 자동 전환 (기본 꺼짐)

화면 아래 "자동 전환"을 켜면(사용량 조회가 켜져 있어야 함) 1분마다 확인해, 쓰고 있는 계정의 5시간·7일 사용량 중 높은 쪽이 기준(80·90·95%, 기본 90%)을 넘거나 한도에 닿은 서비스를 여유가 가장 많은 계정으로 바꿉니다. "사용"을 누른 것과 같은 전환이라 켜져 있는 CLI에도 같은 방식으로 적용됩니다.

- 바꿀 계정은 로그인돼 있고 사용량이 확인됐으며 기준보다 10%p 이상 낮아야 합니다(두 계정이 기준 근처에서 번갈아 바뀌지 않도록). "기존 CLI 로그인"도 후보입니다.
- 한 서비스는 10분에 한 번까지만 자동으로 바꿉니다. 쓰고 있는 계정이 한도에 닿았으면 기다리지 않습니다.
- 마지막 자동 전환과 실패는 화면 아래에 표시됩니다.

## 사용량 조회 (기본 켜짐, 끌 수 있음)

각 계정의 로그인 토큰으로 Claude·ChatGPT의 **공개 문서가 없는** 사용량 주소를 3분마다 조회합니다(`api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage`). 공식 API가 아니므로 예고 없이 바뀌거나 막힐 수 있고, 서비스 약관상 문제가 될 수 있습니다. 원하지 않으면 화면 아래의 "사용량 조회"를 끄세요. 끄면 사용량 주소로 아무것도 보내지 않습니다. 토큰은 새로 발급하거나 고쳐 쓰지 않고, 기록이나 화면에 내보내지 않습니다.

- 보이는 값: 5시간(ChatGPT는 짧은 한도)·7일 사용률과 초기화 시각, Claude는 응답의 `limits`에 오는 모델별 주간 한도(예: Fable)도 함께 표시합니다. 자동 전환은 5시간·7일만 봅니다.

## 설치

### Windows

[Releases](https://github.com/hongikarchi/AccountSwitch/releases/latest)에서 `AccountSwitch.App-win-Setup.exe`를 받아 실행합니다. 관리자 권한 없이 `%LOCALAPPDATA%\AccountSwitch.App`에 설치되고 시작 메뉴·바탕화면에 AccountSwitch가 생깁니다. Node.js는 필요 없습니다. 설치하지 않고 쓰려면 `AccountSwitch.App-win-Portable.zip`을 풀어 `AccountSwitch.exe`를 실행합니다(자동 업데이트 없음).

- **자동 업데이트**: 설치본은 켜진 뒤 1분, 이후 6시간마다 새 릴리스를 확인해 내려받고, 프로그램을 끝낼 때 적용합니다(트레이 메뉴 "재시작하여 업데이트"로 바로 적용).
- **창과 트레이**: 창을 닫아도 트레이에서 계속 실행됩니다(트레이 메뉴 "창을 닫아도 트레이에서 실행"). 끝내려면 트레이 메뉴의 "종료"를 누릅니다. "Windows 시작 시 실행"을 켜면 로그인할 때 트레이로 시작합니다.
- 서명되지 않은 파일이라 처음 실행할 때 Windows SmartScreen 경고가 나올 수 있습니다("추가 정보" → "실행").
- **삭제하면** 다른 계정을 "사용" 중이던 서비스는 원래 로그인("기존 CLI 로그인")으로 자동으로 되돌린 뒤 설치 폴더(`%LOCALAPPDATA%\AccountSwitch.App`)만 지웁니다. 계정 데이터(`%LOCALAPPDATA%\AccountSwitch`)는 남깁니다. 삭제 후에도 원래 로그인이 돌아오지 않았다면 다시 설치해 "기존 CLI 로그인"을 "사용"하세요.

### macOS (Apple silicon)

[Releases](https://github.com/hongikarchi/AccountSwitch/releases/latest)에서 `AccountSwitch.dmg`를 받아 열고, AccountSwitch를 응용 프로그램(Applications) 폴더로 끌어다 놓습니다.

- **처음 열 때**: Apple 개발자 서명이 없어 "확인되지 않은 개발자" 경고가 나옵니다. 창을 닫고 시스템 설정 → 개인정보 보호 및 보안 → 아래쪽 **"그래도 열기"**를 누릅니다(macOS 15부터는 우클릭 → 열기로는 열리지 않습니다). 창에 "서버를 시작하지 못했습니다"가 나오면 터미널에서 `xattr -cr /Applications/AccountSwitch.app`를 실행한 뒤 다시 엽니다.
- **메뉴 막대**: 메뉴 막대의 ⇄ 아이콘에서 열기·로그인 시 실행·창을 닫아도 메뉴 막대에 남기·업데이트 확인·종료를 합니다.
- **자동 업데이트**(Sparkle): 6시간마다 최신 릴리스를 확인해 내려받고, 앱을 끝낼 때 설치합니다("업데이트 확인…"으로 바로 설치). 업데이트는 EdDSA 서명으로 확인합니다.
- **지우기 전에** 메뉴 막대 아이콘 → **"원래 로그인으로 되돌리기…"**를 누르세요. macOS에는 삭제 프로그램이 없어, 앱을 휴지통에 넣기만 하면 다른 계정이 기본 로그인으로 남습니다. 계정 데이터(`~/Library/Application Support/AccountSwitch`)는 앱을 지워도 남습니다.
- Intel Mac용은 아직 없습니다.

## 필요한 것

- Windows 10/11 (Microsoft Edge WebView2 런타임: Windows 11과 대부분의 Windows 10에 이미 있음), 또는 macOS 13 이상(Apple silicon)
- 쓰려는 CLI: [Claude Code](https://docs.claude.com/en/docs/claude-code) (공식 설치본, npm 전역 설치 또는 PATH), [Codex CLI](https://github.com/openai/codex) (npm 전역 설치, Homebrew 또는 PATH). macOS 앱은 로그인 셸의 PATH로 CLI를 찾습니다.
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
npm run build:exe        # release\engine\AccountSwitch-engine.exe: 앱 서버 (Node 24.15 이상으로 실행해야 함: 실행 중인 Node가 exe에 들어감)
npm run build:desktop    # release\app\AccountSwitch.exe: 창·트레이 프로그램 (.NET SDK 필요)
npm run build:installer  # release\installer\: Velopack 설치 파일·업데이트 패키지
npm run build:mac        # (macOS) release/mac/: AccountSwitch.app·dmg·업데이트용 zip (Xcode 명령줄 도구 필요)
```

`package.json`의 버전과 같은 태그(`v0.2.0`)를 올리면 GitHub Actions(`.github/workflows/release.yml`)가 Windows와 macOS에서 시험·빌드한 뒤, 두 OS의 설치 파일과 업데이트 패키지(Windows: Velopack, macOS: Sparkle `appcast.xml`)를 같은 릴리스에 올리고, 설치된 프로그램이 이를 받아 업데이트합니다. macOS 업데이트 서명 키는 저장소 비밀값 `SPARKLE_PRIVATE_KEY`이고, 공개키는 `src/desktop/mac/sparkle-public-key.txt`입니다(비밀키를 잃으면 설치된 macOS 앱이 새 업데이트를 받지 못합니다). 잘못된 릴리스도 모든 설치본에 퍼지므로 확인한 뒤에 태그를 올리세요.

| 위치 | 내용 |
|---|---|
| `src/core/account-profiles.ts` | 계정 목록 (추가·이름 변경·순서·선택·제거, 폴더 경로 검사) |
| `src/core/default-login.ts` | 기본 로그인 전환 (로그인 옮기기, Claude Code 잠금) |
| `src/core/auto-switch.ts` | 사용량 기준 자동 전환 |
| `src/core/restore.ts` | 삭제할 때 원래 로그인 되돌리기 |
| `src/core/account-login.ts` | 공식 CLI로 로그인·로그아웃 (주소·코드 표시, 10분 제한) |
| `src/core/account-usage.ts` | 로그인한 사람·요금제, 사용량 조회(모델별 한도 포함), 전환할 계정 고르기 |
| `src/core/cli.ts` | CLI 찾기, 계정별 환경 변수, 로그인 상태 확인 |
| `src/server/` | `127.0.0.1` 로컬 서버와 API (`/api/v1/accounts/*`) |
| `src/ui/` | React 화면 |
| `src/core/keychain.ts` | macOS 로그인 키체인 (Claude Code의 로그인 항목) |
| `src/desktop/shell/` | Windows: 창(WebView2)·트레이·자동 시작·업데이트(Velopack) 프로그램 (C#, .NET Framework 4.8) |
| `src/desktop/mac/` | macOS: 메뉴 막대·창(WKWebView)·로그인 시 실행·업데이트(Sparkle) 앱 (Swift) |
| `scripts/` | 앱 서버(Node SEA), 프로그램·설치 파일·업데이트 목록 빌드 |

## 다음 단계

1. **코드 서명**: Windows SmartScreen·macOS Gatekeeper 경고를 없애는 코드 서명(macOS는 Apple 개발자 계정·공증 필요).
2. **Intel Mac**: macOS 앱의 x64 빌드.

## 출처

[VIDE](https://github.com/hongikarchi/VIDE)의 AI 계정 기능에서 분리했습니다.

## 라이선스

[MIT](LICENSE)
