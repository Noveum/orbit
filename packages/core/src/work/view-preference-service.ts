import { and, db, eq, schema } from '@orbit/db';
import { VIEW_LAYOUT_MODES, VIEW_PAGES } from '@orbit/shared/filters';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { z } from 'zod';
import { newId } from '../internal.ts';

export const viewPreferenceSchema = z.object({
  page: z.enum(VIEW_PAGES),
  scope: z.string().max(64).default(''),
  layout: z.enum(VIEW_LAYOUT_MODES),
  display: z.record(z.string(), z.unknown()).default({}),
});

export type ViewPreferenceInput = z.infer<typeof viewPreferenceSchema>;

export interface ViewPreference {
  readonly page: string;
  readonly scope: string;
  readonly layout: string;
  readonly display: Record<string, unknown>;
}

export async function listViewPreferences(principal: Principal): Promise<ViewPreference[]> {
  assertCan(principal, 'issue:read');
  const rows = await db
    .select({
      page: schema.viewPreference.page,
      scope: schema.viewPreference.scope,
      layout: schema.viewPreference.layout,
      display: schema.viewPreference.display,
    })
    .from(schema.viewPreference)
    .where(
      and(
        eq(schema.viewPreference.userId, principal.userId),
        eq(schema.viewPreference.organizationId, principal.organizationId),
      ),
    );
  return rows.map((row) => ({ ...row, display: row.display }));
}

export async function saveViewPreference(
  principal: Principal,
  input: unknown,
): Promise<ViewPreference> {
  assertCan(principal, 'issue:read');
  const parsed = viewPreferenceSchema.parse(input);

  const [row] = await db
    .insert(schema.viewPreference)
    .values({
      id: newId(),
      organizationId: principal.organizationId,
      userId: principal.userId,
      page: parsed.page,
      scope: parsed.scope,
      layout: parsed.layout,
      display: parsed.display,
    })
    .onConflictDoUpdate({
      target: [
        schema.viewPreference.userId,
        schema.viewPreference.organizationId,
        schema.viewPreference.page,
        schema.viewPreference.scope,
      ],
      set: { layout: parsed.layout, display: parsed.display, updatedAt: new Date() },
    })
    .returning({
      page: schema.viewPreference.page,
      scope: schema.viewPreference.scope,
      layout: schema.viewPreference.layout,
      display: schema.viewPreference.display,
    });

  if (row === undefined) throw new Error('The view preference did not save.');
  return row;
}
