export const DEMO_ORGANIZATION_ID = 'org_orbit_demo';
export const DEMO_WORKSPACE_TIMEZONE = 'Etc/UTC';

export function demoOrganizationValues(createdAt: Date) {
  return {
    id: DEMO_ORGANIZATION_ID,
    name: 'Orbit Demo',
    slug: 'orbit-demo',
    logo: null,
    allowedEmailDomains: ['orbit.example'],
    createdAt,
  };
}
