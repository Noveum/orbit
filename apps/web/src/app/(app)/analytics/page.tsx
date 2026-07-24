import type { Measure } from '@orbit/core';
import { assertCan, can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import {
  BreakdownCardSkeleton,
  CycleSectionSkeleton,
  DistributionGridSkeleton,
  SavedViewBarSkeleton,
  ScopeCardSkeleton,
} from '@/features/analytics/analytics-skeleton.tsx';
import { BreakdownSection } from '@/features/analytics/breakdown-section.tsx';
import { CycleSection } from '@/features/analytics/cycle-section.tsx';
import { DistributionSection } from '@/features/analytics/distribution-section.tsx';
import { MeasureToggle } from '@/features/analytics/measure-toggle.tsx';
import { SavedViewSection } from '@/features/analytics/saved-view-section.tsx';
import { ScopeSection } from '@/features/analytics/scope-section.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Analytics' };

interface PageProps {
  readonly searchParams: Promise<{ measure?: string }>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const { measure: rawMeasure } = await searchParams;
  const measure: Measure = rawMeasure === 'points' ? 'points' : 'issues';
  const { principal } = await pageContext();
  assertCan(principal, 'project:read');
  const canManage = can(principal, 'view:manage');

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h1 className="font-semibold text-lg text-text">Analytics</h1>
            <p className="text-muted text-xs">
              Scope, throughput, churn and distributions across the workspace.
            </p>
          </div>
          <MeasureToggle measure={measure} />
        </div>
        <Suspense fallback={<SavedViewBarSkeleton />}>
          <SavedViewSection principal={principal} measure={measure} canManage={canManage} />
        </Suspense>
      </header>

      <Suspense fallback={<ScopeCardSkeleton />}>
        <ScopeSection principal={principal} measure={measure} />
      </Suspense>

      <Suspense fallback={<DistributionGridSkeleton />}>
        <DistributionSection principal={principal} measure={measure} />
      </Suspense>

      <Suspense fallback={<BreakdownCardSkeleton />}>
        <BreakdownSection principal={principal} measure={measure} />
      </Suspense>

      <Suspense fallback={<CycleSectionSkeleton />}>
        <CycleSection principal={principal} measure={measure} canManage={canManage} />
      </Suspense>
    </div>
  );
}
