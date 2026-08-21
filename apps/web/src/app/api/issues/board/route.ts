import { listBoardGroups } from '@orbit/core';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';
import { attachIssueDecorations } from '@/lib/api/issues.ts';

export async function GET(request: Request): Promise<Response> {
  const params = searchParamsOf(request);
  return await handle(async (principal) => {
    const page = await listBoardGroups(principal, params);
    const issues = await attachIssueDecorations(page.groups.flatMap((group) => group.issues));
    let offset = 0;
    const groups = page.groups.map((group) => {
      const decorated = issues.slice(offset, offset + group.issues.length);
      offset += group.issues.length;
      return { ...group, issues: decorated };
    });
    return { ...page, groups };
  });
}
