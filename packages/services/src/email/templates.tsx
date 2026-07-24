import { Button, Link, Section, Text } from '@react-email/components';
import { render } from '@react-email/render';
import {
  buttonStyle,
  cardStyle,
  Layout,
  LinkLine,
  mutedStyle,
  palette,
  paragraphStyle,
} from './layout.tsx';

export interface EmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface MagicLinkProps {
  readonly url: string;
  readonly email: string;
}

export interface ResetPasswordProps {
  readonly url: string;
  readonly email: string;
}

export interface InviteProps {
  readonly organizationName: string;
  readonly inviterName: string;
  readonly role: string;
  readonly acceptUrl: string;
}

export interface InviteAcceptedProps {
  readonly organizationName: string;
  readonly memberName: string;
}

export interface IssueAssignedProps {
  readonly issueIdentifier: string;
  readonly issueTitle: string;
  readonly assignerName: string;
  readonly url: string;
}

export interface MentionProps {
  readonly actorName: string;
  readonly context: string;
  readonly excerpt: string;
  readonly url: string;
}

export interface CommentProps {
  readonly actorName: string;
  readonly issueIdentifier: string;
  readonly issueTitle: string;
  readonly excerpt: string;
  readonly url: string;
}

export interface DigestItem {
  readonly title: string;
  readonly url: string;
  readonly meta?: string;
}

export interface DigestSection {
  readonly title: string;
  readonly items: readonly DigestItem[];
}

export interface DigestProps {
  readonly organizationName: string;
  readonly period: string;
  readonly sections: readonly DigestSection[];
}

const sectionTitleStyle = {
  color: palette.text,
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  margin: '20px 0 8px',
  textTransform: 'uppercase' as const,
};

function Excerpt({ text }: { readonly text: string }) {
  return (
    <Section style={cardStyle}>
      <Text style={{ ...paragraphStyle, margin: '0' }}>{text}</Text>
    </Section>
  );
}

export async function magicLinkEmail(props: MagicLinkProps): Promise<EmailContent> {
  const subject = 'Your Orbit sign in link';
  const html = await render(
    <Layout
      preview="Sign in to Orbit"
      heading="Sign in to Orbit"
      footer={`This link was requested for ${props.email}. It expires shortly and can be used once.`}
    >
      <Text style={paragraphStyle}>Click the button below to sign in. No password needed.</Text>
      <Button href={props.url} style={buttonStyle}>
        Sign in to Orbit
      </Button>
      <LinkLine url={props.url} />
    </Layout>,
  );
  return {
    subject,
    html,
    text: [
      'Sign in to Orbit',
      '',
      `Use this link to sign in as ${props.email}:`,
      props.url,
      '',
      'The link expires shortly and can be used once.',
    ].join('\n'),
  };
}

export async function resetPasswordEmail(props: ResetPasswordProps): Promise<EmailContent> {
  const subject = 'Reset your Orbit password';
  const html = await render(
    <Layout
      preview="Reset your Orbit password"
      heading="Reset your password"
      footer={`This reset was requested for ${props.email}. It expires shortly and can be used once. If you did not ask for it, ignore this email.`}
    >
      <Text style={paragraphStyle}>Click the button below to choose a new password.</Text>
      <Button href={props.url} style={buttonStyle}>
        Reset password
      </Button>
      <LinkLine url={props.url} />
    </Layout>,
  );
  return {
    subject,
    html,
    text: [
      'Reset your Orbit password',
      '',
      `Use this link to reset the password for ${props.email}:`,
      props.url,
      '',
      'The link expires shortly and can be used once. If you did not ask for it, ignore this email.',
    ].join('\n'),
  };
}

export async function inviteEmail(props: InviteProps): Promise<EmailContent> {
  const subject = `${props.inviterName} invited you to ${props.organizationName} on Orbit`;
  const html = await render(
    <Layout preview={subject} heading={`Join ${props.organizationName}`}>
      <Text style={paragraphStyle}>
        {props.inviterName} invited you to join {props.organizationName} on Orbit as a {props.role}.
      </Text>
      <Button href={props.acceptUrl} style={buttonStyle}>
        Accept invitation
      </Button>
      <LinkLine url={props.acceptUrl} />
    </Layout>,
  );
  return {
    subject,
    html,
    text: [
      `${props.inviterName} invited you to join ${props.organizationName} on Orbit as a ${props.role}.`,
      '',
      'Accept the invitation:',
      props.acceptUrl,
    ].join('\n'),
  };
}

export async function inviteAcceptedEmail(props: InviteAcceptedProps): Promise<EmailContent> {
  const subject = `${props.memberName} joined ${props.organizationName}`;
  const html = await render(
    <Layout preview={subject} heading={subject}>
      <Text style={paragraphStyle}>
        {props.memberName} accepted your invitation and is now a member of {props.organizationName}.
      </Text>
      <Text style={mutedStyle}>Say hello and point them at their first issue.</Text>
    </Layout>,
  );
  return {
    subject,
    html,
    text: `${props.memberName} accepted your invitation and is now a member of ${props.organizationName}.`,
  };
}

export async function issueAssignedEmail(props: IssueAssignedProps): Promise<EmailContent> {
  const subject = `${props.issueIdentifier} ${props.issueTitle}`;
  const html = await render(
    <Layout
      preview={`${props.assignerName} assigned ${props.issueIdentifier} to you`}
      heading={subject}
    >
      <Text style={paragraphStyle}>{props.assignerName} assigned this issue to you.</Text>
      <Button href={props.url} style={buttonStyle}>
        Open {props.issueIdentifier}
      </Button>
      <LinkLine url={props.url} />
    </Layout>,
  );
  return {
    subject,
    html,
    text: [
      `${props.assignerName} assigned ${props.issueIdentifier} to you.`,
      props.issueTitle,
      '',
      props.url,
    ].join('\n'),
  };
}

export async function mentionEmail(props: MentionProps): Promise<EmailContent> {
  const subject = `${props.actorName} mentioned you in ${props.context}`;
  const html = await render(
    <Layout preview={subject} heading={subject}>
      <Excerpt text={props.excerpt} />
      <Button href={props.url} style={buttonStyle}>
        Open in Orbit
      </Button>
      <LinkLine url={props.url} />
    </Layout>,
  );
  return {
    subject,
    html,
    text: [subject, '', props.excerpt, '', props.url].join('\n'),
  };
}

export async function commentEmail(props: CommentProps): Promise<EmailContent> {
  const subject = `${props.actorName} commented on ${props.issueIdentifier}`;
  const html = await render(
    <Layout preview={subject} heading={`${props.issueIdentifier} ${props.issueTitle}`}>
      <Text style={paragraphStyle}>{props.actorName} left a comment.</Text>
      <Excerpt text={props.excerpt} />
      <Button href={props.url} style={buttonStyle}>
        Reply in Orbit
      </Button>
      <LinkLine url={props.url} />
    </Layout>,
  );
  return {
    subject,
    html,
    text: [
      `${props.actorName} commented on ${props.issueIdentifier} ${props.issueTitle}`,
      '',
      props.excerpt,
      '',
      props.url,
    ].join('\n'),
  };
}

export async function digestEmail(props: DigestProps): Promise<EmailContent> {
  const subject = `${props.organizationName} digest: ${props.period}`;
  const html = await render(
    <Layout preview={subject} heading={subject} footer="Turn digests off in notification settings.">
      {props.sections.map((section) => (
        <Section key={section.title}>
          <Text style={sectionTitleStyle}>{section.title}</Text>
          {section.items.map((item) => (
            <Text key={item.url} style={{ ...paragraphStyle, margin: '0 0 8px' }}>
              <Link href={item.url} style={{ color: palette.accent }}>
                {item.title}
              </Link>
              {item.meta === undefined ? null : (
                <span style={{ color: palette.muted }}> {item.meta}</span>
              )}
            </Text>
          ))}
        </Section>
      ))}
    </Layout>,
  );
  const lines = [subject, ''];
  for (const section of props.sections) {
    lines.push(section.title.toUpperCase());
    for (const item of section.items) {
      lines.push(`- ${item.title}${item.meta === undefined ? '' : ` (${item.meta})`}`);
      lines.push(`  ${item.url}`);
    }
    lines.push('');
  }
  return { subject, html, text: lines.join('\n').trim() };
}
