import { z } from 'zod';

export const storagePathStyleSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
