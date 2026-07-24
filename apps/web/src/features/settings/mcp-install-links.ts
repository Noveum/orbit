function toBase64(value: string): string {
  if (typeof btoa === 'function') return btoa(value);
  return Buffer.from(value, 'utf8').toString('base64');
}

export function claudeCodeCommand(mcpUrl: string): string {
  return `claude mcp add --transport http orbit ${mcpUrl}`;
}

export function cursorInstallHref(mcpUrl: string): string {
  const config = toBase64(JSON.stringify({ url: mcpUrl }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=orbit&config=${config}`;
}

export function vscodeInstallHref(mcpUrl: string): string {
  const config = JSON.stringify({ name: 'orbit', type: 'http', url: mcpUrl });
  return `vscode:mcp/install?${encodeURIComponent(config)}`;
}

export function mcpClientConfigJson(mcpUrl: string): string {
  return JSON.stringify({ mcpServers: { orbit: { type: 'http', url: mcpUrl } } }, null, 2);
}
