export const ACTOR_TYPES = ['user', 'integration', 'agent', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
