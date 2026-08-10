'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import {
  ISSUE_RELATION_TYPES,
  type IssueRelationType,
  RELATION_LABELS,
} from '@orbit/shared/constants';
import { scopes } from '@orbit/shared/events';
import { Link2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/cn.ts';
import { revealOnHover, rowHover } from '@/lib/interaction.ts';
import type { Issue, IssueRelation } from '@/lib/query/schemas.ts';
import { useIssueRelations, useRemoveRelation, useSetRelation } from '@/lib/query/use-relations.ts';
import { IssuePicker } from './issue-picker.tsx';

export { RELATION_LABELS };

const LAST_TYPE_FILLS_ITS_ROW = ISSUE_RELATION_TYPES.length % 2 === 1;

export function groupRelations(
  relations: readonly IssueRelation[],
): { type: IssueRelationType; entries: readonly IssueRelation[] }[] {
  return ISSUE_RELATION_TYPES.map((type) => ({
    type,
    entries: relations.filter((entry) => entry.type === type),
  })).filter((group) => group.entries.length > 0);
}

export interface IssueRelationsProps {
  readonly issue: Issue;
}

export function IssueRelations({ issue }: IssueRelationsProps) {
  const relations = useIssueRelations(issue.id);
  const link = useSetRelation(issue.id);
  const unlink = useRemoveRelation(issue.id);
  const [picking, setPicking] = useState(false);
  const [linkType, setLinkType] = useState<IssueRelationType>('blocks');

  const refetch = relations.refetch;
  useScopeSubscription([scopes.issue(issue.id)]);
  useDeltaHandler(
    useCallback(
      (actions) => {
        if (!actions.some((action) => action.model === 'issue_relation')) return;
        refetch().catch(() => undefined);
      },
      [refetch],
    ),
  );

  const groups = groupRelations(relations.data ?? []);
  const linkedIds = (relations.data ?? []).map((entry) => entry.issue.id);

  return (
    <section className="flex flex-col gap-1" data-testid="issue-relations">
      <div className="flex items-center gap-2">
        <h2 className="text-2xs text-faint uppercase tracking-wide">Links</h2>
        <div className="ml-auto">
          <IssuePicker
            open={picking}
            onOpenChange={setPicking}
            excludedIds={[issue.id, ...linkedIds]}
            testId="relation-picker"
            placeholder="Search for an issue to link"
            onPick={(picked) => link.mutate({ relatedIssueId: picked.id, type: linkType })}
            header={
              <fieldset className="grid grid-cols-2 gap-1">
                <legend className="sr-only">Link type</legend>
                {ISSUE_RELATION_TYPES.map((type, index) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={type === linkType ? 'primary' : 'ghost'}
                    aria-pressed={type === linkType}
                    data-testid={`relation-type-${type}`}
                    onClick={() => setLinkType(type)}
                    className={cn(
                      LAST_TYPE_FILLS_ITS_ROW &&
                        index === ISSUE_RELATION_TYPES.length - 1 &&
                        'col-span-2',
                    )}
                  >
                    {RELATION_LABELS[type]}
                  </Button>
                ))}
              </fieldset>
            }
          >
            <Button size="sm" variant="ghost" data-testid="add-relation">
              <Link2 className="size-3.5" aria-hidden="true" />
              Link issue
            </Button>
          </IssuePicker>
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.type} className="flex flex-col gap-0.5">
          <span className="px-0.5 text-2xs text-muted">{RELATION_LABELS[group.type]}</span>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {group.entries.map((entry) => (
              <li key={entry.id} className="group flex items-center">
                <Link
                  href={`/issue/${entry.issue.identifier}`}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-dense',
                    rowHover,
                  )}
                >
                  <span data-numeric className="text-2xs text-faint">
                    {entry.issue.identifier}
                  </span>
                  <span className="truncate text-text">{entry.issue.title}</span>
                </Link>
                <button
                  type="button"
                  aria-label={`Unlink ${entry.issue.identifier}`}
                  data-testid={`unlink-${entry.issue.identifier}`}
                  onClick={() =>
                    unlink.mutate({ relatedIssueId: entry.issue.id, type: entry.type })
                  }
                  className={cn(
                    'mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-text',
                    revealOnHover,
                  )}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
