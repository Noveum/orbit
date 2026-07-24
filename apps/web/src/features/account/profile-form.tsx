'use client';

import { AVATAR_MAX_BYTES } from '@orbit/shared/constants';
import { formatBytes } from '@orbit/shared/utils';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { ApiRequestError, apiRequest, messageOf } from '@/lib/api/client.ts';
import { AvatarCropper } from './avatar-cropper.tsx';
import { removeAvatar, uploadAvatar } from './avatar-upload.ts';

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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarPending, setAvatarPending] = useState(false);

  function pickPhoto(): void {
    fileInputRef.current?.click();
  }

  function onFileSelected(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'That file is not an image.', tone: 'danger' });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast({
        title: `Photos must be ${formatBytes(AVATAR_MAX_BYTES)} or smaller.`,
        tone: 'danger',
      });
      return;
    }
    setCropFile(file);
  }

  async function onCropped(blob: Blob): Promise<void> {
    setAvatarPending(true);
    try {
      const nextImage = await uploadAvatar(blob);
      setAvatarUrl(nextImage ?? '');
      setCropFile(null);
      toast({ title: 'Profile photo updated', tone: 'success' });
      router.refresh();
    } catch (caught) {
      toast({ title: messageOf(caught), tone: 'danger' });
    } finally {
      setAvatarPending(false);
    }
  }

  async function onRemovePhoto(): Promise<void> {
    setAvatarPending(true);
    try {
      await removeAvatar();
      setAvatarUrl('');
      toast({ title: 'Profile photo removed', tone: 'success' });
      router.refresh();
    } catch (caught) {
      toast({ title: messageOf(caught), tone: 'danger' });
    } finally {
      setAvatarPending(false);
    }
  }

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
          timezone: zone,
        },
      });
      toast({ title: 'Profile updated', tone: 'success' });
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.is('conflict')) setHandleError(caught.message);
      else setFormError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  const hasAvatar = avatarUrl.trim().length > 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="profile-form">
      <div className="flex items-center gap-4">
        <Avatar
          name={displayName}
          src={hasAvatar ? avatarUrl : null}
          size="lg"
          className="size-16 text-lg"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <p className="truncate font-medium text-dense text-text">{displayName}</p>
            <p className="truncate text-2xs text-faint">@{userHandle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={pickPhoto}
              disabled={avatarPending}
            >
              {hasAvatar ? 'Change photo' : 'Upload photo'}
            </Button>
            {hasAvatar ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void onRemovePhoto();
                }}
                disabled={avatarPending}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileSelected}
        data-testid="avatar-file-input"
      />

      <Dialog
        open={cropFile !== null}
        onOpenChange={(open) => {
          if (!open && !avatarPending) setCropFile(null);
        }}
      >
        <DialogContent showClose={!avatarPending} className="max-w-md">
          <DialogHeader>
            <DialogTitle>Crop your photo</DialogTitle>
            <DialogDescription>
              Drag to reposition and use the slider to zoom. This is how you appear everywhere.
            </DialogDescription>
          </DialogHeader>
          {cropFile === null ? null : (
            <AvatarCropper
              file={cropFile}
              pending={avatarPending}
              onCancel={() => setCropFile(null)}
              onConfirm={(blob) => {
                void onCropped(blob);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <fieldset disabled={pending} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-name" className="font-medium text-dense text-text">
            Display name
          </label>
          <Input
            id="profile-name"
            name="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            minLength={1}
            maxLength={64}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-handle" className="font-medium text-dense text-text">
            Handle
          </label>
          <Input
            id="profile-handle"
            name="handle"
            value={userHandle}
            onChange={(event) => setUserHandle(event.target.value)}
            required
            minLength={2}
            maxLength={39}
            aria-invalid={handleError !== null}
            aria-describedby={handleError === null ? 'profile-handle-hint' : 'profile-handle-error'}
          />
          <span id="profile-handle-hint" className="text-faint text-xs">
            Teammates mention you with @{userHandle.length === 0 ? 'handle' : userHandle}. It has to
            be unique.
          </span>
          {handleError === null ? null : (
            <span id="profile-handle-error" role="alert" className="text-danger text-xs">
              {handleError}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-timezone" className="font-medium text-dense text-text">
            Timezone
          </label>
          <Input
            id="profile-timezone"
            name="timezone"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            required
            maxLength={64}
            placeholder="Asia/Kolkata"
            list="profile-timezone-options"
            aria-describedby="profile-timezone-hint"
          />
          <datalist id="profile-timezone-options">
            {Intl.supportedValuesOf('timeZone').map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <span id="profile-timezone-hint" className="text-faint text-xs">
            Due dates and digests follow this zone. Yours looks like{' '}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}.
          </span>
        </div>
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
