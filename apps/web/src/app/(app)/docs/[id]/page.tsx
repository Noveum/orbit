import { can } from '@orbit/shared/policy';
import { idSchema } from '@orbit/shared/validators';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocSurface } from '@/features/docs/doc-surface.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { dehydratedDoc } from '@/lib/query/docs-prefetch.ts';

export const metadata: Metadata = { title: 'Docs' };

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ principal }, raw] = await Promise.all([pageContext(), params]);
  const parsed = idSchema.safeParse(raw.id);
  if (!parsed.success) notFound();
  const id = parsed.data;

  return (
    <HydrationBoundary state={await dehydratedDoc(principal, id)}>
      <DocSurface
        docId={id}
        canWrite={can(principal, 'doc:write')}
        canPublish={can(principal, 'doc:publish')}
      />
    </HydrationBoundary>
  );
}
