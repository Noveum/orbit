import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

export const palette = {
  accent: '#5A63C8',
  accentSoft: '#EEF0FB',
  text: '#111214',
  muted: '#6B7280',
  border: '#E4E4E8',
  surface: '#FFFFFF',
  canvas: '#F5F5F7',
} as const;

const bodyStyle = {
  backgroundColor: palette.canvas,
  color: palette.text,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif",
  margin: '0',
  padding: '24px 12px',
};

const containerStyle = {
  backgroundColor: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: '12px',
  margin: '0 auto',
  maxWidth: '560px',
  padding: '32px',
  width: '100%',
};

const brandStyle = {
  color: palette.accent,
  fontSize: '14px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  margin: '0 0 24px',
  textTransform: 'uppercase' as const,
};

const headingStyle = {
  color: palette.text,
  fontSize: '22px',
  fontWeight: 600,
  lineHeight: '1.3',
  margin: '0 0 12px',
};

export const paragraphStyle = {
  color: palette.text,
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '0 0 16px',
};

export const mutedStyle = {
  color: palette.muted,
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0',
};

export const buttonStyle = {
  backgroundColor: palette.accent,
  borderRadius: '8px',
  color: '#FFFFFF',
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: 600,
  padding: '12px 20px',
  textDecoration: 'none',
};

export const cardStyle = {
  backgroundColor: palette.accentSoft,
  borderRadius: '10px',
  margin: '0 0 20px',
  padding: '16px',
};

const hrStyle = { borderColor: palette.border, margin: '28px 0 16px' };

export interface LayoutProps {
  readonly preview: string;
  readonly heading: string;
  readonly children: ReactNode;
  readonly footer?: string;
}

export function Layout({ preview, heading, children, footer }: LayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={brandStyle}>Orbit</Text>
          <Heading style={headingStyle}>{heading}</Heading>
          <Section>{children}</Section>
          <Hr style={hrStyle} />
          <Text style={mutedStyle}>
            {footer ?? 'You are receiving this because of your Orbit notification settings.'}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function LinkLine({ url }: { readonly url: string }) {
  return (
    <Text style={mutedStyle}>
      Or paste this link into your browser:{' '}
      <Link href={url} style={{ color: palette.accent }}>
        {url}
      </Link>
    </Text>
  );
}
