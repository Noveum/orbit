import { z } from 'zod';

export function emailConfigured(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  if (!environment['RESEND_API_KEY']?.trim()) return false;
  const sender = environment['EMAIL_FROM']?.trim() ?? '';
  const address = (/<([^<>]+)>$/.exec(sender)?.[1] ?? sender).trim();
  const parsed = z.email().safeParse(address);
  if (!parsed.success) return false;
  const domain = parsed.data.slice(parsed.data.lastIndexOf('@') + 1).toLowerCase();
  return domain !== 'localhost' && !domain.endsWith('.local');
}
