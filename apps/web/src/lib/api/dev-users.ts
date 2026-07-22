import { asc, db, schema } from '@orbit/db';

export interface DevUser {
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
}

export async function listDevUsers(): Promise<DevUser[]> {
  return await db
    .select({ email: schema.user.email, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .orderBy(asc(schema.user.createdAt))
    .limit(12);
}
