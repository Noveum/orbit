import { describe, expect, it } from 'bun:test';
import {
  DOC_VISIBILITIES,
  isExternallyShared,
  isPublished,
  isRestricted,
  isWorkspaceShared,
} from '../../src/constants/doc.ts';

describe('doc visibility', () => {
  it('counts both workspace access levels as shared with the workspace', () => {
    expect(DOC_VISIBILITIES.filter(isWorkspaceShared)).toEqual(['workspace', 'members']);
  });

  it('gives a link to every audience wider than the people you name', () => {
    expect(DOC_VISIBILITIES.filter(isPublished)).toEqual([
      'workspace',
      'members',
      'link',
      'public',
    ]);
    expect(DOC_VISIBILITIES.filter((visibility) => !isPublished(visibility))).toEqual([
      'private',
      'team',
    ]);
  });

  it('keeps the workspace audiences apart from the ones that reach outside', () => {
    expect(DOC_VISIBILITIES.filter(isExternallyShared)).toEqual(['link', 'public']);
    expect(DOC_VISIBILITIES.filter(isWorkspaceShared).some(isExternallyShared)).toBe(false);
    expect(DOC_VISIBILITIES.filter(isRestricted)).toEqual(['private', 'team']);
  });
});
