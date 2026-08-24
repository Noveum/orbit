export const ORG_ROLES = ['admin', 'member', 'contributor', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const AGENT_INSTRUCTIONS_MAX_LENGTH = 4000;

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  admin: 3,
  member: 2,
  contributor: 1,
  guest: 0,
};
