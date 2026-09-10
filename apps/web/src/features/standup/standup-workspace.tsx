'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { LoadFailed } from '@/features/issues/load-failed.tsx';
import { useWorkspace, WorkspaceDataProvider } from '@/features/issues/workspace-provider.tsx';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { projectSchema, workflowStateSchema } from '@/lib/query/schemas.ts';
import { useBootstrap } from '@/lib/query/use-issues.ts';
import { StandupBoard } from './standup-board.tsx';

const metadataSchema = z.object({
  states: z.array(workflowStateSchema),
  projects: z.array(projectSchema),
});

export function StandupWorkspace() {
  const workspace = useWorkspace();
  const bootstrap = useBootstrap(null);
  const metadata = useQuery({
    queryKey: ['standup-metadata', bootstrap.data?.organizationId, workspace.userId],
    enabled: workspace.ready,
    queryFn: async ({ signal }) =>
      await apiFetch('/api/standup/metadata', metadataSchema, { signal }),
    refetchInterval: 30_000,
  });
  const value = useMemo(
    () => ({
      ...workspace,
      states: metadata.data?.states ?? workspace.states,
      stateById: new Map(
        (metadata.data?.states ?? workspace.states).map((state) => [state.id, state]),
      ),
      projects: metadata.data?.projects ?? workspace.projects,
    }),
    [workspace, metadata.data],
  );
  if (metadata.isError)
    return (
      <LoadFailed
        subject="the standup board"
        testId="retry-standup"
        onRetry={() => {
          metadata.refetch().catch(() => undefined);
        }}
      />
    );
  if (metadata.isPending) return <Skeleton className="m-4 h-24" />;
  return (
    <WorkspaceDataProvider value={value}>
      <StandupBoard />
    </WorkspaceDataProvider>
  );
}
