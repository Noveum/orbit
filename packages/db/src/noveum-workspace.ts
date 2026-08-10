export const NOVEUM_IMPORT_ORGANIZATION_ID = 'org_noveum';

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
