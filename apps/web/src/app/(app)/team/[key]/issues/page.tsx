import type { Metadata } from 'next';
import { TeamView } from '@/features/issues/team-view.tsx';

export const metadata: Metadata = { title: 'Issues' };

export default async function TeamIssuesPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <TeamView teamKey={key} layout="list" />;
}
