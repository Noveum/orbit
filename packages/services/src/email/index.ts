import type { Database, Transaction } from '@orbit/db';
import { emailDelivery } from '@orbit/db/schema';
import { internal, toDomainError } from '@orbit/shared';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { z } from 'zod';
import { createEmailTransport, type EmailTransport, emailMessageSchema } from './transports.ts';

export { palette as emailPalette } from './layout.tsx';
export * from './templates.tsx';
export * from './transports.ts';

export type EmailDatabase = Database | Transaction;

export type EmailDeliveryRecord = typeof emailDelivery.$inferSelect;

export const sendEmailSchema = emailMessageSchema.extend({
  template: z.string().trim().min(1).max(64),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

export async function sendEmail(
  database: EmailDatabase,
  input: SendEmailInput,
  transport: EmailTransport = createEmailTransport(),
): Promise<EmailDeliveryRecord> {
  const message = sendEmailSchema.parse(input);
  const claimed = await database
    .insert(emailDelivery)
    .values({
      id: ulid(),
      idempotencyKey: message.idempotencyKey,
      toEmail: message.to,
      subject: message.subject,
      template: message.template,
      status: 'queued',
    })
    .onConflictDoNothing({ target: emailDelivery.idempotencyKey })
    .returning();

  const row = claimed[0];
  if (row === undefined) return await findDelivery(database, message.idempotencyKey);

  try {
    const result = await transport.send(message);
    const updated = await database
      .update(emailDelivery)
      .set({ status: 'sent', providerId: result.providerId, sentAt: new Date() })
      .where(eq(emailDelivery.id, row.id))
      .returning();
    return updated[0] ?? row;
  } catch (error) {
    const failure = toDomainError(error);
    await database
      .update(emailDelivery)
      .set({ status: 'failed', error: failure.message })
      .where(eq(emailDelivery.id, row.id));
    throw failure;
  }
}

export async function findDelivery(
  database: EmailDatabase,
  idempotencyKey: string,
): Promise<EmailDeliveryRecord> {
  const rows = await database
    .select()
    .from(emailDelivery)
    .where(eq(emailDelivery.idempotencyKey, idempotencyKey))
    .limit(1);
  const existing = rows[0];
  if (existing === undefined) throw internal('That email delivery record disappeared.');
  return existing;
}
