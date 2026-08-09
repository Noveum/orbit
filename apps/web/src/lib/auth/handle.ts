import { randomUUID } from 'node:crypto';
import { slugify } from '@orbit/shared/utils';

export const HANDLE_CANDIDATES = 20;

export function handleBaseFor(email: string, name: string): string {
  return slugify(name) || slugify(email.split('@')[0] ?? '') || 'member';
}

export function candidatesFor(base: string): string[] {
  const numbered = Array.from(
    { length: HANDLE_CANDIDATES - 1 },
    (_unused, index) => `${base}-${index + 2}`,
  );
  return [base, ...numbered];
}

export async function uniqueHandleFor(
  email: string,
  name: string,
  taken: (candidates: readonly string[]) => Promise<Set<string>>,
): Promise<string> {
  const base = handleBaseFor(email, name);
  const candidates = candidatesFor(base);
  const used = await taken(candidates);
  const free = candidates.find((candidate) => !used.has(candidate));
  return free ?? `${base}-${randomUUID().replaceAll('-', '').slice(0, 10)}`;
}
