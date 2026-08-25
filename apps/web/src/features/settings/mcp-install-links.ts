export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/';
export const CHATGPT_CONNECTORS_URL = 'https://chatgpt.com/';

function toBase64(value: string): string {
  if (typeof btoa === 'function') return btoa(value);
  return Buffer.from(value, 'utf8').toString('base64');
}

export function claudeCodeCommand(mcpUrl: string): string {
  return `claude mcp add --scope user --transport http orbit ${mcpUrl}`;
}

export function cursorInstallHref(mcpUrl: string): string {
  const config = toBase64(JSON.stringify({ url: mcpUrl }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=orbit&config=${config}`;
}

export function vscodeInstallHref(mcpUrl: string): string {
  const config = JSON.stringify({ name: 'orbit', type: 'http', url: mcpUrl });
  return `vscode:mcp/install?${encodeURIComponent(config)}`;
}

export type McpConnectAction =
  | { readonly kind: 'open'; readonly href: string }
  | { readonly kind: 'deeplink'; readonly href: string }
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'url'; readonly url: string };

export interface McpClient {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly action: McpConnectAction;
  readonly steps: readonly string[];
}

const APPROVE_STEP = 'Sign in to Orbit, pick a workspace, and approve.';

export function mcpClients(mcpUrl: string): readonly McpClient[] {
  return [
    {
      id: 'claude',
      name: 'Claude',
      summary: 'Claude on the web, desktop, and mobile, through a custom connector.',
      action: { kind: 'open', href: CLAUDE_CONNECTORS_URL },
      steps: [
        'We copy the server URL and open Claude in a new tab.',
        'On an individual plan, open Customize, then Connectors, choose +, and select Add custom connector.',
        'On Team or Enterprise, an owner adds it under Organization settings, then Connectors.',
        'Paste the URL, then sign in to Orbit, pick a workspace, and approve.',
      ],
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      summary: 'A custom app in ChatGPT web for eligible plans and workspace roles.',
      action: { kind: 'open', href: CHATGPT_CONNECTORS_URL },
      steps: [
        'We copy the server URL and open ChatGPT in a new tab.',
        'On Business, an admin or owner opens Workspace settings, then Apps, chooses Create, and enables developer mode there.',
        'On Enterprise or Edu, an admin grants access, then an enabled member turns on developer mode under Settings, Apps, then Advanced settings.',
        'Choose Create under Workspace settings, then Apps, or under Settings, then Apps if your role allows it, and paste the URL.',
        'Create the app, then sign in to Orbit, pick a workspace, and approve.',
      ],
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      summary: 'Add Orbit once and every session on this machine can reach it.',
      action: { kind: 'command', command: claudeCodeCommand(mcpUrl) },
      steps: ['Run the command in any terminal.', APPROVE_STEP],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      summary: 'Opens Cursor with the server already filled in.',
      action: { kind: 'deeplink', href: cursorInstallHref(mcpUrl) },
      steps: ['Confirm the server Cursor offers to install.', APPROVE_STEP],
    },
    {
      id: 'vscode',
      name: 'VS Code',
      summary: 'Opens VS Code with the server already filled in.',
      action: { kind: 'deeplink', href: vscodeInstallHref(mcpUrl) },
      steps: ['Confirm the server VS Code offers to install.', APPROVE_STEP],
    },
    {
      id: 'other',
      name: 'Other remote clients',
      summary: 'For clients that support remote HTTP MCP servers and OAuth.',
      action: { kind: 'url', url: mcpUrl },
      steps: [
        'Open the client MCP settings and add a remote HTTP server.',
        'Paste the copied URL as the server endpoint.',
        APPROVE_STEP,
      ],
    },
  ];
}
