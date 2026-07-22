import type { Metadata } from 'next';
import { TeamView } from '@/features/issues/team-view.tsx';

export const metadata: Metadata = { title: 'Board' };

export default async function TeamBoardPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <TeamView teamKey={key} layout="board" />;
}
