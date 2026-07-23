import { internal } from '@orbit/shared';

export interface ResolvedCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly expiresAt?: number;
}

export interface StaticCredentials {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
}

const REFRESH_MARGIN_MS = 20 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
const SESSION_NAME = 'orbit-storage';

function extract(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1] ?? null;
}

async function assumeWebIdentityRole(
  roleArn: string,
  tokenFile: string,
  region: string,
): Promise<ResolvedCredentials> {
  const token = (await Bun.file(tokenFile).text()).trim();
  const endpoint = `https://sts.${region}.amazonaws.com/`;
  const body = new URLSearchParams({
    Action: 'AssumeRoleWithWebIdentity',
    Version: '2011-06-15',
    RoleArn: roleArn,
    RoleSessionName: SESSION_NAME,
    WebIdentityToken: token,
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/xml' },
    body,
  });
  const xml = await response.text();
  if (!response.ok) {
    throw internal(`Could not assume the storage role: ${response.status} ${xml.slice(0, 200)}`);
  }
  const accessKeyId = extract(xml, 'AccessKeyId');
  const secretAccessKey = extract(xml, 'SecretAccessKey');
  const sessionToken = extract(xml, 'SessionToken');
  const expiration = extract(xml, 'Expiration');
  if (accessKeyId === null || secretAccessKey === null || sessionToken === null) {
    throw internal('The storage role response did not include credentials.');
  }
  const parsedExpiry = expiration === null ? Number.NaN : Date.parse(expiration);
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiresAt: Number.isNaN(parsedExpiry) ? Date.now() + DEFAULT_SESSION_TTL_MS : parsedExpiry,
  };
}

export function createCredentialResolver(
  region: string,
  configured: StaticCredentials,
  env: NodeJS.ProcessEnv = process.env,
): () => Promise<ResolvedCredentials | undefined> {
  if (configured.accessKeyId !== undefined && configured.secretAccessKey !== undefined) {
    const fixed: ResolvedCredentials = {
      accessKeyId: configured.accessKeyId,
      secretAccessKey: configured.secretAccessKey,
      ...(configured.sessionToken === undefined ? {} : { sessionToken: configured.sessionToken }),
    };
    return () => Promise.resolve(fixed);
  }

  const roleArn = env['AWS_ROLE_ARN']?.trim();
  const tokenFile = env['AWS_WEB_IDENTITY_TOKEN_FILE']?.trim();
  if (
    roleArn === undefined ||
    roleArn.length === 0 ||
    tokenFile === undefined ||
    tokenFile.length === 0
  ) {
    return () => Promise.resolve(undefined);
  }

  let cached: ResolvedCredentials | null = null;
  let inflight: Promise<ResolvedCredentials> | null = null;

  const usable = (credentials: ResolvedCredentials | null): credentials is ResolvedCredentials =>
    credentials !== null &&
    (credentials.expiresAt === undefined || Date.now() < credentials.expiresAt);

  const stale = (): boolean => {
    if (cached === null) return true;
    if (cached.expiresAt === undefined) return false;
    return Date.now() >= cached.expiresAt - REFRESH_MARGIN_MS;
  };

  return async () => {
    if (!stale()) return cached ?? undefined;
    if (inflight === null) {
      inflight = assumeWebIdentityRole(roleArn, tokenFile, region).finally(() => {
        inflight = null;
      });
    }
    try {
      cached = await inflight;
    } catch (error) {
      if (usable(cached)) return cached;
      throw error;
    }
    return cached;
  };
}
