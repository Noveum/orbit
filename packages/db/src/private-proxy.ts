export type PrivateProxyUrlResolver = () => string | undefined;

let resolvePrivateProxyUrl: PrivateProxyUrlResolver | undefined;

export function registerPrivateDatabaseProxy(resolve: PrivateProxyUrlResolver | undefined): void {
  resolvePrivateProxyUrl = resolve;
}

export function privateDatabaseProxyUrl(): string | undefined {
  const url = resolvePrivateProxyUrl?.();
  if (url?.trim() === '') throw new Error('The private database proxy has no connection string.');
  return url;
}
