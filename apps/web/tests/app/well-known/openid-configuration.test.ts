import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

const ROUTE = 'src/app/.well-known/openid-configuration/route.ts';

describe('the openid configuration alias', () => {
  it('serves the same metadata as the oauth authorization server document', async () => {
    const source = await readFile(ROUTE, 'utf8');
    expect(source).toContain("from '../oauth-authorization-server/route.ts'");
    expect(source).toContain('GET');
  });

  it('declares the route config rather than re-exporting it', async () => {
    const source = await readFile(ROUTE, 'utf8');

    expect(source).toMatch(/export const runtime = 'nodejs';/);
    expect(source).toMatch(/export const dynamic = 'force-dynamic';/);
    expect(source).not.toMatch(/export \{[^}]*\bruntime\b[^}]*\} from/);
    expect(source).not.toMatch(/export \{[^}]*\bdynamic\b[^}]*\} from/);
  });
});
