import { z } from 'zod';
import { providers, type Provider } from '../core/providers.ts';

// The parts of the launch buttons (SPEC 4) with no page around them: what the engine and the shell
// answer, how a typed path is read, and what each failure says to the person.

const provider = z.enum(providers);

export const statusSchema = z.object({
  platform: z.string(),
  installed: z.record(provider, z.boolean()),
});

/** The desktop window answers a `launcher.open` message only when it failed. */
export const shellReplySchema = z.object({
  type: z.literal('launcher.failed'),
  provider,
  reason: z.string(),
});

/** What each button opens, in the words of the rest of the page. */
export const cliNames: Record<Provider, string> = {
  'claude-cli': 'Claude Code',
  'codex-cli': 'Codex CLI',
};

/** What was typed, without the spaces and quotes that Windows' "copy as path" leaves around it. */
export function typedFolder(text: string) {
  return text
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();
}

const NOT_A_FOLDER = '이 위치는 열 수 없어요. C:\\작업처럼 드라이브 문자로 시작하는 폴더여야 해요';
const messages: Record<string, string> = {
  FOLDER_NOT_FOUND: '폴더를 찾지 못했어요. 경로가 맞는지 확인하세요',
  FOLDER_INVALID: NOT_A_FOLDER,
  // The engine's answer to a path it will not even look at, such as one thousands of letters long.
  INVALID_INPUT: NOT_A_FOLDER,
  FOLDER_NETWORK: '네트워크 폴더에서는 열 수 없어요. 드라이브 문자로 연결한 폴더를 고르세요',
  UNSUPPORTED_PLATFORM: '터미널 열기는 Windows에서만 쓸 수 있어요',
  DIALOG_FAILED: '폴더 선택 창을 열지 못했어요. 다시 시도하세요',
  BUSY: '폴더 선택 창이 이미 열려 있거나 터미널을 여는 중이에요. 잠시 후 다시 시도하세요',
};

/** The sentence for a failure of the button of this service. */
export function failureMessage(reason: string | undefined, service: Provider) {
  const name = cliNames[service];
  if (reason === 'CLI_UNAVAILABLE') return `${name}를 찾지 못했어요. 설치 탭에서 먼저 설치하세요`;
  if (reason === 'LAUNCH_FAILED') return `${name} 창을 열지 못했어요. 잠시 후 다시 시도하세요`;
  // Own keys only: a reason comes from outside, and `constructor` is no message.
  return reason && Object.hasOwn(messages, reason)
    ? messages[reason]
    : `${name}를 열지 못했어요. 잠시 후 다시 시도하세요`;
}
