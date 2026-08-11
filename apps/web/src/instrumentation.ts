import { assertProductionAuthenticationConfigured } from '@/lib/env';

export function register(): void {
  assertProductionAuthenticationConfigured();
}
