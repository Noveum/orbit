export const PASSKEY_STEP_UP_WINDOW_MS = 120_000;
export const FRESH_SESSION_WINDOW_MS = 300_000;

export function signedInWithin(
  createdAt: Date | string,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const started = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  if (!Number.isFinite(started)) return false;
  return started <= now && now - started < windowMs;
}
