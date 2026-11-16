import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

const consentGrant = new AsyncLocalStorage<string>();

export function providerTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function mcpConsentGrantId(): string | undefined {
  return consentGrant.getStore();
}

export function withMcpConsentGrant<T>(grantId: string, operation: () => Promise<T>): Promise<T> {
  return consentGrant.run(grantId, operation);
}
