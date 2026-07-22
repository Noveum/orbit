import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';

export default async function WorkspacePlaceholderPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const section = slug.join(' / ');

  return (
    <div className="flex min-h-full flex-col">
      <EmptyState
        icon={<Inbox strokeWidth={1.75} aria-hidden="true" />}
        title="Nothing here yet"
        description={`The ${section} view is wired up to the shell. Issue views land next.`}
        action={
          <Button variant="secondary" size="sm">
            Create issue
          </Button>
        }
        className="flex-1"
      />
    </div>
  );
}
