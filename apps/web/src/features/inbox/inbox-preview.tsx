'use client';

import { DocBody } from '@/features/docs/doc-body.tsx';
import { PriorityGlyph, priorityLabel } from '@/features/issues/priority-glyph.tsx';
import { StateGlyph } from '@/features/issues/state-glyph.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { useIssueDetail } from '@/lib/query/use-issues.ts';

const ISSUE_PATH = /^\/issue\/([a-z][a-z0-9]{1,5}-\d+)(?:[/?#]|$)/i;

export function issueIdentifierFromUrl(url: string): string | null {
  const identifier = ISSUE_PATH.exec(url)?.[1];
  return identifier === undefined ? null : identifier.toUpperCase();
}

export interface InboxIssuePreviewProps {
  readonly identifier: string;
  readonly body: string;
}

export function InboxIssuePreview({ identifier, body }: InboxIssuePreviewProps) {
  const workspace = useWorkspace();
  const detail = useIssueDetail(identifier);
  const loaded = detail.data;

  if (loaded === undefined) {
    return (
      <p className="text-faint text-xs" data-testid="inbox-preview-loading">
        {detail.isError ? 'That issue is no longer available.' : 'Loading the issue.'}
      </p>
    );
  }

  const { issue, descriptionHtml } = loaded;
  const state = workspace.stateById.get(issue.stateId);
  const assignee =
    issue.assigneeId === null ? undefined : workspace.memberById.get(issue.assigneeId);

  return (
    <article className="flex min-w-0 flex-col gap-3" data-testid="inbox-preview">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xs text-muted">
        <span className="font-mono text-faint">{issue.identifier}</span>
        {state === undefined ? null : (
          <span className="flex items-center gap-1.5">
            <StateGlyph category={state.category} color={state.color} />
            {state.name}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <PriorityGlyph priority={issue.priority} />
          {priorityLabel(issue.priority)}
        </span>
        <span>{assignee === undefined ? 'Unassigned' : assignee.name}</span>
      </div>

      <h3 className="font-medium text-base text-text leading-snug">{issue.title}</h3>

      {body.length === 0 || body === issue.title ? null : (
        <p className="whitespace-pre-wrap text-muted text-sm" data-testid="inbox-preview-body">
          {body}
        </p>
      )}

      {descriptionHtml.length === 0 ? (
        <p className="text-faint text-xs">No description on this issue.</p>
      ) : (
        <DocBody html={descriptionHtml} className="text-dense" />
      )}
    </article>
  );
}
