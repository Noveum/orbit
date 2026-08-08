import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  buildIssueRoutesWorld,
  forgetUploads,
  type IssueRoutesWorld,
  installRouteMocks,
  PRESIGN_URL,
  signInAs,
  uploadsRegistered,
} from '../../../../../tests-support-issue-routes.ts';

const presign = await import('../../../../../src/app/api/attachments/presign/route.ts');

let world: IssueRoutesWorld;

beforeAll(async () => {
  world = await buildIssueRoutesWorld();
});

beforeEach(() => {
  installRouteMocks();
  signInAs(world.admin);
  forgetUploads();
});

function presignRequest(parentId: string): Request {
  return new Request(PRESIGN_URL, {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'trace.log',
      contentType: 'text/plain',
      size: 24,
      parentType: 'comment',
      parentId,
    }),
  });
}

describe('POST /api/attachments/presign', () => {
  it('registers an upload against a comment the caller can read', async () => {
    const response = await presign.POST(presignRequest(world.openCommentId));

    expect(response.status).toBe(200);
    const payload = z
      .object({
        attachment: z.object({ parentType: z.string(), parentId: z.string() }),
        upload: z.object({ key: z.string(), method: z.literal('PUT') }),
      })
      .parse(await response.json());
    expect(payload.attachment).toEqual({
      parentType: 'comment',
      parentId: world.openCommentId,
    });
    expect(uploadsRegistered()).toHaveLength(1);
  });

  it('refuses a comment on an issue the caller cannot see', async () => {
    signInAs(world.outsider);

    const response = await presign.POST(presignRequest(world.hiddenCommentId));

    expect(response.status).toBe(404);
    expect(uploadsRegistered()).toHaveLength(0);
  });

  it('refuses a guest, whose role cannot upload', async () => {
    signInAs(world.guest);

    const response = await presign.POST(presignRequest(world.openCommentId));

    expect(response.status).toBe(403);
    expect(uploadsRegistered()).toHaveLength(0);
  });
});
