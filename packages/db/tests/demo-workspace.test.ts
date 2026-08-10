import { describe, expect, it } from 'bun:test';
import {
  DEMO_ORGANIZATION_ID,
  DEMO_WORKSPACE_TIMEZONE,
  demoOrganizationValues,
} from '../src/demo-workspace.ts';
import { SEED_USERS } from '../src/seed/data.ts';

describe('demo workspace', () => {
  it('defines the neutral Orbit organization and seeded user matrix', () => {
    const createdAt = new Date('2026-08-08T00:00:00.000Z');

    expect(DEMO_ORGANIZATION_ID).toBe('org_orbit_demo');
    expect(DEMO_WORKSPACE_TIMEZONE).toBe('Etc/UTC');
    expect(demoOrganizationValues(createdAt)).toEqual({
      id: 'org_orbit_demo',
      name: 'Orbit Demo',
      slug: 'orbit-demo',
      logo: null,
      allowedEmailDomains: ['orbit.example'],
      createdAt,
    });
    expect(SEED_USERS).toEqual([
      {
        handle: 'alex',
        name: 'Alex Morgan',
        email: 'alex@orbit.example',
        role: 'admin',
        teams: ['ENG', 'DES', 'MKT'],
      },
      {
        handle: 'sam',
        name: 'Sam Rivera',
        email: 'sam@orbit.example',
        role: 'admin',
        teams: ['ENG', 'MKT'],
      },
      {
        handle: 'jordan',
        name: 'Jordan Lee',
        email: 'jordan@orbit.example',
        role: 'member',
        teams: ['ENG', 'DES'],
      },
      {
        handle: 'taylor',
        name: 'Taylor Kim',
        email: 'taylor@orbit.example',
        role: 'member',
        teams: ['MKT'],
      },
      {
        handle: 'casey',
        name: 'Casey Chen',
        email: 'casey@orbit.example',
        role: 'member',
        teams: ['ENG', 'DES'],
      },
      {
        handle: 'robin',
        name: 'Robin Park',
        email: 'robin@orbit.example',
        role: 'contributor',
        teams: ['ENG'],
      },
      {
        handle: 'drew',
        name: 'Drew Ellis',
        email: 'drew@orbit.example',
        role: 'guest',
        teams: ['MKT'],
      },
    ]);
  });
});
