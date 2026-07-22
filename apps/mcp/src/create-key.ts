import { parseArgs } from 'node:util';
import { createApiKey } from '@orbit/core';
import { db, eq, pool, schema } from '@orbit/db';
import { z } from 'zod';

const argsSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120).default('MCP key'),
  org: z.string().min(1).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});

const DAY_MS = 86_400_000;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      org: { type: 'string' },
      expiresInDays: { type: 'string' },
    },
  });
  const parsed = argsSchema.parse(values);

  const [user] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, parsed.email.toLowerCase()))
    .limit(1);
  if (user === undefined) throw new Error(`No user with the email ${parsed.email}.`);

  const memberships = await db
    .select({ organization: schema.organization })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, user.id));

  const organization =
    parsed.org === undefined
      ? memberships[0]?.organization
      : memberships.find((row) => row.organization.slug === parsed.org)?.organization;
  if (organization === undefined) {
    throw new Error(`${parsed.email} is not a member of any matching workspace.`);
  }

  const created = await createApiKey({
    organizationId: organization.id,
    userId: user.id,
    name: parsed.name,
    ...(parsed.expiresInDays === undefined
      ? {}
      : { expiresAt: new Date(Date.now() + parsed.expiresInDays * DAY_MS) }),
  });

  console.info(
    [
      `workspace: ${organization.name} (${organization.slug})`,
      `user:      ${user.name} <${user.email}>`,
      `key name:  ${created.apiKey.name}`,
      `key id:    ${created.apiKey.id}`,
      '',
      'Copy this key now, it is not stored and cannot be shown again:',
      created.key,
    ].join('\n'),
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
