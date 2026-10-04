import { describe, expect, it } from 'bun:test';
import { generateMetadata } from '@/app/(app)/issue/[identifier]/page.tsx';

describe('the issue page metadata', () => {
  it('puts the identifier on the share cards instead of the landing title', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ identifier: 'eng-1' }) });
    expect(meta.title).toBe('ENG-1');
    expect(meta.openGraph?.title).toBe('ENG-1 · Orbit');
    expect(meta.twitter?.title).toBe('ENG-1 · Orbit');
    expect(meta.openGraph?.url).toBe('/issue/ENG-1');
    expect(JSON.stringify(meta)).not.toContain('keyboard-first');
  });
});
