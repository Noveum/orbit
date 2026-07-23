import { internal, validationFailed } from '@orbit/shared';
import { Resend } from 'resend';
import { z } from 'zod';

export const emailMessageSchema = z.object({
  to: z.string().email().max(254),
  subject: z.string().trim().min(1).max(255),
  html: z.string().min(1),
  text: z.string().min(1),
  idempotencyKey: z.string().trim().min(1).max(191),
});

export type EmailMessage = z.infer<typeof emailMessageSchema>;

export interface EmailSendResult {
  readonly providerId: string | null;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export const DEFAULT_FROM = 'Orbit <auth@orbit.local>';

export class ResendTransport implements EmailTransport {
  private readonly client: Resend;
  private readonly from: string;

  constructor(apiKey: string, from: string = DEFAULT_FROM) {
    if (apiKey.trim().length === 0) throw validationFailed('RESEND_API_KEY is required.');
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const response = await this.client.emails.send(
      {
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      { idempotencyKey: message.idempotencyKey },
    );
    if (response.error !== null) {
      throw internal(response.error.message, response.error);
    }
    return { providerId: response.data?.id ?? null };
  }
}

export function createEmailTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  const apiKey = readEnv(env, 'RESEND_API_KEY');
  if (apiKey === undefined) {
    throw validationFailed('RESEND_API_KEY is required to send email.');
  }
  return new ResendTransport(apiKey, readEnv(env, 'EMAIL_FROM') ?? DEFAULT_FROM);
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}
