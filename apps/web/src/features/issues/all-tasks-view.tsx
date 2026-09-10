'use client';

import {
  PRIORITY_LABELS,
  type Priority,
  STATE_CATEGORIES,
  STATE_CATEGORY_LABELS,
} from '@orbit/shared/constants';
import { UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import { type WorkspaceTask, workspaceTasksPageSchema } from '@orbit/shared/validators';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { apiFetch, messageOf } from '@/lib/query/fetcher.ts';
import { useWorkspace } from './workspace-provider.tsx';

export function AllTasksView({ organizationId }: { readonly organizationId: string }) {
  const workspace = useWorkspace();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [status, setStatus] = useState('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const params = new URLSearchParams({
    limit: '50',
    query,
    includeArchived: String(includeArchived),
  });
  if (assignee !== 'all') params.set('assigneeId', assignee);
  if (status !== 'all') params.set('stateCategory', status);
  const filter = params.toString();
  const result = useInfiniteQuery({
    queryKey: ['workspace-tasks', organizationId, workspace.userId, filter],
    queryFn: async ({ pageParam, signal }) => {
      const page = new URLSearchParams(filter);
      if (pageParam !== null) page.set('cursor', pageParam);
      return await apiFetch(`/api/workspace-tasks?${page}`, workspaceTasksPageSchema, { signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: workspace.ready,
    refetchInterval: 30_000,
  });
  const tasks = result.data?.pages.flatMap((page) => page.tasks) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-border border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-medium text-dense text-text">All tasks</h1>
          <p className="mt-1 text-muted text-xs">
            Tasks across every team and project in this workspace.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={result.isFetching}
          onClick={async () => await result.refetch()}
        >
          Refresh
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-border border-b px-4 py-3">
        <form
          className="flex min-w-52 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
          }}
        >
          <Input
            aria-label="Search tasks"
            placeholder="Search tasks..."
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger aria-label="Filter by assignee" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            <SelectItem value={UNSET_FILTER_VALUE}>Unassigned</SelectItem>
            {workspace.members.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATE_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {STATE_CATEGORY_LABELS[category]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label
          htmlFor="all-tasks-include-archived"
          className="flex items-center gap-2 text-muted text-xs"
        >
          <Checkbox
            id="all-tasks-include-archived"
            checked={includeArchived}
            onCheckedChange={(checked) => setIncludeArchived(checked === true)}
          />
          Include archived
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4">
        {result.isPending ? (
          <p role="status" className="py-12 text-center text-muted text-sm">
            Loading tasks...
          </p>
        ) : null}
        {result.isError ? (
          <div role="alert" className="py-6 text-center text-sm">
            <p className="text-danger">{messageOf(result.error, 'Tasks could not load.')}</p>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={async () => await result.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {!(result.isPending || result.isError) && tasks.length === 0 ? (
          <p role="status" className="py-12 text-center text-muted text-sm">
            No matching tasks.
          </p>
        ) : null}
        {tasks.length > 0 ? <TaskTable tasks={tasks} /> : null}
        {result.hasNextPage ? (
          <div className="flex justify-center py-4">
            <Button
              variant="secondary"
              disabled={result.isFetchingNextPage}
              onClick={async () => await result.fetchNextPage()}
            >
              {result.isFetchingNextPage ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="border-border border-t px-4 py-2 text-faint text-xs">
        {tasks.length} tasks loaded. Read-only overview. Open task details for teams you belong to.
      </div>
    </div>
  );
}

function TaskTable({ tasks }: { readonly tasks: readonly WorkspaceTask[] }) {
  return (
    <table aria-label="All tasks" className="w-full min-w-3xl text-left text-xs">
      <thead className="sticky top-0 bg-surface text-faint">
        <tr className="border-border border-b">
          {['Task', 'Team', 'Status', 'Assignee', 'Project', 'Priority'].map((heading) => (
            <th key={heading} scope="col" className="px-2 py-3 font-medium">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id} className="border-border border-b last:border-b-0">
            <td className="px-2 py-3">
              {task.canOpen ? (
                <Link
                  href={`/issue/${task.identifier}`}
                  className="rounded-sm text-text hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="mr-2 text-faint">{task.identifier}</span>
                  {task.title}
                </Link>
              ) : (
                <span className="text-text">
                  <span className="mr-2 text-faint">{task.identifier}</span>
                  {task.title}
                </span>
              )}
            </td>
            <td className="px-2 py-3 text-muted">{task.team}</td>
            <td className="px-2 py-3 text-muted">{task.state}</td>
            <td className="px-2 py-3 text-muted">{task.assignee ?? 'Unassigned'}</td>
            <td className="px-2 py-3 text-muted">{task.project ?? 'No project'}</td>
            <td className="px-2 py-3 text-muted">
              {PRIORITY_LABELS[task.priority as Priority] ?? 'None'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
