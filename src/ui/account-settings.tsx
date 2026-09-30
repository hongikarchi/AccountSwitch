import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api } from './gateway.ts';
import { AccountUsageLines, type AccountUsage } from './usage.tsx';
import { providers } from '../core/providers.ts';
import type { Provider } from '../core/providers.ts';
const schema = z.object({
  profiles: z.array(z.object({ id: z.string(), provider: z.enum(providers), label: z.string() })),
  active: z.record(z.string(), z.string()),
  defaultLabels: z.record(z.string(), z.string()).optional(),
  order: z.record(z.string(), z.array(z.string())).optional(),
});
const loginSchema = z.array(
  z.object({
    id: z.string().optional(),
    provider: z.enum(providers),
    profileId: z.string(),
    state: z.enum(['running', 'stopping', 'succeeded', 'failed', 'cancelled']),
    reason: z.string().optional(),
    operation: z.enum(['login', 'logout']).default('login'),
    mode: z.enum(['address', 'browser']).optional(),
    expiresAt: z.string().optional(),
    prompt: z
      .object({
        url: z.string().optional(),
        code: z.string().optional(),
        needsCode: z.boolean(),
        codeSent: z.boolean().optional(),
      })
      .optional(),
  }),
);
type Login = z.infer<typeof loginSchema>[number];
const failures: Record<string, string> = {
  LOGIN_TIMEOUT: '10분 안에 로그인을 마치지 못했습니다.',
  DEVICE_LOGIN_DISABLED:
    '이 계정은 코드로 로그인하는 방식이 막혀 있습니다. 브라우저 로그인으로 다시 시도하세요.',
  LOGIN_FAILED: '로그인을 확인하지 못했습니다.',
};
const service = { 'claude-cli': 'Claude', 'codex-cli': 'ChatGPT' } as const;

function remaining(expiresAt?: string) {
  if (!expiresAt) return '';
  const seconds = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function copy(text: string, done: (message: string) => void) {
  void navigator.clipboard
    .writeText(text)
    .then(() => done('복사했습니다.'))
    .catch(() => done('직접 선택해 복사하세요.'));
}

/** The steps to finish a login in a browser of the user's choice (address mode). */
function LoginPanel({
  login,
  provider,
  cancel,
  notify,
}: {
  login: Login;
  provider: Provider;
  cancel: () => void;
  notify: (message: string) => void;
}) {
  const [code, setCode] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const prompt = login.prompt;
  const stopping = login.state === 'stopping';
  if (login.operation === 'logout')
    return (
      <div className="login-panel" role="status">
        로그아웃하는 중…
      </div>
    );
  const address = prompt?.url ? (
    <span className="login-actions">
      <button type="button" onClick={() => copy(prompt.url!, notify)}>
        주소 복사
      </button>
      <a href={prompt.url} target="_blank" rel="noreferrer">
        기본 브라우저로 열기
      </a>
    </span>
  ) : (
    <small>주소를 준비하는 중…</small>
  );
  return (
    <div className="login-panel" aria-label={`${service[provider]} 로그인`}>
      <div className="login-head">
        <strong>
          {login.mode === 'browser'
            ? '기본 브라우저에서 로그인하세요'
            : '브라우저에서 로그인하세요'}
        </strong>
        <small>{stopping ? '멈추는 중…' : `남은 시간 ${remaining(login.expiresAt)}`}</small>
        <button type="button" className="link-button" disabled={stopping} onClick={cancel}>
          취소
        </button>
      </div>
      {login.mode === 'browser' ? (
        prompt?.url ? (
          <p>브라우저가 열리지 않았으면 {address}</p>
        ) : null
      ) : (
        <ol>
          <li>
            <span>로그인할 계정의 브라우저에 이 주소를 붙여 넣으세요.</span>
            {address}
          </li>
          {provider === 'codex-cli' ? (
            <li>
              <span>화면의 안내대로 이 코드를 입력하세요. 입력하면 자동으로 완료됩니다.</span>
              {prompt?.code ? (
                <span className="login-actions">
                  <code className="login-code">{prompt.code}</code>
                  <button type="button" onClick={() => copy(prompt.code!, notify)}>
                    코드 복사
                  </button>
                </span>
              ) : (
                <small>코드를 받는 중…</small>
              )}
            </li>
          ) : (
            <li>
              <span>승인하면 화면에 코드가 나옵니다. 그 코드를 붙여 넣으세요.</span>
              {prompt?.codeSent ? (
                <small role="status">코드를 확인하는 중…</small>
              ) : (
                <form
                  className="login-actions"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void api('/accounts/login/code', 'POST', { provider, code }).catch(
                      (error: unknown) =>
                        notify(
                          error instanceof Error ? error.message : '코드를 보내지 못했습니다.',
                        ),
                    );
                  }}
                >
                  <input
                    aria-label="승인 코드"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="승인 코드"
                    autoComplete="off"
                  />
                  <button type="submit" disabled={!code.trim()}>
                    확인
                  </button>
                </form>
              )}
            </li>
          )}
        </ol>
      )}
      {provider === 'claude-cli' && login.mode !== 'browser' ? (
        <small>
          인증 메일이 오면 메일의 버튼 대신 링크를 복사해, 이 주소를 연 브라우저에 붙여 넣으세요.
        </small>
      ) : null}
    </div>
  );
}

export function AccountSettings({
  provider,
  usage,
}: {
  provider: Provider;
  /** This service's accounts from the page's usage view (who is signed in, usage). */
  usage?: AccountUsage[];
}) {
  const [data, setData] = useState<z.infer<typeof schema>>();
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<Login>();
  // A failed login stays until dismissed or retried; success and cancel leave nothing behind.
  const [dismissed, setDismissed] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [newName, setNewName] = useState('');
  // Dragging a row onto another moves it there (the order is saved per service).
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const loggingIn = login?.state === 'running' || login?.state === 'stopping';
  const refresh = async () => setData(schema.parse(await api('/accounts')));
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = (text: string) => {
    setMessage(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setMessage(''), 5000);
  };
  // Who is signed in to each account (email · plan), from the page's usage view.
  const who: Record<string, { text: string; signedIn: boolean }> = Object.fromEntries(
    (usage ?? []).map((row) => [
      row.id,
      {
        signedIn: row.signedIn,
        text: row.signedIn ? [row.email, row.plan].filter(Boolean).join(' · ') : '로그인 필요',
      },
    ]),
  );
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = schema.parse(await api('/accounts'));
        if (alive) setData(value);
      } catch {
        if (alive) setMessage('계정 목록을 불러오지 못했습니다.');
      }
      if (alive) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  // The login or logout this screen is following, so its end is noticed even between polls.
  const watching = useRef<string>(undefined);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const statuses = loginSchema.parse(await api('/accounts/login'));
        if (alive) {
          const status = statuses.find((row) => row.provider === provider);
          setLogin(status);
          if (status && ['running', 'stopping'].includes(status.state))
            watching.current = status.id;
          const ended =
            status &&
            status.id === watching.current &&
            !['running', 'stopping'].includes(status.state);
          if (ended) {
            watching.current = undefined;
            window.dispatchEvent(new Event('accounts-changed'));
            if (status.state === 'succeeded')
              notify(status.operation === 'logout' ? '로그아웃했습니다.' : '로그인했습니다.');
          }
        }
      } catch {
        if (alive) setMessage('로그인 상태를 확인하지 못했습니다. 새로고침하세요.');
      }
      if (alive) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [provider]);
  const action = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await task();
      await refresh();
      window.dispatchEvent(new Event('accounts-changed'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '계정 작업 실패');
    } finally {
      setBusy(false);
    }
  };
  const startLogin = (id: string, operation: 'login' | 'logout', browser = false) =>
    void action(async () => {
      setDismissed(undefined);
      const result = await api(`/accounts/${operation}`, 'POST', {
        provider,
        id,
        ...(browser ? { browser: true } : {}),
      });
      const started = loginSchema.parse([result])[0];
      watching.current = started.id;
      setLogin(started);
    });
  const cancelLogin = () =>
    void action(async () => {
      const result = loginSchema.parse(await api('/accounts/login/cancel', 'POST', { provider }));
      setLogin(result.find((row) => row.provider === provider));
    });
  const order = data?.order?.[provider] ?? [];
  const place = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const rows = [
    { id: 'default', label: data?.defaultLabels?.[provider] ?? '기존 CLI 로그인' },
    ...(data?.profiles.filter((p) => p.provider === provider) ?? []),
  ]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => place(a.row.id) - place(b.row.id) || a.index - b.index)
    .map(({ row }) => row);
  const move = (id: string, target: string) => {
    if (id === target) return;
    const ids = rows.map((row) => row.id).filter((row) => row !== id);
    // Dropped on a row: take its place (above it when moving up, below when moving down).
    const from = rows.findIndex((row) => row.id === id);
    const to = rows.findIndex((row) => row.id === target);
    ids.splice(ids.indexOf(target) + (from < to ? 1 : 0), 0, id);
    setData((current) =>
      current ? { ...current, order: { ...current.order, [provider]: ids } } : current,
    );
    void api('/accounts/order', 'POST', { provider, ids })
      .then((value) => setData(schema.parse(value)))
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : '순서를 저장하지 못했습니다.'),
      );
  };
  const failed =
    login?.state === 'failed' && login.id !== dismissed && login.operation === 'login'
      ? login
      : undefined;
  return (
    <div className="account-settings">
      {rows.map((row) => {
        const active = data?.active[provider] === row.id;
        const signedIn = who[row.id]?.signedIn;
        const current = usage?.find((account) => account.id === row.id);
        const mine = login?.profileId === row.id;
        const menu = (task: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
          event.currentTarget.closest('details')?.removeAttribute('open');
          task();
        };
        return (
          <div
            key={row.id}
            className="account-block"
            draggable={rows.length > 1 && renaming !== row.id}
            data-dragging={String(dragging === row.id)}
            data-over={String(!!dragging && over === row.id && dragging !== row.id)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', row.id);
              setDragging(row.id);
            }}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              setOver(row.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging) move(dragging, row.id);
              setDragging(undefined);
              setOver(undefined);
            }}
            onDragEnd={() => {
              setDragging(undefined);
              setOver(undefined);
            }}
          >
            <div className="account-row" data-active={String(active)}>
              {renaming === row.id ? (
                <form
                  className="account-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(async () => {
                      await api('/accounts/rename', 'POST', {
                        provider,
                        id: row.id,
                        label: newName,
                      });
                      setRenaming(undefined);
                    });
                  }}
                >
                  <input
                    aria-label={`${row.label} 새 이름`}
                    value={newName}
                    maxLength={80}
                    autoFocus
                    placeholder={row.id === 'default' ? '비우면 기존 CLI 로그인' : '계정 이름'}
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenaming(undefined);
                    }}
                  />
                  <button
                    type="submit"
                    disabled={busy || (row.id !== 'default' && !newName.trim())}
                  >
                    저장
                  </button>
                  <button type="button" onClick={() => setRenaming(undefined)}>
                    취소
                  </button>
                </form>
              ) : (
                <span className="account-name">
                  {row.label}
                  {active ? <span className="account-badge">사용 중</span> : null}
                  {current?.limitReached ? (
                    <span className="account-badge" data-limit="true">
                      한도
                    </span>
                  ) : null}
                  {who[row.id] ? <small>{who[row.id].text}</small> : null}
                </span>
              )}
              {renaming !== row.id && (
                <span className="account-actions">
                  {row.id !== 'default' && !active && signedIn === false && !(mine && loggingIn) ? (
                    <button
                      className="primary-button"
                      disabled={busy || loggingIn}
                      onClick={() => startLogin(row.id, 'login')}
                    >
                      로그인
                    </button>
                  ) : null}
                  {!active ? (
                    <button
                      title="터미널·VS Code의 기본 로그인을 이 계정으로 바꿉니다"
                      disabled={busy || loggingIn}
                      onClick={() =>
                        void action(async () => {
                          await api('/accounts/select', 'POST', { provider, id: row.id });
                          notify(
                            provider === 'claude-cli'
                              ? navigator.userAgent.includes('Mac OS X')
                                ? '바꿨습니다. 켜져 있는 Claude Code도 30초쯤 뒤부터 이 계정을 씁니다.'
                                : '바꿨습니다. 켜져 있는 Claude Code도 다음 메시지부터 이 계정을 씁니다.'
                              : '바꿨습니다. 켜져 있는 Codex는 다시 시작하면 이 계정을 씁니다.',
                          );
                        })
                      }
                    >
                      사용
                    </button>
                  ) : null}
                  <details className="account-more">
                    <summary aria-label={`${row.label} 더보기`}>⋯</summary>
                    <div className="account-menu">
                      <button
                        onClick={menu(() => {
                          setRenaming(row.id);
                          setNewName(
                            row.id === 'default'
                              ? (data?.defaultLabels?.[provider] ?? '')
                              : row.label,
                          );
                        })}
                      >
                        이름 변경
                      </button>
                      {row.id !== 'default' && !active && (
                        <>
                          <button
                            disabled={busy || loggingIn}
                            onClick={menu(() => startLogin(row.id, 'login'))}
                          >
                            {signedIn ? '다시 로그인' : '로그인'}
                          </button>
                          <button
                            disabled={busy || loggingIn}
                            onClick={menu(() => startLogin(row.id, 'login', true))}
                          >
                            기본 브라우저로 로그인
                          </button>
                          <button
                            disabled={busy || loggingIn}
                            onClick={menu(
                              () =>
                                void action(async () => {
                                  const result = z.object({ command: z.string() }).parse(
                                    await api('/accounts/login-command', 'POST', {
                                      provider,
                                      id: row.id,
                                    }),
                                  );
                                  setCommand(result.command);
                                }),
                            )}
                          >
                            명령으로 로그인
                          </button>
                          <button
                            disabled={busy || loggingIn}
                            onClick={menu(() => startLogin(row.id, 'logout'))}
                          >
                            로그아웃
                          </button>
                          <button
                            className="danger"
                            disabled={busy || loggingIn}
                            onClick={menu(() => {
                              if (
                                !window.confirm(
                                  `${row.label} 계정을 목록에서 제거하고 이 프로필의 로컬 CLI 설정·이력을 삭제할까요? 먼저 로그아웃해야 합니다.`,
                                )
                              )
                                return;
                              void action(async () => {
                                await api('/accounts/remove', 'POST', {
                                  provider,
                                  id: row.id,
                                  deleteLocalData: true,
                                });
                                setCommand('');
                              });
                            })}
                          >
                            제거
                          </button>
                        </>
                      )}
                    </div>
                  </details>
                </span>
              )}
            </div>
            <AccountUsageLines account={current} />
            {mine && loggingIn && login ? (
              <LoginPanel login={login} provider={provider} cancel={cancelLogin} notify={notify} />
            ) : null}
            {mine && failed ? (
              <div className="login-failed" role="alert">
                <span>{failures[failed.reason ?? ''] ?? failures.LOGIN_FAILED}</span>
                <button onClick={() => startLogin(row.id, 'login')}>다시 시도</button>
                {failed.reason === 'DEVICE_LOGIN_DISABLED' ? (
                  <button onClick={() => startLogin(row.id, 'login', true)}>
                    기본 브라우저로 로그인
                  </button>
                ) : null}
                <button
                  className="link-button"
                  aria-label="알림 닫기"
                  onClick={() => setDismissed(failed.id)}
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="account-add">
        <input
          aria-label={`${provider} 계정 이름`}
          value={label}
          maxLength={80}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`새 계정 이름 (예: 회사 ${provider === 'codex-cli' ? 'ChatGPT' : 'Claude'})`}
        />
        <button
          disabled={busy || !label.trim()}
          onClick={() =>
            void action(async () => {
              await api('/accounts', 'POST', { provider, label });
              setLabel('');
            })
          }
        >
          계정 추가
        </button>
      </div>
      {command && (
        <div className="login-command">
          <p>
            {navigator.userAgent.includes('Mac OS X') ? '터미널' : '새 PowerShell 창'}에서 실행한 뒤
            이 계정을 사용하세요.
          </p>
          <textarea aria-label="공식 CLI 로그인 명령" readOnly value={command} />
          <span className="login-actions">
            <button onClick={() => copy(command, notify)}>명령 복사</button>
            <button className="link-button" onClick={() => setCommand('')}>
              명령 닫기
            </button>
          </span>
        </div>
      )}
      {message ? (
        <p role="status" className="account-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
