'use client';

import { slugify } from '@orbit/shared/utils';
import { organizationCreateSchema } from '@orbit/shared/validators';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';

interface CreatedWorkspace {
  readonly organization: { readonly id: string; readonly slug: string };
  readonly team: { readonly key: string };
}

export function CreateWorkspaceForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugEdited ? slug : slugify(name);
  const parsed = organizationCreateSchema.safeParse({ name, slug: effectiveSlug });
  const ready = parsed.success;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!parsed.success) {
      setError('Give the workspace a name and a valid address.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await apiRequest<CreatedWorkspace>('/api/organizations', {
        method: 'POST',
        body: parsed.data,
      });
      const activated = await authClient.organization.setActive({
        organizationId: created.organization.id,
      });
      if (activated.error) {
        throw new Error(activated.error.message ?? 'Could not switch to the new workspace.');
      }
      toast({ title: `${parsed.data.name} is ready`, tone: 'success' });
      router.push(`/team/${created.team.key.toLowerCase()}/board`);
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="create-workspace-form">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="workspace-name" className="font-medium text-dense text-text">
          Workspace name
        </label>
        <Input
          id="workspace-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
          maxLength={64}
          placeholder="Noveum Labs"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="workspace-slug" className="font-medium text-dense text-text">
          Workspace address
        </label>
        <Input
          id="workspace-slug"
          name="slug"
          value={effectiveSlug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
          required
          minLength={2}
          maxLength={64}
          placeholder="noveum-labs"
          autoComplete="off"
          aria-describedby="workspace-slug-hint"
        />
        <span id="workspace-slug-hint" className="text-faint text-xs">
          Lowercase letters, numbers and dashes. Suggested from the name, edit it if you like.
        </span>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending || !ready}>
          {pending ? 'Creating' : 'Create workspace'}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
