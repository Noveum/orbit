import {
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '@/features/settings/notification-preferences.ts';
import { apiContext, handleRoute, readJson } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    return await loadNotificationPreferences(principal.userId);
  });
}

export async function PUT(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    return await saveNotificationPreferences(principal.userId, await readJson(request));
  });
}
