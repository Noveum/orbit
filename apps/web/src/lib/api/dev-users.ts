import { asc, db, eq, schema, sql } from '@orbit/db';

export interface DevUser {
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
}

const ROLE_RANK = sql`min(case ${schema.member.role}
  when 'admin' then 0
  when 'member' then 1
  when 'contributor' then 2
  else 3
end)`;

export async function listDevUsers(): Promise<DevUser[]> {
  return await db
    .select({ email: schema.user.email, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
    .groupBy(schema.user.id, schema.user.email, schema.user.name, schema.user.image)
    .orderBy(ROLE_RANK, asc(schema.user.name))
    .limit(12);
}
