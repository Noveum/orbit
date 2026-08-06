import { z } from 'zod';
import { VIEW_LAYOUT_MODES, VIEW_PAGES } from '../filters/index.ts';

export const viewPreferenceSchema = z.object({
  page: z.enum(VIEW_PAGES),
  scope: z.string().max(64).default(''),
  layout: z.enum(VIEW_LAYOUT_MODES),
  display: z.record(z.string(), z.unknown()).default({}),
});

export type ViewPreferenceInput = z.input<typeof viewPreferenceSchema>;
export type ViewPreference = z.output<typeof viewPreferenceSchema>;
