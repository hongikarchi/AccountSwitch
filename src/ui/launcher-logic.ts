import { z } from 'zod';

// The parts of "Claude Code 열기" (SPEC 4) with no page around them: what the engine and the shell
// answer, how a path is shown, and what each failure says to the person.

export const statusSchema = z.object({
  platform: z.string(),
  installed: z.boolean(),
  recent: z.array(z.string()),
});
export const recentSchema = z.object({ recent: z.array(z.string()) });
export const openedSchema = z.object({ folder: z.string() });

/** What the desktop window answers to a `claude.open` message. */
export const shellReplySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claude.opened'), folder: z.string() }),
  z.object({ type: z.literal('claude.cancelled') }),
  z.object({ type: z.literal('claude.failed'), reason: z.string() }),
]);

/** Splits off the last part of a path; a drive root has none, so it is its own name. */
function split(path: string) {
  const parts = /^(.*[\\/])([^\\/]+)[\\/]*$/.exec(path);
  if (!parts) return { name: path, parent: '' };
  // `C:\foo` lives in `C:\`, whose separator is part of its name.
  return { name: parts[2], parent: parts[1].replace(/(?<=[^:\\/])[\\/]+$/, '') };
}
export const folderName = (path: string) => split(path).name;
export const parentFolder = (path: string) => split(path).parent;

/** What was typed, without the spaces and quotes that Windows' "copy as path" leaves around it. */
export function typedFolder(text: string) {
  return text
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();
}

const NOT_A_FOLDER = '이 위치는 열 수 없어요. C:\\작업처럼 드라이브 문자로 시작하는 폴더여야 해요';
const messages: Record<string, string> = {
  CLI_UNAVAILABLE: 'Claude Code를 찾지 못했어요. 설치 탭에서 먼저 설치하세요',
  FOLDER_NOT_FOUND: '폴더를 찾지 못했어요. 경로가 맞는지 확인하세요',
  FOLDER_INVALID: NOT_A_FOLDER,
  // The engine's answer to a path it will not even look at, such as one thousands of letters long.
  INVALID_INPUT: NOT_A_FOLDER,
  FOLDER_NETWORK: '네트워크 폴더에서는 열 수 없어요. 드라이브 문자로 연결한 폴더를 고르세요',
  LAUNCH_FAILED: 'Claude Code 창을 열지 못했어요. 잠시 후 다시 시도하세요',
  UNSUPPORTED_PLATFORM: 'Claude Code 열기는 Windows에서만 쓸 수 있어요',
  DIALOG_FAILED: '폴더 선택 창을 열지 못했어요. 다시 시도하세요',
  BUSY: '폴더 선택 창이 열려 있거나 Claude Code를 여는 중이에요. 잠시 후 다시 시도하세요',
};
const MISSING_RECENT = '이 폴더를 찾지 못해 최근 목록에서 뺐어요. 옮겼거나 지웠는지 확인하세요';
const UNKNOWN = 'Claude Code를 열지 못했어요. 잠시 후 다시 시도하세요';

/** The sentence for a failure; `fromRecent` when the folder was picked from the recent list. */
export function failureMessage(reason: string | undefined, fromRecent = false) {
  if (reason === 'FOLDER_NOT_FOUND' && fromRecent) return MISSING_RECENT;
  // Own keys only: a reason comes from outside, and `constructor` is no message.
  return reason && Object.hasOwn(messages, reason) ? messages[reason] : UNKNOWN;
}
