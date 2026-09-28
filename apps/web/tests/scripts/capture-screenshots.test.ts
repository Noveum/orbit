import { describe, expect, test } from 'bun:test';
import { verifyCaptureCount } from '../../scripts/capture-screenshots.ts';

describe('screenshot release verification', () => {
  test('accepts a complete gallery', () => {
    expect(() => verifyCaptureCount(40, 40)).not.toThrow();
  });

  test('rejects a gallery with a skipped capture', () => {
    expect(() => verifyCaptureCount(39, 40)).toThrow('Screenshot capture incomplete');
  });

  test('rejects a filter that selects no screens', () => {
    expect(() => verifyCaptureCount(0, 0)).toThrow('Screenshot capture incomplete');
  });
});
