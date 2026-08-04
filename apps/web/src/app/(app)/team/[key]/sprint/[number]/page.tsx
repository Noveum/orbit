import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CyclePanel } from '@/features/cycles/cycle-board.tsx';
import { getSprintView } from '@/features/cycles/data.ts';
import { pageContext } from '@/lib/api/handler.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

interface PageProps {
  readonly params: Promise<{ key: string; number: string }>;
}

function sprintNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { key, number } = await params;
  return { title: `${key.toUpperCase()} sprint ${number}` };
}

export default async function SprintPage({ params }: PageProps) {
  const { key, number } = await params;
  const wanted = sprintNumber(number);
  if (wanted === null) notFound();

  const { principal } = await pageContext();
  const teams = await listTeamsForPrincipal(principal);
  const team = teams.find((entry) => entry.key.toLowerCase() === key.toLowerCase());
  if (team === undefined) notFound();

  const sprint = await getSprintView(principal, team, wanted);
  if (sprint === null) notFound();

  const outcome = sprint.outcome;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">
          {team.name} {sprint.name}
        </h1>
        {outcome === null ? (
          <p className="text-muted text-xs">Scope, pace, and who is carrying what.</p>
        ) : (
          <p className="text-muted text-xs tabular-nums" data-testid="sprint-outcome">
            Closed with {outcome.completed} of {outcome.scope} done
            {outcome.rolledOver > 0 ? `, ${outcome.rolledOver} rolled into the next sprint` : ''}.
          </p>
        )}
      </header>
      <CyclePanel cycle={sprint} upcoming={[]} teamName={team.name} />
    </div>
  );
}
