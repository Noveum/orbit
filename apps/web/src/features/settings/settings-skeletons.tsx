import { Skeleton } from '@/components/ui/skeleton.tsx';

function SettingsHeading({ subtitle = true }: { readonly subtitle?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <Skeleton className="h-6 w-32" />
      {subtitle ? <Skeleton className="h-3 w-80 max-w-full" /> : null}
    </div>
  );
}

function FormRowSkeleton({ hint = false }: { readonly hint?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-9 w-full rounded-md" />
      {hint ? <Skeleton className="h-2 w-56 max-w-full" /> : null}
    </div>
  );
}

export function GeneralSettingsSkeleton() {
  return (
    <section className="flex flex-col gap-4" data-testid="settings-general-skeleton">
      <Skeleton className="h-6 w-24" />
      <div className="flex flex-col gap-5">
        <FormRowSkeleton />
        <FormRowSkeleton hint />
        <FormRowSkeleton hint />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
    </section>
  );
}

const INTEGRATION_CARDS = ['github', 'slack', 'mcp'];

export function IntegrationsSettingsSkeleton() {
  return (
    <section className="flex flex-col gap-5" data-testid="settings-integrations-skeleton">
      <SettingsHeading />
      <div className="flex flex-col gap-6">
        {INTEGRATION_CARDS.map((card) => (
          <section
            key={card}
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5"
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full max-w-lg" />
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

const TEAM_CARDS = ['first', 'second'];
const MEMBERSHIP_CHIPS = ['a', 'b', 'c', 'd'];

export function TeamsSettingsSkeleton() {
  return (
    <section className="flex flex-col gap-5" data-testid="settings-teams-skeleton">
      <SettingsHeading />
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <div className="flex w-32 flex-col gap-1.5">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <ul className="flex flex-col gap-3">
          {TEAM_CARDS.map((team) => (
            <li key={team} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-12 rounded-full" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <div className="flex items-center gap-1">
                  <Skeleton className="h-7 w-16 rounded-md" />
                  <Skeleton className="h-7 w-16 rounded-md" />
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {MEMBERSHIP_CHIPS.map((chip) => (
                  <div key={chip} className="flex items-center gap-1.5">
                    <Skeleton className="size-4 rounded-sm" />
                    <Skeleton className="size-4 rounded-full" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const MEMBER_ROWS = ['a', 'b', 'c', 'd', 'e'];
const MEMBER_COLUMNS = ['member', 'email', 'role', 'teams', 'joined', 'actions'];

export function MembersSettingsSkeleton() {
  return (
    <section className="flex flex-col gap-5" data-testid="settings-members-skeleton">
      <SettingsHeading />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse md:min-w-[52rem]">
          <thead>
            <tr className="border-border border-b">
              {MEMBER_COLUMNS.map((column) => (
                <th key={column} className="px-3 py-2 text-left">
                  <Skeleton className="h-2 w-12" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEMBER_ROWS.map((row) => (
              <tr key={row} className="border-border border-b last:border-b-0">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-3 w-36" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-7 w-36 rounded-md" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-4 w-12 rounded-full" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-3 w-20" />
                </td>
                <td className="px-3 py-2 text-right">
                  <Skeleton className="ml-auto h-7 w-16 rounded-md" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-2 w-72 max-w-full" />
        </div>
        <Skeleton className="h-20 w-full rounded-md" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-7 w-36 rounded-md" />
          <Skeleton className="h-7 w-40 rounded-md" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
    </section>
  );
}

const MATRIX_ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const MATRIX_CHANNELS = ['inbox', 'email', 'slack', 'push'];

export function NotificationsSettingsSkeleton() {
  return (
    <section className="flex flex-col gap-5" data-testid="settings-notifications-skeleton">
      <SettingsHeading />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[36rem] border-collapse">
          <thead>
            <tr className="border-border border-b">
              <th className="px-3 py-2 text-left">
                <Skeleton className="h-2 w-20" />
              </th>
              {MATRIX_CHANNELS.map((channel) => (
                <th key={channel} className="px-3 py-2">
                  <Skeleton className="mx-auto h-2 w-10" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row) => (
              <tr key={row} className="border-border border-b last:border-b-0">
                <th scope="row" className="px-3 py-1.5 text-left">
                  <Skeleton className="h-3 w-32" />
                </th>
                {MATRIX_CHANNELS.map((channel) => (
                  <td key={channel} className="px-3 py-1.5">
                    <Skeleton className="mx-auto size-4 rounded-sm" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2 w-64 max-w-full" />
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-9 w-36 rounded-md" />
    </section>
  );
}
