import { describe, expect, it } from 'bun:test';
import { METADATA_CORS_HEADERS, metadataPreflight } from './metadata-headers.ts';

describe('metadata CORS', () => {
  it('allows any origin to read the discovery documents', () => {
    expect(METADATA_CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*');
    expect(METADATA_CORS_HEADERS['Access-Control-Allow-Methods']).toContain('GET');
    expect(METADATA_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  it('answers a preflight with 204 and the CORS headers', () => {
    const response = metadataPreflight();
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
  });
});
