export type PrivateProxyUrlResolver = () => string | undefined;

let resolvePrivateProxyUrl: PrivateProxyUrlResolver | undefined;

export function registerPrivateDatabaseProxy(resolve: PrivateProxyUrlResolver | undefined): void {
  resolvePrivateProxyUrl = resolve;
}

export function privateDatabaseProxyUrl(): string | undefined {
  return resolvePrivateProxyUrl?.();
}
