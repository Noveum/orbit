import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { AiCredentialEnvelope } from '@orbit/shared/validators';

const ALGORITHM = 'aes-256-gcm';
const EMPTY_SALT = '';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(secret: string, info: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hkdfSync('sha256', secret, EMPTY_SALT, info, 32));
}

function decodeBase64Url(
  value: string,
  onError: (cause?: unknown) => Error,
): Uint8Array<ArrayBuffer> {
  const decoded = Uint8Array.from(Buffer.from(value, 'base64url'));
  if (Buffer.from(decoded).toString('base64url') !== value) throw onError();
  return decoded;
}

function encodeBase64Url(value: Uint8Array<ArrayBufferLike>): string {
  return Buffer.from(value).toString('base64url');
}

function joinBytes(parts: readonly Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export function encryptCredentialEnvelope(
  plaintext: string,
  info: string,
  aad: Uint8Array,
  onError: (cause?: unknown) => Error,
): AiCredentialEnvelope {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (secret === undefined || secret.length === 0) throw onError();
  try {
    const key = encryptionKey(secret, info);
    const iv = Uint8Array.from(randomBytes(IV_BYTES));
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = joinBytes([
      Uint8Array.from(cipher.update(plaintext, 'utf8')),
      Uint8Array.from(cipher.final()),
    ]);
    return {
      version: 1,
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(ciphertext),
      tag: encodeBase64Url(Uint8Array.from(cipher.getAuthTag())),
    };
  } catch (error) {
    throw onError(error);
  }
}

export function decryptCredentialEnvelope(
  envelope: AiCredentialEnvelope,
  info: string,
  aad: Uint8Array,
  onError: (cause?: unknown) => Error,
): string {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (secret === undefined || secret.length === 0) throw onError();
  try {
    const key = encryptionKey(secret, info);
    const iv = decodeBase64Url(envelope.iv, onError);
    const tag = decodeBase64Url(envelope.tag, onError);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw onError();
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return new TextDecoder().decode(
      joinBytes([
        Uint8Array.from(decipher.update(decodeBase64Url(envelope.ciphertext, onError))),
        Uint8Array.from(decipher.final()),
      ]),
    );
  } catch (error) {
    throw onError(error);
  }
}
