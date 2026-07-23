export interface MembershipCandidate {
  readonly organizationId: string;
  readonly createdAt: Date;
}

function oldestFirst(left: MembershipCandidate, right: MembershipCandidate): number {
  return (
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.organizationId.localeCompare(right.organizationId)
  );
}

export function selectActiveMembership<T extends MembershipCandidate>(
  memberships: readonly T[],
  activeOrganizationId: string | null,
): T | undefined {
  const stated =
    activeOrganizationId === null
      ? undefined
      : memberships.find((row) => row.organizationId === activeOrganizationId);
  return stated ?? [...memberships].sort(oldestFirst)[0];
}
