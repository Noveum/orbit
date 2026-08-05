import { describe, expect, it } from 'bun:test';
import { adoptsRemoteEdit } from '../../../src/features/docs/doc-surface.tsx';

const seen = { title: 'Deploy runbook', content: 'How we ship.' };

describe('an always-open editor meeting someone else edit', () => {
  it('takes the newer version when the local draft has nothing unsaved', () => {
    const incoming = { title: 'Deploy runbook', content: 'How we ship, revised.' };
    expect(adoptsRemoteEdit(true, seen, incoming)).toBe(true);
  });

  it('keeps what the author is typing rather than overwriting it mid sentence', () => {
    const incoming = { title: 'Deploy runbook', content: 'How we ship, revised.' };
    expect(adoptsRemoteEdit(false, seen, incoming)).toBe(false);
  });

  it('does nothing when the doc comes back unchanged, so the caret never jumps', () => {
    expect(adoptsRemoteEdit(true, seen, { ...seen })).toBe(false);
  });

  it('notices a rename on its own, not only a body change', () => {
    const incoming = { title: 'Deploy runbook v2', content: 'How we ship.' };
    expect(adoptsRemoteEdit(true, seen, incoming)).toBe(true);
  });
});
