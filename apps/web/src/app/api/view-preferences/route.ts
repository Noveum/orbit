import { listViewPreferences, saveViewPreference } from '@orbit/core';
import { handle } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handle(async (principal) => ({
    preferences: await listViewPreferences(principal),
  }));
}

export async function PUT(request: Request): Promise<Response> {
  return await handle(async (principal) => ({
    preference: await saveViewPreference(principal, await request.json()),
  }));
}
