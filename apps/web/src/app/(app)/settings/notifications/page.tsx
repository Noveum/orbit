import { NotificationMatrix } from '@/features/settings/notification-matrix.tsx';
import { loadNotificationPreferences } from '@/features/settings/notification-preferences.ts';
import { pageContext } from '@/lib/api/handler.ts';

export default async function NotificationSettingsPage() {
  const { principal } = await pageContext();
  const state = await loadNotificationPreferences(principal.userId);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Notifications</h2>
        <p className="text-muted text-xs">
          Pick which channels carry each kind of notification. Inbox always keeps a copy you can
          read later.
        </p>
      </div>
      <NotificationMatrix
        disabledKeys={state.disabledKeys}
        quietHoursEnabled={state.settings.quietHoursEnabled}
        quietHoursStart={state.settings.quietHoursStart}
        quietHoursEnd={state.settings.quietHoursEnd}
        urgentBypassEnabled={state.settings.urgentBypassEnabled}
      />
    </section>
  );
}
