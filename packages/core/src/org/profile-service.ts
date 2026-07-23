import { and, db, eq, ne, schema } from '@orbit/db';
import { conflict } from '@orbit/shared/errors';
import { profileUpdateSchema } from '@orbit/shared/validators';
import { requireRow } from '../internal.ts';

export type UserRow = typeof schema.user.$inferSelect;

const UNIQUE_VIOLATION = '23505';
const HANDLE_TAKEN = 'That handle is already taken.';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}

export async function updateProfile(userId: string, input: unknown): Promise<UserRow> {
  const parsed = profileUpdateSchema.parse(input);

  const values: Partial<typeof schema.user.$inferInsert> = {};
  if (parsed.name !== undefined) values.name = parsed.name;
  if (parsed.handle !== undefined) values.handle = parsed.handle;
  if (parsed.image !== undefined) values.image = parsed.image;
  if (parsed.timezone !== undefined) values.timezone = parsed.timezone;

  if (parsed.handle !== undefined) {
    const [taken] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.handle, parsed.handle), ne(schema.user.id, userId)))
      .limit(1);
    if (taken !== undefined) throw conflict(HANDLE_TAKEN);
  }

  try {
    const [updated] = await db
      .update(schema.user)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.user.id, userId))
      .returning();

    return requireRow(updated, 'That account does not exist.');
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(HANDLE_TAKEN);
    throw error;
  }
}
