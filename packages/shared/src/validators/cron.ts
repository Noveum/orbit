import { z } from 'zod';

export const cronAuthorizationSchema = z.string().regex(/^Bearer .+$/);
