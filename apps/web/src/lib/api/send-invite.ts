import { db } from '@orbit/db';
import { inviteEmail, sendEmail } from '@orbit/services/email';
import { serverEnv } from '@/lib/env.ts';

export interface InviteEmailTarget {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: Date;
}

export function inviteAcceptUrl(token: string): string {
  return `${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${token}`;
}

export async function sendInviteEmail(params: {
  readonly invitation: InviteEmailTarget;
  readonly organizationName: string;
  readonly inviterName: string;
}): Promise<void> {
  const content = await inviteEmail({
    organizationName: params.organizationName,
    inviterName: params.inviterName,
    role: params.invitation.role,
    acceptUrl: inviteAcceptUrl(params.invitation.id),
  });
  await sendEmail(db, {
    to: params.invitation.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    template: 'invite',
    idempotencyKey: `invite:${params.invitation.id}:${params.invitation.expiresAt.toISOString()}`,
  });
}
