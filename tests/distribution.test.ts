import { describe, expect, it } from 'bun:test';
import { access, readFile } from 'node:fs/promises';

interface OrbitManifest {
  readonly schemaVersion: number;
  readonly product: {
    readonly name: string;
    readonly directoryName: string;
    readonly publisher: string;
    readonly contactEmail: string;
    readonly license: string;
    readonly hostedMaturity: string;
    readonly selfHostingMaturity: string;
    readonly hostedPricing: string;
    readonly hasPaidTiers: boolean;
    readonly hasBillingCode: boolean;
  };
  readonly urls: Readonly<Record<string, string>> & { readonly mcp: string };
  readonly mcp: {
    readonly registryName: string;
    readonly registryVersion: string;
    readonly transport: string;
    readonly authentication: string;
    readonly readScope: string;
    readonly writeScope: string;
  };
  readonly copy: {
    readonly tagline: string;
    readonly registryDescription: string;
    readonly directoryShort: string;
    readonly directoryMedium: string;
    readonly productHunt: string;
    readonly selfHosted: string;
    readonly mcpDirectory: string;
  };
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly alternatives: readonly string[];
  readonly assets: {
    readonly logo: string;
    readonly openGraph: string;
    readonly screenshots: readonly string[];
  };
}

type SubmissionStatus =
  | 'planned'
  | 'submitted'
  | 'pending'
  | 'live'
  | 'blocked'
  | 'deferred'
  | 'skipped';

interface SubmissionChannel {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly status: SubmissionStatus;
  readonly submittedAt?: string;
  readonly account?: string;
  readonly evidence?: string;
  readonly publicUrl?: string;
  readonly blocker?: string;
  readonly nextAction?: string;
}

interface SubmissionLedger {
  readonly schemaVersion: number;
  readonly lastVerified: string;
  readonly channels: readonly SubmissionChannel[];
}

interface RegistryManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly remotes: readonly { readonly type: string; readonly url: string }[];
}

interface ServerCard {
  readonly serverInfo: { readonly name: string; readonly version: string };
}

const root = new URL('../', import.meta.url);

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as T;
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

const statuses = new Set<SubmissionStatus>([
  'planned',
  'submitted',
  'pending',
  'live',
  'blocked',
  'deferred',
  'skipped',
]);

describe('distribution metadata', () => {
  it('keeps approved copy inside destination limits', async () => {
    const manifest = await readJson<OrbitManifest>('distribution/orbit.json');
    expect(characterCount(manifest.copy.tagline)).toBeLessThanOrEqual(60);
    expect(characterCount(manifest.copy.registryDescription)).toBeLessThanOrEqual(100);
    expect(characterCount(manifest.copy.directoryShort)).toBeLessThanOrEqual(160);
    expect(characterCount(manifest.copy.productHunt)).toBeLessThanOrEqual(260);
    expect(manifest.copy.selfHosted.toLowerCase()).toContain('preview');
    expect(manifest.copy.selfHosted.toLowerCase()).toContain('provider-neutral');

    const copy = Object.values(manifest.copy).join('\n').toLowerCase();
    expect(copy).not.toContain('better than every');
    expect(copy).not.toContain('production-ready self-hosting');
    expect(copy).not.toContain('free infrastructure');
    expect(copy).not.toContain('unlimited infrastructure');
  });

  it('keeps canonical product facts truthful and portable', async () => {
    const manifest = await readJson<OrbitManifest>('distribution/orbit.json');
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.product.name).toBe('Orbit');
    expect(manifest.product.directoryName).toBe('Orbit by Noveum');
    expect(manifest.product.publisher).toBe('Noveum AI');
    expect(manifest.product.contactEmail).toBe('shashank@noveum.ai');
    expect(manifest.product.license).toBe('Apache-2.0');
    expect(manifest.product.hostedMaturity).toBe('production');
    expect(manifest.product.selfHostingMaturity).toBe('preview');
    expect(manifest.product.hostedPricing).toBe('free');
    expect(manifest.product.hasPaidTiers).toBe(false);
    expect(manifest.product.hasBillingCode).toBe(false);

    for (const url of Object.values(manifest.urls)) {
      expect(url.startsWith('https://')).toBe(true);
      expect(url).not.toContain('localhost');
    }

    expect(manifest.categories.length).toBeGreaterThanOrEqual(3);
    expect(new Set(manifest.categories).size).toBe(manifest.categories.length);
    expect(new Set(manifest.tags).size).toBe(manifest.tags.length);
    expect(new Set(manifest.alternatives).size).toBe(manifest.alternatives.length);
  });

  it('keeps MCP directory facts aligned with published metadata', async () => {
    const manifest = await readJson<OrbitManifest>('distribution/orbit.json');
    const registry = await readJson<RegistryManifest>('server.json');
    const serverCard = await readJson<ServerCard>(
      'apps/web/public/.well-known/mcp/server-card.json',
    );

    expect(registry.name).toBe(manifest.mcp.registryName);
    expect(registry.version).toBe(manifest.mcp.registryVersion);
    expect(registry.description).toBe(manifest.copy.registryDescription);
    expect(registry.remotes).toContainEqual({
      type: manifest.mcp.transport,
      url: manifest.urls['mcp'],
    });
    expect(serverCard.serverInfo.name).toBe(manifest.product.name);
    expect(serverCard.serverInfo.version).toBe(manifest.mcp.registryVersion);
    expect(manifest.mcp.authentication.toLowerCase()).toContain('oauth');
    expect(manifest.mcp.readScope).toBe('orbit.read');
    expect(manifest.mcp.writeScope).toBe('orbit.write');
  });

  it('references real upstream assets', async () => {
    const manifest = await readJson<OrbitManifest>('distribution/orbit.json');
    const assets = [
      manifest.assets.logo,
      manifest.assets.openGraph,
      ...manifest.assets.screenshots,
    ];
    expect(new Set(assets).size).toBe(assets.length);
    await Promise.all(assets.map((path) => access(new URL(path, root))));
  });

  it('records submissions without duplicates or unsupported completion claims', async () => {
    const ledger = await readJson<SubmissionLedger>('distribution/submissions.json');
    expect(ledger.schemaVersion).toBe(1);
    expect(validDate(ledger.lastVerified)).toBe(true);
    expect(ledger.channels.length).toBeGreaterThan(0);
    expect(new Set(ledger.channels.map((channel) => channel.id)).size).toBe(ledger.channels.length);

    for (const channel of ledger.channels) {
      expect(channel.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(channel.name.trim().length).toBeGreaterThan(0);
      expect(channel.kind.trim().length).toBeGreaterThan(0);
      expect(statuses.has(channel.status)).toBe(true);

      if (channel.submittedAt !== undefined) expect(validDate(channel.submittedAt)).toBe(true);
      if (channel.publicUrl !== undefined)
        expect(channel.publicUrl.startsWith('https://')).toBe(true);
      if (channel.status === 'submitted' || channel.status === 'pending') {
        expect(channel.submittedAt).toBeDefined();
        expect(channel.evidence?.trim().length ?? 0).toBeGreaterThan(0);
      }
      if (channel.status === 'live') {
        expect(channel.submittedAt).toBeDefined();
        expect(channel.evidence?.trim().length ?? 0).toBeGreaterThan(0);
        expect(channel.publicUrl?.startsWith('https://')).toBe(true);
      }
      if (channel.status === 'blocked') {
        expect(channel.blocker?.trim().length ?? 0).toBeGreaterThan(0);
      }
      if (channel.status === 'deferred') {
        expect((channel.blocker ?? channel.nextAction)?.trim().length ?? 0).toBeGreaterThan(0);
      }
    }

    const serialized = JSON.stringify(ledger).toLowerCase();
    expect(serialized).not.toMatch(
      /"(?:password|access_token|refresh_token|session_cookie|api_key)"\s*:/,
    );
    expect(serialized).not.toContain('mcp-publisher login');
  });
});
