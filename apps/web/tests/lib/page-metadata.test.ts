import { describe, expect, it } from 'bun:test';
import { pageMetadata } from '../../src/lib/page-metadata.ts';

describe('pageMetadata', () => {
  it('carries the page title into the open graph and twitter cards', () => {
    const meta = pageMetadata('ENG-1', '/issue/ENG-1');
    expect(meta.title).toBe('ENG-1');
    expect(meta.openGraph?.title).toBe('ENG-1 · Orbit');
    expect(meta.openGraph?.url).toBe('/issue/ENG-1');
    expect(meta.twitter?.title).toBe('ENG-1 · Orbit');
  });

  it('keeps the preview image the root layout would have supplied', () => {
    const meta = pageMetadata('ENG-1', '/issue/ENG-1');
    expect(meta.openGraph?.images).toEqual(meta.twitter?.images);
    expect(JSON.stringify(meta.openGraph?.images)).toContain('/og.png');
  });
});
