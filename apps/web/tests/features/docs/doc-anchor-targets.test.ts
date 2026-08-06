import { describe, expect, it } from 'bun:test';
import { buildDocAnchor } from '@orbit/shared/utils';
import type { DocCommentAnchor } from '@orbit/shared/validators';
import { anchorState } from '../../../src/features/docs/doc-comments.tsx';
import { anchorTargetsOf } from '../../../src/features/docs/doc-surface.tsx';

const text = 'Launch plan\nThe launch is blocked on the migration.\nWe meet on Thursday.';
const passage = 'blocked on the migration';
const anchor = buildDocAnchor(text, text.indexOf(passage), text.indexOf(passage) + passage.length);

function entry(id: string, value: DocCommentAnchor | null) {
  return { comment: { id, anchor: value } };
}

describe('anchorTargetsOf', () => {
  it('keeps only the comments that point at a passage', () => {
    const targets = anchorTargetsOf([
      entry('c_plain', null),
      entry('c_anchored', anchor),
      entry('c_other', null),
    ]);

    expect(targets).toEqual([{ commentId: 'c_anchored', anchor }]);
  });

  it('is empty while the thread has not loaded', () => {
    expect(anchorTargetsOf([])).toEqual([]);
  });
});

describe('anchorState', () => {
  it('says nothing for a comment on the whole document', () => {
    expect(anchorState(null, text)).toBe('none');
  });

  it('finds a passage that is still in the document', () => {
    expect(anchorState(anchor, text)).toBe('found');
  });

  it('calls the passage orphaned once the text is gone', () => {
    expect(anchorState(anchor, 'Launch plan\nThe launch is on track.')).toBe('orphaned');
  });

  it('never guesses orphaned before the document text is known', () => {
    expect(anchorState(anchor, null)).toBe('found');
  });
});
