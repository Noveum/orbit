import { z } from 'zod';

export const UNAUTHORIZED_CLOSE_CODE = 4001;
export const ORGANIZATION_FORBIDDEN_CLOSE_CODE = 4003;

export const connectionOrganizationIdSchema = z.string().min(1).max(128);

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 75_000;
