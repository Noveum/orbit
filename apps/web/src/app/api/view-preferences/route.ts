import { listViewPreferences, saveViewPreference } from '@orbit/core';
import { viewPreferenceSchema } from '@orbit/shared/validators';
import { handle } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handle(async (principal) => ({
    preferences: await listViewPreferences(principal),
  }));
}

export async function PUT(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const input = viewPreferenceSchema.parse(await request.json());
    return { preference: await saveViewPreference(principal, input) };
  });
}
