'use client';

import type { WebVitalInput } from '@orbit/shared/validators';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { INP_DURATION_THRESHOLD, queueLimit, sendReport, toReport } from './report.ts';

export function WebVitalsReporter() {
  const pathname = usePathname();
  const here = useRef(pathname);
  here.current = pathname;

  useEffect(() => {
    let queued: WebVitalInput[] = [];
    let stopped = false;

    const flush = (): void => {
      if (queued.length === 0) return;
      sendReport(queued);
      queued = [];
    };

    const collect = (metric: Parameters<typeof toReport>[0]): void => {
      if (stopped) return;
      const report = toReport(metric, here.current);
      if (report === null) return;
      queued.push(report);
      if (queued.length >= queueLimit()) flush();
    };

    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    const started = import('web-vitals/attribution')
      .then(({ onCLS, onINP, onLCP, onTTFB }) => {
        if (stopped) return;
        const softNavs = { reportSoftNavs: true } as const;
        onCLS(collect, softNavs);
        onINP(collect, { ...softNavs, durationThreshold: INP_DURATION_THRESHOLD });
        onLCP(collect, softNavs);
        onTTFB(collect, softNavs);
        document.addEventListener('visibilitychange', onHidden);
      })
      .catch(() => undefined);

    return () => {
      stopped = true;
      started
        .then(() => {
          document.removeEventListener('visibilitychange', onHidden);
          flush();
        })
        .catch(() => undefined);
    };
  }, []);

  return null;
}
