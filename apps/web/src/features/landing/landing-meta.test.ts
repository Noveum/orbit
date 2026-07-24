import { describe, expect, it } from 'bun:test';
import { landingMetadata, landingStructuredData } from './landing-meta.ts';

describe('landingMetadata', () => {
  it('canonicalises each entry point independently and stays indexable', () => {
    expect(landingMetadata('/').alternates?.canonical).toBe('/');
    expect(landingMetadata('/home').alternates?.canonical).toBe('/home');
    expect(landingMetadata('/home').robots).toMatchObject({ index: true, follow: true });
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
