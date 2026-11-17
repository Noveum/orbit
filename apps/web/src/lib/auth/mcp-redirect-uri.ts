import { isLoopbackHost } from '@better-auth/core/utils/host';
import {
  isNativePrivateUseRedirectUri,
  RedirectUriSyntaxSchema,
} from '@better-auth/core/utils/redirect-uri';

export function isSafeMcpRedirectUri(value: string): boolean {
  if (!RedirectUriSyntaxSchema.safeParse(value).success) return false;
  const uri = new URL(value);
  if (uri.username.length > 0 || uri.password.length > 0) return false;
  if (uri.protocol === 'https:') return true;
  if (uri.protocol === 'http:') return isLoopbackHost(uri.host);
  return isNativePrivateUseRedirectUri(uri);
}
