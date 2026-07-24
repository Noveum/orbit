import { describe, expect, it } from 'bun:test';
import { landingMetadata, landingStructuredData } from './landing-meta.ts';

describe('landingMetadata', () => {
  it('builds an absolute, indexable canonical shared by the open graph url', () => {
    const meta = landingMetadata('/');
    const canonical = String(meta.alternates?.canonical);
    expect(canonical).toMatch(/^https?:\/\//);
    expect(meta.robots).toMatchObject({ index: true, follow: true });
    expect(meta.openGraph?.url).toBe(canonical);
  });
});

describe('landingStructuredData', () => {
  it('describes a free software application for crawlers', () => {
    const data = JSON.parse(landingStructuredData());
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.offers.price).toBe('0');
    expect(Array.isArray(data.featureList)).toBe(true);
  });
});
