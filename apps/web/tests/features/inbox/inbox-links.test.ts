import { describe, expect, it } from 'bun:test';
import { docIdFromUrl, issueIdentifierFromUrl } from '@/features/inbox/inbox-links.ts';

describe('issueIdentifierFromUrl', () => {
  it('reads the identifier out of the links a notification carries', () => {
    expect(issueIdentifierFromUrl('/issue/ENG-3')).toBe('ENG-3');
    expect(issueIdentifierFromUrl('/issue/ENG-3#comment-comment_9')).toBe('ENG-3');
    expect(issueIdentifierFromUrl('/issue/ENG-3?tab=activity')).toBe('ENG-3');
  });

  it('answers null for anything that is not an issue', () => {
    expect(issueIdentifierFromUrl('/docs/doc_1')).toBeNull();
    expect(issueIdentifierFromUrl('/team/eng/board')).toBeNull();
    expect(issueIdentifierFromUrl('')).toBeNull();
  });

  it('refuses a path that only looks like one rather than guessing', () => {
    expect(issueIdentifierFromUrl('/issue/not-an-identifier')).toBeNull();
    expect(issueIdentifierFromUrl('/issue/TOOLONGKEY-3')).toBeNull();
    expect(issueIdentifierFromUrl('/issues/ENG-3')).toBeNull();
  });

  it('survives an escape sequence that would break a naive decode', () => {
    expect(() => issueIdentifierFromUrl('/issue/%E0%A4%A')).not.toThrow();
    expect(issueIdentifierFromUrl('/issue/%E0%A4%A')).toBeNull();
  });
});

describe('docIdFromUrl', () => {
  it('reads the doc out of the links a notification carries', () => {
    expect(docIdFromUrl('/docs/doc_1')).toBe('doc_1');
    expect(docIdFromUrl('/docs/doc_1#doc-comment-comment_4')).toBe('doc_1');
    expect(docIdFromUrl('/docs/doc_1?mode=read')).toBe('doc_1');
  });

  it('answers null for anything that is not one doc', () => {
    expect(docIdFromUrl('/docs')).toBeNull();
    expect(docIdFromUrl('/docs/')).toBeNull();
    expect(docIdFromUrl('/issue/ENG-3')).toBeNull();
    expect(docIdFromUrl('')).toBeNull();
  });

  it('refuses the composer route, which is not a doc to read', () => {
    expect(docIdFromUrl('/docs/new')).toBeNull();
  });

  it('refuses an id longer than the schema allows rather than asking for it', () => {
    expect(docIdFromUrl(`/docs/${'a'.repeat(64)}`)).toBe('a'.repeat(64));
    expect(docIdFromUrl(`/docs/${'a'.repeat(65)}`)).toBeNull();
  });

  it('takes the uuid a doc is actually keyed by', () => {
    expect(docIdFromUrl('/docs/0195f0c2-9c1a-7b3d-8f4e-2a6b1c9d0e5f')).toBe(
      '0195f0c2-9c1a-7b3d-8f4e-2a6b1c9d0e5f',
    );
  });

  it('refuses anything outside the id alphabet rather than passing it to a fetch', () => {
    expect(docIdFromUrl('/docs/%E0%A4%A')).toBeNull();
    expect(docIdFromUrl('/docs/..')).toBeNull();
    expect(docIdFromUrl('/docs/a b')).toBeNull();
  });
});
