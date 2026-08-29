export function normalizeDomains(entries: readonly string[]): string[] {
  return entries
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter((entry) => entry.length > 0);
}

export function parseDomainList(
  value: string | undefined,
  name = 'The domain allowlist',
): string[] {
  const raw = (value ?? '').trim();
  if (raw.length === 0) return [];
  const domains = normalizeDomains(raw.split(','));
  if (domains.length === 0) {
    throw new Error(
      `${name} is set to ${JSON.stringify(value)}, which names no domain. Leave it unset to admit every domain.`,
    );
  }
  return domains;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}
