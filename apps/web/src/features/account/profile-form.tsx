'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { ApiRequestError, apiRequest, messageOf } from '@/lib/api/client.ts';

export interface ProfileFormProps {
  readonly name: string;
  readonly handle: string;
  readonly image: string | null;
  readonly timezone: string;
}

export function ProfileForm({ name, handle, image, timezone }: ProfileFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(name);
  const [userHandle, setUserHandle] = useState(handle);
  const [avatarUrl, setAvatarUrl] = useState(image ?? '');
  const [zone, setZone] = useState(timezone);
  const [pending, setPending] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setHandleError(null);
    setFormError(null);
    try {
      await apiRequest('/api/account/profile', {
        method: 'PATCH',
        body: {
          name: displayName,
          handle: userHandle,
          image: avatarUrl.trim().length === 0 ? null : avatarUrl.trim(),
          timezone: zone,
        },
      });
      toast({ title: 'Profile updated', tone: 'success' });
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.is('conflict'))
        setHandleError(caught.message);
      else setFormError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="profile-form">
      <div className="flex items-center gap-3">
        <Avatar
          name={displayName}
          src={avatarUrl.trim().length === 0 ? null : avatarUrl}
          size="lg"
        />
        <div className="min-w-0">
          <p className="truncate font-medium text-dense text-text">{displayName}</p>
          <p className="truncate text-2xs text-faint">@{userHandle}</p>
        </div>
      </div>

      <fieldset disabled={pending} className="flex flex-col gap-5">
        <label htmlFor="profile-name" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Display name</span>
          <Input
            id="profile-name"
            name="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            minLength={1}
            maxLength={64}
          />
        </label>

        <label htmlFor="profile-handle" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Handle</span>
          <Input
            id="profile-handle"
            name="handle"
            value={userHandle}
            onChange={(event) => setUserHandle(event.target.value)}
            required
            minLength={2}
            maxLength={39}
            aria-invalid={handleError !== null}
            aria-describedby={handleError === null ? undefined : 'profile-handle-error'}
          />
          <span className="text-faint text-xs">
            Teammates mention you with @{userHandle.length === 0 ? 'handle' : userHandle}. It has to
            be unique.
          </span>
          {handleError === null ? null : (
            <span id="profile-handle-error" role="alert" className="text-danger text-xs">
              {handleError}
            </span>
          )}
        </label>

        <label htmlFor="profile-image" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Avatar URL</span>
          <Input
            id="profile-image"
            name="image"
            type="url"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder="https://example.com/avatar.png"
          />
        </label>

        <label htmlFor="profile-timezone" className="flex flex-col gap-1.5">
          <span className="font-medium text-dense text-text">Timezone</span>
          <Input
            id="profile-timezone"
            name="timezone"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            required
            maxLength={64}
            placeholder="Asia/Kolkata"
            list="profile-timezone-options"
          />
          <datalist id="profile-timezone-options">
            {Intl.supportedValuesOf('timeZone').map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <span className="text-faint text-xs">
            Due dates and digests follow this zone. Yours looks like{' '}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}.
          </span>
        </label>
      </fieldset>

      {formError === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {formError}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
