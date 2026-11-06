import { EmptyState } from './usage.tsx';

/** The 설치 tab, a placeholder until the setup wizard is built (SPEC section 3). */
export function SetupTab() {
  return (
    <EmptyState
      size="large"
      kind="install"
      title="설치 화면을 준비하고 있어요"
      detail="곧 이곳에서 이 PC에 필요한 프로그램을 점검하고 설치할 수 있어요."
    />
  );
}
