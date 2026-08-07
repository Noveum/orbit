import { absoluteUrl, publicAppUrl } from '@/lib/env.ts';

export function GET(): Response {
  const base = publicAppUrl();
  const body = `# Orbit

> Orbit is a free, open source, keyboard-first work tracker for teams. It covers issues, boards, sprints, projects, and docs with a rich editor. Every change syncs instantly to every open screen over WebSockets. There is no pricing, no billing, and no paid tier: the whole product is free, forever. It is licensed Apache-2.0 and can be self-hosted.

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

## Open source

- Licensed Apache-2.0, sponsored by Noveum AI
- Source: https://github.com/Noveum/orbit
- Self-hostable on Vercel with Postgres, Redis, and an S3-compatible bucket

## Links

- [Landing page](${base}/)
- [Sign in](${absoluteUrl('/login')}) with Google, GitHub, a passkey, or a magic link
- [Source code](https://github.com/Noveum/orbit)
- [Documentation](https://github.com/Noveum/orbit/tree/main/docs)
- [Self-hosting guide](https://github.com/Noveum/orbit/blob/main/docs/self-hosting.md)
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
