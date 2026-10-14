export function signInRedirect(
  pathname: string,
  search: string,
  hasCookie: boolean,
): string | null {
  if (hasCookie) return null;
  return `/login?${new URLSearchParams({ next: pathname + search }).toString()}`;
}
