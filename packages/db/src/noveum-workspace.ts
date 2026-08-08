export const NOVEUM_IMPORT_ORGANIZATION_ID = 'org_noveum';
export const NOVEUM_SEED_ORGANIZATION_ID = 'org_noveum_demo';

export function noveumOrganizationValues(id: string, createdAt: Date) {
  return {
    id,
    name: 'Noveum',
    slug: 'noveum',
    logo: null,
    allowedEmailDomains: ['noveum.ai', 'yodu.ai'],
    createdAt,
  };
}
