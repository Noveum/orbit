'use client';

import { useEffect, useState } from 'react';
import { formatElapsed } from './standup-clock.ts';

const TICK_MS = 1000;

export interface StandupTimerProps {
  readonly startedAt: number;
}

export function StandupTimer({ startedAt }: StandupTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  return (
    <span data-numeric className="text-dense text-text" data-testid="standup-timer">
      {formatElapsed(now - startedAt)}
    </span>
  );
}
