import { ProfileForm } from '@/features/account/profile-form.tsx';
import { requireSession } from '@/lib/auth/session.ts';

export default async function AccountProfilePage() {
  const session = await requireSession();
  const user = session.user;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Profile</h2>
        <p className="text-muted text-xs">
          This is how you appear to everyone in every workspace you belong to.
        </p>
      </div>
      <ProfileForm
        name={user.name}
        handle={user.handle ?? ''}
        image={user.image ?? null}
        timezone={user.timezone ?? 'UTC'}
      />
    </section>
  );
}
