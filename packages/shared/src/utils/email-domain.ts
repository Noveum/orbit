export function normalizeDomains(entries: readonly string[]): string[] {
  return entries
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter((entry) => entry.length > 0);
}

export function parseDomainList(value: string | undefined): string[] {
  return normalizeDomains((value ?? '').split(','));
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}
