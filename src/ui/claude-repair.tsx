import { useEffect, useRef, useState } from 'react';
import { api } from './gateway.ts';
import {
  REPAIR_FAILED,
  REPAIR_REQUEST,
  repairOutcome,
  startFailure,
  STUCK_NOTICE,
} from './claude-repair-logic.ts';
import { parseRun } from './setup-logic.ts';

// SPEC 3.10, DESIGN 5.3: above the Claude accounts while a stopped update left no claude.exe.
// Nothing runs until 고치기 is pressed.

const POLL_MS = 1000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ClaudeRepairNotice({ onFixed }: { onFixed: () => void }) {
  const [fixing, setFixing] = useState(false);
  const [failure, setFailure] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fix = async () => {
    setFixing(true);
    setFailure('');
    try {
      await api('/setup/run', 'POST', REPAIR_REQUEST);
    } catch (error) {
      setFixing(false);
      setFailure(startFailure(error));
      return;
    }
    let outcome: ReturnType<typeof repairOutcome> = 'running';
    while (outcome === 'running' && mounted.current) {
      await pause(POLL_MS);
      try {
        outcome = repairOutcome(parseRun(await api('/setup/run')));
      } catch {
        outcome = 'failed';
      }
    }
    if (!mounted.current) return;
    setFixing(false);
    if (outcome === 'done') onFixed();
    else setFailure(REPAIR_FAILED);
  };

  return (
    <div className="service-notice" role="status">
      <div className="service-notice-text">
        <p>{STUCK_NOTICE}</p>
        {failure ? (
          <p className="service-notice-failure" role="alert">
            {failure}
          </p>
        ) : null}
      </div>
      <button type="button" disabled={fixing} onClick={() => void fix()}>
        {fixing ? '고치는 중…' : '고치기'}
      </button>
    </div>
  );
}
