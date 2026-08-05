import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findProjectDetail } from '@/features/projects/data.ts';
import { ProjectIssues } from '@/features/projects/project-issues.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Issues' };

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

export default async function ProjectIssuesPage({ params }: PageProps) {
  const { slug } = await params;
  const { principal } = await pageContext();
  const detail = await findProjectDetail(principal, slug);
  if (detail === null) notFound();

  return <ProjectIssues projectId={detail.summary.id} projectName={detail.summary.name} />;
}
