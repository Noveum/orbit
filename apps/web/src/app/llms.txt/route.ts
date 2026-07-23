import { serverEnv } from '@/lib/env.ts';

export function GET(): Response {
  const base = serverEnv().NEXT_PUBLIC_APP_URL;
  const body = `# Orbit

> Orbit is a free, realtime, keyboard-first work tracker for teams. It covers issues, boards, cycles and sprints, projects, and docs with a rich editor. Every change syncs instantly to every open screen over WebSockets. There is no pricing, no billing, and no paid tier: the whole product is free, forever.

## Capabilities

- Issues with priorities, labels, states, and assignees, shown as fast lists or drag-and-drop boards
- Cycles and sprints for timeboxed planning
- Projects that group related work
- Docs with a rich editor, living beside the issues they describe
- Realtime sync: edits commit to Postgres, publish to Redis, and fan out over WebSockets
- Command palette and keyboard shortcuts for every action
- Filters and saved views shared across the team
- GitHub and Slack integrations
- Notifications inbox
- MCP server, so agents can read the board, file issues, and update work

## Links

- [Landing page](${base}/)
- [Sign in](${base}/login) with Google, GitHub, a passkey, or a magic link
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
