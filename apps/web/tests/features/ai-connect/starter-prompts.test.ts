import { describe, expect, it } from 'bun:test';
import {
  IMPORT_SOURCE_GUIDES,
  IMPORT_SOURCES,
  STARTER_KINDS,
  starterPrompt,
} from '@/features/ai-connect/starter-prompts.ts';

describe('starterPrompt', () => {
  it('names the tool being imported from and uses its reading instructions', () => {
    const prompt = starterPrompt('import', 'trello');
    expect(prompt).toContain('move my work in from Trello.');
    expect(prompt).toContain(IMPORT_SOURCE_GUIDES.trello.reading);
    expect(prompt).not.toContain(IMPORT_SOURCE_GUIDES.linear.reading);
  });

  it('asks about the source instead of naming one when the tool is something else', () => {
    const prompt = starterPrompt('import', 'other');
    expect(prompt).toContain('from another tool.');
    expect(prompt).not.toContain('Something else');
  });

  it('gives every source its own reading instructions', () => {
    const readings = new Set(IMPORT_SOURCES.map((source) => starterPrompt('import', source)));
    expect(readings.size).toBe(IMPORT_SOURCES.length);
  });

  it('keeps every prompt grounded in the workspace and gated on the user approving a plan', () => {
    for (const kind of STARTER_KINDS) {
      const prompt = starterPrompt(kind, 'linear');
      expect(prompt).toContain('get_me');
      expect(prompt).toContain('list_teams');
      expect(prompt).toContain('create_issue');
      expect(prompt).toMatch(/wait for my OK/i);
      expect(prompt).toMatch(/^1\. /m);
    }
  });

  it('interviews the user when brainstorming and reads the code when building a backlog', () => {
    expect(starterPrompt('plan')).toContain('Interview me');
    expect(starterPrompt('plan')).toContain('create_cycle');
    expect(starterPrompt('repo')).toContain('TODO and FIXME');
  });

  it('never contains an em dash', () => {
    for (const kind of STARTER_KINDS) {
      for (const source of IMPORT_SOURCES) {
        expect(starterPrompt(kind, source)).not.toContain(String.fromCharCode(0x2014));
      }
    }
  });
});
