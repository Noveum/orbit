import type { QueryClient } from '@tanstack/react-query';
import { BOOTSTRAP_ROOT } from '@/lib/query/keys.ts';

export function invalidateBootstrap(client: QueryClient): void {
  client.invalidateQueries({ queryKey: [BOOTSTRAP_ROOT] }).catch(() => undefined);
}
