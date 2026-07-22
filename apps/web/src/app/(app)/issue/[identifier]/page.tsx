import type { Metadata } from 'next';
import { IssueDetailView } from '@/features/issues/issue-detail.tsx';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ identifier: string }>;
}): Promise<Metadata> {
  const { identifier } = await params;
  return { title: identifier.toUpperCase() };
}

export default async function IssuePage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <IssueDetailView identifier={identifier.toUpperCase()} />;
}
