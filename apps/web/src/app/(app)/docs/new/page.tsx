import type { Metadata } from 'next';
import { NewDoc } from '@/features/docs/new-doc.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'New doc' };

export default async function NewDocPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string; project?: string }>;
}) {
  await pageContext();
  const query = await searchParams;
  return <NewDoc collectionId={query.collection ?? null} projectId={query.project ?? null} />;
}
