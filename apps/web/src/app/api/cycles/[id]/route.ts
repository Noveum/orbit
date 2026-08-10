import { deleteCycle, getCycle, shiftFollowingCycles, updateCycle } from '@orbit/core';
import { cycleEditSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, publish, readJson, routeId } from '@/lib/api/handler.ts';

const DAY = 86_400_000;

function daysMoved(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY);
}

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'sprint');
    return { cycle: await getCycle(principal, id) };
  });
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'sprint');
    const { shiftFollowing, ...patch } = cycleEditSchema.parse(await readJson(request));

    const before = await getCycle(principal, id);
    const days =
      shiftFollowing === true && patch.endsAt !== undefined
        ? daysMoved(before.endsAt, patch.endsAt)
        : 0;

    const moved =
      days === 0
        ? { actions: [] }
        : await shiftFollowingCycles(principal, id, { after: before.endsAt, days });

    const result = await updateCycle(principal, id, patch);
    await publish([...moved.actions, ...result.actions]);
    return { cycle: result.cycle };
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const id = routeId((await params).id, 'sprint');
    await publish(await deleteCycle(principal, id));
    return { deleted: true };
  });
}
