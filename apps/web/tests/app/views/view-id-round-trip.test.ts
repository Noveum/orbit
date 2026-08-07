import { describe, expect, it } from 'bun:test';
import { viewIdFrom } from '@/app/(app)/views/[id]/page.tsx';
import { savedViewPath } from '@/features/views/view-href.ts';

function segmentOf(path: string): string {
  return path.split('/').at(-1) ?? '';
}

describe('the saved view route', () => {
  it('reads back every built in id the href builder writes', () => {
    for (const id of [
      'virtual:all',
      'virtual:assigned',
      'virtual:created',
      'virtual:subscribed',
      'virtual:unassigned',
      'virtual:overdue',
    ]) {
      expect(viewIdFrom(segmentOf(savedViewPath(id)))).toBe(id);
    }
  });

  it('reads back a plain saved view id untouched', () => {
    const id = '0b3a7c1e-9f2d-4a55-8c17-2e6d5b9a4f30';
    expect(viewIdFrom(segmentOf(savedViewPath(id)))).toBe(id);
  });

  it('survives a segment that is not valid percent encoding', () => {
    expect(viewIdFrom('100%')).toBe('100%');
    expect(viewIdFrom('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
