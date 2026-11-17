import { SLUG_PATTERN } from '@orbit/shared/constants';
import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/next-path.ts';
import { pageMetadata } from '@/lib/page-metadata.ts';

export function safeCallback(value: string | string[] | undefined): string | undefined {
  return safeNextPath(value) ?? undefined;
}

const MCP_AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'prompt',
  'nonce',
  'resource',
  'max_age',
  'claims',
  'exp',
  'sig',
  'ba_iat',
  'ba_pl',
  'ba_param',
] as const;

export function mcpContinueUrl(
  params: Record<string, string | string[] | undefined>,
): string | undefined {
  if (typeof params['client_id'] !== 'string' || typeof params['response_type'] !== 'string') {
    return undefined;
  }
  const search = new URLSearchParams();
  for (const key of MCP_AUTHORIZE_PARAMS) {
    const value = params[key];
    if (typeof value === 'string' && value.length > 0) search.set(key, value);
    else if (Array.isArray(value)) for (const item of value) search.append(key, item);
  }
  return `/api/auth/mcp/authorize?${search.toString()}`;
}

export function mcpLoginRequiresAuthentication(
  params: Record<string, string | string[] | undefined>,
): boolean {
  if (typeof params['client_id'] !== 'string' || typeof params['response_type'] !== 'string')
    return false;
  const prompt = typeof params['prompt'] === 'string' ? params['prompt'].split(/\s+/) : [];
  return (
    typeof params['max_age'] === 'string' || prompt.includes('login') || prompt.includes('create')
  );
}

const ISSUE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{1,5}-[1-9]\d{0,8}$/;
const PROJECT_TABS = new Set(['issues', 'activity', 'settings']);
const LONGEST_PROJECT_SLUG = 80;

export function loginMetadata(next: string | string[] | undefined): Metadata {
  const path = safeNextPath(next)?.split('?')[0] ?? '';
  const [, section, name = '', tab, ...deeper] = path.split('/');
  if (deeper.length > 0) return { title: 'Sign in' };
  if (section === 'issue' && tab === undefined && ISSUE_IDENTIFIER.test(name)) {
    return pageMetadata(name.toUpperCase(), `/issue/${name.toUpperCase()}`);
  }
  if (
    section === 'projects' &&
    name.length <= LONGEST_PROJECT_SLUG &&
    SLUG_PATTERN.test(name) &&
    (tab === undefined || PROJECT_TABS.has(tab))
  ) {
    return pageMetadata(name, path);
  }
  return { title: 'Sign in' };
}
