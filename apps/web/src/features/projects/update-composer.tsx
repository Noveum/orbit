'use client';

import { PROJECT_HEALTHS, type ProjectHealth } from '@orbit/shared/constants';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { RichTextEditor } from '@/features/docs/editor/rich-text-editor.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { healthLabel } from './health-chip.tsx';

export interface UpdateComposerProps {
  readonly projectId: string;
  readonly currentHealth: ProjectHealth;
  readonly canPost: boolean;
}

export function UpdateComposer({ projectId, currentHealth, canPost }: UpdateComposerProps) {
  const router = useRouter();
  const [health, setHealth] = useState<ProjectHealth>(currentHealth);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/projects/${projectId}/updates`, {
        method: 'POST',
        body: { health, body },
      });
      setBody('');
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
      <div className="rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-border-strong">
        <RichTextEditor
          value={body}
          onChange={setBody}
          placeholder="What moved this week?"
          ariaLabel="Project update"
          testId="project-update-body"
          toolbar="compact"
          editable={canPost && !pending}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={health}
          onValueChange={(next) => setHealth(next as ProjectHealth)}
          disabled={!canPost || pending}
        >
          <SelectTrigger className="h-7 w-36 text-xs" aria-label="Project health">
            <SelectValue>{healthLabel(health)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PROJECT_HEALTHS.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {healthLabel(entry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={!canPost || pending || body.trim().length === 0}
        >
          {pending ? 'Posting' : 'Post update'}
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </form>
  );
}
