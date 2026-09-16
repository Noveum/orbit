import { describe, expect, it } from 'bun:test';
import { appDocPath, docArtifactPath, docArtifactUrl } from '@/lib/docs/paths.ts';

describe('docArtifactPath', () => {
  it('hangs the page off the doc it belongs to', () => {
    expect(docArtifactPath('doc_1')).toBe(`${appDocPath('doc_1')}/artifact`);
  });

  it('encodes an id so it cannot escape its own path', () => {
    expect(docArtifactPath('a/b?c')).toBe('/docs/a%2Fb%3Fc/artifact');
  });

  it('resolves against the origin the reader is on', () => {
    expect(docArtifactUrl('doc_1', 'https://orbit.example')).toBe(
      'https://orbit.example/docs/doc_1/artifact',
    );
  });
});
