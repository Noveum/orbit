import { internal, validationFailed } from '@orbit/shared';
import { createTransport } from 'nodemailer';
import { Resend } from 'resend';
import { z } from 'zod';

export const EMAIL_TRANSPORT_NAMES = ['console', 'smtp', 'resend'] as const;
export type EmailTransportName = (typeof EMAIL_TRANSPORT_NAMES)[number];

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
  readonly name: EmailTransportName;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export const DEFAULT_FROM = 'Orbit <auth@orbit.local>';

export class ConsoleTransport implements EmailTransport {
  readonly name = 'console' as const;

  send(message: EmailMessage): Promise<EmailSendResult> {
    console.info(
      [
        '',
        '─── orbit email ───────────────────────────────',
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        `key:     ${message.idempotencyKey}`,
        '',
        message.text,
        '───────────────────────────────────────────────',
      ].join('\n'),
    );
    return Promise.resolve({ providerId: null });
  }
}

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  readonly secure?: boolean;
  readonly user?: string;
  readonly pass?: string;
}

export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp' as const;
  private readonly from: string;
  private readonly transporter: ReturnType<typeof createTransport>;

  constructor(options: SmtpOptions) {
    this.from = options.from;
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? false,
      ...(options.user === undefined
        ? {}
        : { auth: { user: options.user, pass: options.pass ?? '' } }),
    });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: { 'X-Orbit-Idempotency-Key': message.idempotencyKey },
    });
    return { providerId: info.messageId ?? null };
  }
}

export class ResendTransport implements EmailTransport {
  readonly name = 'resend' as const;
  private readonly client: Resend;
  private readonly from: string;

  constructor(apiKey: string, from: string = DEFAULT_FROM) {
    if (apiKey.length === 0) throw validationFailed('RESEND_API_KEY is required.');
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
  const from = env['EMAIL_FROM'] ?? DEFAULT_FROM;
  const apiKey = env['RESEND_API_KEY'] ?? '';
  const configured = env['EMAIL_TRANSPORT'];
  const selected: string = configured ?? (apiKey.length > 0 ? 'resend' : 'console');

  if (selected === 'console') return new ConsoleTransport();
  if (selected === 'resend') return new ResendTransport(apiKey, from);
  if (selected === 'smtp') {
    return new SmtpTransport({
      host: env['SMTP_HOST'] ?? 'localhost',
      port: Number.parseInt(env['SMTP_PORT'] ?? '1025', 10),
      from,
      secure: env['SMTP_SECURE'] === 'true',
      ...(env['SMTP_USER'] === undefined ? {} : { user: env['SMTP_USER'] }),
      ...(env['SMTP_PASS'] === undefined ? {} : { pass: env['SMTP_PASS'] }),
    });
  }
  throw validationFailed(
    `Unknown EMAIL_TRANSPORT "${selected}". Use "console", "smtp" or "resend".`,
  );
}
