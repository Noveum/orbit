import { afterEach, beforeEach, expect, it } from 'bun:test';
import { GET } from '@/app/api/auth/[...all]/route.ts';
import {
  readCfLikeWorkerd,
  requestWithoutCf,
} from '../../../../lib/auth/workerd-request.fixture.ts';

let restore: () => void = () => undefined;

beforeEach(() => {
  restore = readCfLikeWorkerd();
});

afterEach(() => {
  restore();
});

it('answers get-session for a request that arrived through a service binding', async () => {
  const response = await GET(
    requestWithoutCf(new Request('http://localhost:3000/api/auth/get-session')),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
});
