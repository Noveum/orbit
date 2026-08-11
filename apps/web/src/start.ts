import { assertProductionAuthenticationConfigured } from '@/lib/env';

assertProductionAuthenticationConfigured();

await import(new URL('./server.js', import.meta.url).href);
