import { emailDelivery } from '@orbit/db/schema';
import { DomainError } from '@orbit/shared';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeTestDatabase, withRollback } from '../test-database.ts';
import {
  ConsoleTransport,
  commentEmail,
  createEmailTransport,
  digestEmail,
  type EmailMessage,
  type EmailSendResult,
  type EmailTransport,
  inviteAcceptedEmail,
  inviteEmail,
  issueAssignedEmail,
  magicLinkEmail,
  mentionEmail,
  ResendTransport,
  SmtpTransport,
  sendEmail,
} from './index.ts';

afterAll(async () => {
  await closeTestDatabase();
});

class RecordingTransport implements EmailTransport {
  readonly name = 'console' as const;
  readonly sent: EmailMessage[] = [];
  constructor(private readonly failure: Error | null = null) {}
  send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve({ providerId: `prov_${this.sent.length}` });
  }
}

describe('templates', () => {
  it('renders the magic link email with the url in html and text', async () => {
    const content = await magicLinkEmail({
      url: 'https://orbit.local/auth/magic?token=abc123',
      email: 'ada@orbit.local',
    });
    expect(content.subject).toBe('Your Orbit sign in link');
    expect(content.html).toContain('https://orbit.local/auth/magic?token=abc123');
    expect(content.html).toContain('#5A63C8');
    expect(content.text).toContain('https://orbit.local/auth/magic?token=abc123');
    expect(content.text).toContain('ada@orbit.local');
  });

  it('renders the invite email', async () => {
    const content = await inviteEmail({
      organizationName: 'Acme',
      inviterName: 'Ada',
      role: 'admin',
      acceptUrl: 'https://orbit.local/invite/xyz',
    });
    expect(content.subject).toBe('Ada invited you to Acme on Orbit');
    expect(content.html).toContain('https://orbit.local/invite/xyz');
    expect(content.text).toContain('admin');
  });

  it('renders the invite accepted email', async () => {
    const content = await inviteAcceptedEmail({ organizationName: 'Acme', memberName: 'Grace' });
    expect(content.subject).toBe('Grace joined Acme');
    expect(content.html).toContain('Grace');
    expect(content.text).toContain('Acme');
  });

  it('renders the issue assigned email', async () => {
    const content = await issueAssignedEmail({
      issueIdentifier: 'ORB-42',
      issueTitle: 'Fix the flux capacitor',
      assignerName: 'Ada',
      url: 'https://orbit.local/issue/ORB-42',
    });
    expect(content.subject).toBe('ORB-42 Fix the flux capacitor');
    expect(content.html).toContain('https://orbit.local/issue/ORB-42');
    expect(content.text).toContain('ORB-42');
  });

  it('renders the mention email and escapes user content', async () => {
    const content = await mentionEmail({
      actorName: 'Ada',
      context: 'ORB-42',
      excerpt: '<script>alert(1)</script> & "quoted"',
      url: 'https://orbit.local/issue/ORB-42#c1',
    });
    expect(content.html).not.toContain('<script>');
    expect(content.html).toContain('&lt;script&gt;');
    expect(content.html).toContain('https://orbit.local/issue/ORB-42#c1');
  });

  it('renders the comment email', async () => {
    const content = await commentEmail({
      actorName: 'Grace',
      issueIdentifier: 'ORB-7',
      issueTitle: 'Ship it',
      excerpt: 'Looks good to me',
      url: 'https://orbit.local/issue/ORB-7',
    });
    expect(content.subject).toBe('Grace commented on ORB-7');
    expect(content.html).toContain('Looks good to me');
    expect(content.text).toContain('https://orbit.local/issue/ORB-7');
  });

  it('renders the digest email with every section and item', async () => {
    const content = await digestEmail({
      organizationName: 'Acme',
      period: 'Week of 20 July',
      sections: [
        {
          title: 'Completed',
          items: [
            { title: 'ORB-1 Land the router', url: 'https://orbit.local/issue/ORB-1', meta: '2d' },
          ],
        },
        {
          title: 'In progress',
          items: [{ title: 'ORB-2 Realtime deltas', url: 'https://orbit.local/issue/ORB-2' }],
        },
      ],
    });
    expect(content.subject).toBe('Acme digest: Week of 20 July');
    expect(content.html).toContain('https://orbit.local/issue/ORB-1');
    expect(content.html).toContain('https://orbit.local/issue/ORB-2');
    expect(content.text).toContain('COMPLETED');
    expect(content.text).toContain('IN PROGRESS');
  });
});

describe('createEmailTransport', () => {
  it('defaults to the console transport', () => {
    expect(createEmailTransport({}).name).toBe('console');
    expect(createEmailTransport({ EMAIL_TRANSPORT: 'console' })).toBeInstanceOf(ConsoleTransport);
  });

  it('uses resend when the api key is present', () => {
    expect(createEmailTransport({ RESEND_API_KEY: 're_test_key' })).toBeInstanceOf(ResendTransport);
  });

  it('honours an explicit smtp choice', () => {
    expect(
      createEmailTransport({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'localhost', SMTP_PORT: '1025' }),
    ).toBeInstanceOf(SmtpTransport);
  });

  it('rejects an unknown transport and a resend transport without a key', () => {
    expect(() => createEmailTransport({ EMAIL_TRANSPORT: 'carrier-pigeon' })).toThrow(DomainError);
    expect(() => createEmailTransport({ EMAIL_TRANSPORT: 'resend' })).toThrow(DomainError);
  });
});

describe('ConsoleTransport', () => {
  it('prints a readable summary', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await new ConsoleTransport().send({
      to: 'ada@orbit.local',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      idempotencyKey: 'k1',
    });
    expect(info).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0]?.[0])).toContain('ada@orbit.local');
    info.mockRestore();
  });
});

describe('sendEmail idempotency', () => {
  it('sends once and records the delivery', async () => {
    await withRollback(async (tx) => {
      const transport = new RecordingTransport();
      const key = `test_${ulid()}`;
      const record = await sendEmail(
        tx,
        {
          to: 'ada@orbit.local',
          subject: 'Hello',
          html: '<p>Hello</p>',
          text: 'Hello',
          idempotencyKey: key,
          template: 'magic-link',
        },
        transport,
      );
      expect(transport.sent).toHaveLength(1);
      expect(record.status).toBe('sent');
      expect(record.providerId).toBe('prov_1');
      expect(record.sentAt).not.toBeNull();
      expect(record.template).toBe('magic-link');
    });
  });

  it('is a no-op for a repeated idempotency key and returns the original record', async () => {
    await withRollback(async (tx) => {
      const transport = new RecordingTransport();
      const key = `test_${ulid()}`;
      const message = {
        to: 'ada@orbit.local',
        subject: 'Hello',
        html: '<p>Hello</p>',
        text: 'Hello',
        idempotencyKey: key,
        template: 'magic-link',
      };
      const first = await sendEmail(tx, message, transport);
      const second = await sendEmail(tx, { ...message, subject: 'Different' }, transport);
      expect(transport.sent).toHaveLength(1);
      expect(second.id).toBe(first.id);
      expect(second.subject).toBe('Hello');

      const rows = await tx
        .select()
        .from(emailDelivery)
        .where(eq(emailDelivery.idempotencyKey, key));
      expect(rows).toHaveLength(1);
    });
  });

  it('records a failure and rethrows a domain error', async () => {
    await withRollback(async (tx) => {
      const key = `test_${ulid()}`;
      const transport = new RecordingTransport(new Error('smtp exploded'));
      await expect(
        sendEmail(
          tx,
          {
            to: 'ada@orbit.local',
            subject: 'Hello',
            html: '<p>Hello</p>',
            text: 'Hello',
            idempotencyKey: key,
            template: 'magic-link',
          },
          transport,
        ),
      ).rejects.toThrow(DomainError);

      const rows = await tx
        .select()
        .from(emailDelivery)
        .where(eq(emailDelivery.idempotencyKey, key));
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.error).toBe('smtp exploded');
    });
  });

  it('rejects an invalid message', async () => {
    await withRollback(async (tx) => {
      await expect(
        sendEmail(
          tx,
          {
            to: 'not-an-email',
            subject: 'Hello',
            html: '<p>Hello</p>',
            text: 'Hello',
            idempotencyKey: 'k',
            template: 'magic-link',
          },
          new RecordingTransport(),
        ),
      ).rejects.toThrow();
    });
  });
});
