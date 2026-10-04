import { issueUrl } from '@orbit/shared/utils';
import type { Metadata } from 'next';
import { IssueDetailView } from '@/features/issues/issue-detail.tsx';
import { pageMetadata } from '@/lib/page-metadata.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ identifier: string }>;
}): Promise<Metadata> {
  const identifier = (await params).identifier.toUpperCase();
  return pageMetadata(identifier, issueUrl(identifier));
}

export default async function IssuePage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <IssueDetailView identifier={identifier.toUpperCase()} />;
}
