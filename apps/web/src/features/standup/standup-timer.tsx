'use client';

import { useEffect, useState } from 'react';
import { formatElapsed } from './standup-clock.ts';

const TICK_MS = 1000;

export interface StandupTimerProps {
  readonly startedAt: number;
}

export function StandupTimer({ startedAt }: StandupTimerProps) {
  const [personStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  return (
    <span className="flex items-baseline gap-2" data-testid="standup-timer">
      <span data-numeric className="text-dense text-text" data-testid="standup-timer-person">
        {formatElapsed(now - personStartedAt)}
      </span>
      <span data-numeric className="text-2xs text-faint" data-testid="standup-timer-total">
        {formatElapsed(now - startedAt)} total
      </span>
    </span>
  );
}
