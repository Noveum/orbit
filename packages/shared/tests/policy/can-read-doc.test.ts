import { describe, expect, it } from 'bun:test';
import { canReadDoc, type DocReader, type ReadableDocRow } from '../../src/policy/index.ts';

const ORG = 'org_1';

function reader(overrides: Partial<DocReader> = {}): DocReader {
  return { userId: 'user_reader', organizationId: ORG, role: 'member', ...overrides };
}

function doc(overrides: Partial<ReadableDocRow> = {}): ReadableDocRow {
  return {
    id: 'doc_1',
    organizationId: ORG,
    authorId: 'user_author',
    visibility: 'workspace',
    ...overrides,
  };
}

describe('canReadDoc', () => {
  it('refuses a doc in another workspace, whatever the role', () => {
    const other = doc({ organizationId: 'org_2' });
    expect(canReadDoc(reader({ role: 'admin' }), other, [])).toBe(false);
    expect(canReadDoc(reader({ userId: 'user_author', role: 'admin' }), other, ['doc_1'])).toBe(
      false,
    );
  });

  it('lets an org admin read anything in their own workspace', () => {
    expect(canReadDoc(reader({ role: 'admin' }), doc({ visibility: 'private' }), [])).toBe(true);
  });

  it('lets the author read their own restricted doc', () => {
    expect(canReadDoc(reader({ userId: 'user_author' }), doc({ visibility: 'private' }), [])).toBe(
      true,
    );
  });

  it('lets anyone in the workspace read an unrestricted doc', () => {
    for (const visibility of ['workspace', 'members', 'link', 'public']) {
      expect(canReadDoc(reader(), doc({ visibility }), [])).toBe(true);
    }
  });

  it('refuses a restricted doc without a grant', () => {
    for (const visibility of ['private', 'team']) {
      expect(canReadDoc(reader(), doc({ visibility }), [])).toBe(false);
      expect(canReadDoc(reader(), doc({ visibility }), ['doc_other'])).toBe(false);
    }
  });

  it('allows a restricted doc once the grant names it', () => {
    expect(canReadDoc(reader(), doc({ visibility: 'private' }), ['doc_1'])).toBe(true);
    expect(canReadDoc(reader(), doc({ visibility: 'team' }), ['doc_1'])).toBe(true);
  });

  it('treats an unknown visibility as unrestricted, matching isRestricted', () => {
    expect(canReadDoc(reader(), doc({ visibility: 'something_new' }), [])).toBe(true);
  });
});
