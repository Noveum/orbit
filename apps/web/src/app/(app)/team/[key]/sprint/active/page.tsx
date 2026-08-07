import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CyclePanel } from '@/features/cycles/cycle-board.tsx';
import { getActiveCycleView, listUpcomingCycleViews } from '@/features/cycles/data.ts';
import { pageContext } from '@/lib/api/handler.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

interface PageProps {
  readonly params: Promise<{ key: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { key } = await params;
  return { title: `${key.toUpperCase()} active sprint` };
}

export default async function ActiveSprintPage({ params }: PageProps) {
  const { key } = await params;
  const { principal } = await pageContext();
  const teams = await listTeamsForPrincipal(principal);
  const team = teams.find((entry) => entry.key.toLowerCase() === key.toLowerCase());
  if (team === undefined) notFound();

  const [cycle, upcoming] = await Promise.all([
    getActiveCycleView(principal, team),
    listUpcomingCycleViews(principal, team),
  ]);

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">{team.name} sprint</h1>
        <p className="text-muted text-xs">Scope, pace, and who is carrying what this sprint.</p>
      </header>
      <CyclePanel
        cycle={cycle}
        upcoming={upcoming}
        team={team}
        canManage={can(principal, 'cycle:manage')}
        runningSprintId={cycle?.id ?? null}
      />
    </div>
  );
}
