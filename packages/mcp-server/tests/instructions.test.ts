import { describe, expect, it } from 'bun:test';
import { layerInstructions } from '../src/instructions.ts';

describe('layerInstructions', () => {
  it('returns empty string when all layers are empty or whitespace', () => {
    expect(layerInstructions({})).toBe('');
    expect(layerInstructions({ workspace: '', team: '', project: '' })).toBe('');
    expect(layerInstructions({ workspace: '   ', team: '\n\t  ', project: ' ' })).toBe('');
  });

  it('layers workspace, team, and project instructions with markdown headings', () => {
    const result = layerInstructions({
      workspace: 'Workspace guidance.',
      team: 'Team guidance.',
      project: 'Project guidance.',
    });
    expect(result).toBe(
      '## Workspace\n\nWorkspace guidance.\n\n## Team\n\nTeam guidance.\n\n## Project\n\nProject guidance.',
    );
  });

  it('omits sections whose instructions are missing or empty', () => {
    const withoutTeam = layerInstructions({
      workspace: 'Workspace guidance.',
      project: 'Project guidance.',
    });
    expect(withoutTeam).toBe(
      '## Workspace\n\nWorkspace guidance.\n\n## Project\n\nProject guidance.',
    );

    const teamOnly = layerInstructions({
      team: 'Team conventions.',
    });
    expect(teamOnly).toBe('## Team\n\nTeam conventions.');
  });

  it('trims whitespace around each layer content', () => {
    const result = layerInstructions({
      workspace: '  Trimmed workspace.  \n',
      team: '\n  Trimmed team.  ',
    });
    expect(result).toBe('## Workspace\n\nTrimmed workspace.\n\n## Team\n\nTrimmed team.');
  });
});
