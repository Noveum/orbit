import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { runningSprintNumber } from '@/features/sprints/data.ts';
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

  const number = await runningSprintNumber(principal, team);
  if (number === null) redirect('/sprints');
  redirect(`/team/${key.toLowerCase()}/sprint/${number}`);
}
