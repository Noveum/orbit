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

  it('advertises a large-image social card backed by an absolute og image', () => {
    const meta = landingMetadata('/');
    const twitter = meta.twitter as { card?: string } | null | undefined;
    expect(twitter?.card).toBe('summary_large_image');
    const ogImages = meta.openGraph?.images;
    const first = Array.isArray(ogImages) ? ogImages[0] : ogImages;
    const url =
      typeof first === 'object' && first !== null && 'url' in first ? String(first.url) : '';
    expect(url).toMatch(/^https?:\/\/.*\/og\.png$/);
  });
});

describe('landingStructuredData', () => {
  it('describes a free software application for crawlers', () => {
    const data = JSON.parse(landingStructuredData());
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.offers.price).toBe('0');
    expect(Array.isArray(data.featureList)).toBe(true);
    expect(String(data.logo)).toMatch(/^https?:\/\/.*\/logo\.png$/);
    expect(String(data.image)).toMatch(/^https?:\/\/.*\/og\.png$/);
  });
});
