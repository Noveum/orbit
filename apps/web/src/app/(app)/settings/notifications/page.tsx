import { NotificationChannels } from '@/features/settings/notification-channels.tsx';
import { loadNotificationPreferences } from '@/features/settings/notification-preferences.ts';
import { pageContext } from '@/lib/api/handler.ts';

export default async function NotificationSettingsPage() {
  const { principal } = await pageContext();
  const state = await loadNotificationPreferences(principal.userId, principal.organizationId);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text">Notifications</h2>
        <p className="text-muted text-xs">
          Turn a channel on or off for everything, then open one to pick which notifications it
          carries.
        </p>
      </div>
      <NotificationChannels
        disabledKeys={state.disabledKeys}
        quietHoursEnabled={state.settings.quietHoursEnabled}
        quietHoursStart={state.settings.quietHoursStart}
        quietHoursEnd={state.settings.quietHoursEnd}
        urgentBypassEnabled={state.settings.urgentBypassEnabled}
        slackDm={state.slackDm}
      />
    </section>
  );
}
