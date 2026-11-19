import { expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const CLOUD_REGION_OF_VERCEL_REGION: Readonly<Record<string, string>> = {
  cle1: 'aws:us-east-2',
  iad1: 'aws:us-east-1',
  pdx1: 'aws:us-west-2',
  sfo1: 'aws:us-west-1',
  hnd1: 'aws:ap-northeast-1',
  kix1: 'aws:ap-northeast-3',
  icn1: 'aws:ap-northeast-2',
  sin1: 'aws:ap-southeast-1',
  syd1: 'aws:ap-southeast-2',
  bom1: 'aws:ap-south-1',
  fra1: 'aws:eu-central-1',
  dub1: 'aws:eu-west-1',
  lhr1: 'aws:eu-west-2',
  cdg1: 'aws:eu-west-3',
  arn1: 'aws:eu-north-1',
  gru1: 'aws:sa-east-1',
};

const vercelSchema = z.object({ regions: z.array(z.string()).length(1) });
const wranglerSchema = z.object({ placement: z.object({ region: z.string() }) });

async function readConfig(relative: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
}

it('places the Node build and the Workers build in the same cloud region', async () => {
  const vercel = vercelSchema.parse(await readConfig('../../../vercel.json'));
  const wrangler = wranglerSchema.parse(await readConfig('../../../wrangler.jsonc'));
  const [functionRegion] = vercel.regions;
  expect(functionRegion).toBeDefined();
  expect(CLOUD_REGION_OF_VERCEL_REGION[functionRegion ?? '']).toBe(wrangler.placement.region);
});
