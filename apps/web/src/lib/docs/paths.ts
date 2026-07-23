export function publicDocPath(token: string): string {
  return `/d/${encodeURIComponent(token)}`;
}
