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

export const emailEnvSchema = z.object({
  RESEND_API_KEY: z.string().trim().min(1).max(255),
  EMAIL_FROM: z.string().trim().min(1).max(320).default(DEFAULT_FROM),
});

export function createEmailTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  const parsed = emailEnvSchema.safeParse({
    RESEND_API_KEY: blankToUndefined(env['RESEND_API_KEY']),
    EMAIL_FROM: blankToUndefined(env['EMAIL_FROM']),
  });
  if (!parsed.success) {
    throw validationFailed('RESEND_API_KEY is required to send email.', {
      cause: parsed.error,
    });
  }
  return new ResendTransport(parsed.data.RESEND_API_KEY, parsed.data.EMAIL_FROM);
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}
