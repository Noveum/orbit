import { assertProductionStartupAuthenticationConfigured } from '@/lib/env';

assertProductionStartupAuthenticationConfigured();

await import(new URL('./server.js', import.meta.url).href);
