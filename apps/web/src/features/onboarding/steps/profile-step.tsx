'use client';

import { type FormEvent, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { advanceStep } from '../api.ts';
import type { OnboardingStatusView } from '../types.ts';

export interface ProfileStepProps {
  readonly name: string;
  readonly handle: string;
  readonly image: string | null;
  readonly onNext: (status: OnboardingStatusView) => void;
}

export function ProfileStep({ name, handle, image, onNext }: ProfileStepProps) {
  const [displayName, setDisplayName] = useState(name);
  const [avatarUrl, setAvatarUrl] = useState(image ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedAvatar = avatarUrl.trim();
  const ready = displayName.trim().length > 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!ready) {
      setError('Add a name so your teammates recognise you.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiRequest('/api/account/profile', {
        method: 'PATCH',
        body: {
          name: displayName.trim(),
          image: trimmedAvatar.length === 0 ? null : trimmedAvatar,
        },
      });
      const status = await advanceStep({ step: 'profile' });
      onNext(status);
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" data-testid="onboarding-profile">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-text text-xl">Set up your profile</h1>
        <p className="text-muted text-dense">This is how you show up across the workspace.</p>
      </header>

      <div className="flex items-center gap-3">
        <Avatar
          name={displayName}
          src={trimmedAvatar.length === 0 ? null : trimmedAvatar}
          size="lg"
        />
        <div className="min-w-0">
          <p className="truncate font-medium text-dense text-text">
            {displayName.trim().length === 0 ? 'Your name' : displayName}
          </p>
          <p className="truncate text-2xs text-faint">@{handle}</p>
        </div>
      </div>

      <fieldset disabled={pending} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="onboarding-name" className="font-medium text-dense text-text">
            Display name
          </label>
          <Input
            id="onboarding-name"
            name="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            minLength={1}
            maxLength={64}
            autoComplete="name"
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="onboarding-image" className="font-medium text-dense text-text">
            Avatar URL
            <span className="ml-1.5 font-normal text-faint text-xs">optional</span>
          </label>
          <Input
            id="onboarding-image"
            name="image"
            type="url"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder="https://example.com/avatar.png"
          />
        </div>
      </fieldset>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={pending || !ready}>
          {pending ? 'Saving' : 'Continue'}
        </Button>
      </div>
    </form>
  );
}
