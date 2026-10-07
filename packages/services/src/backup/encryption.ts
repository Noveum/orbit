import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validationFailed } from '@orbit/shared';

export const ENCRYPTION_MAGIC = Buffer.from('ORBITENC', 'utf8');
export const ENCRYPTION_MAGIC_LENGTH = 8;
export const ENCRYPTION_IV_LENGTH = 12;
export const ENCRYPTION_TAG_LENGTH = 16;
export const ENCRYPTION_HEADER_LENGTH = ENCRYPTION_MAGIC_LENGTH + ENCRYPTION_IV_LENGTH;
export const MIN_ENCRYPTED_FILE_SIZE = ENCRYPTION_HEADER_LENGTH + ENCRYPTION_TAG_LENGTH;

export interface SecretSourceOptions {
  readonly key?: string | undefined;
  readonly keyFile?: string | undefined;
  readonly command?: string | undefined;
  readonly keyId?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
}

export interface EncryptedKeyEnvelope {
  readonly encryptedDek: string;
  readonly dekIv: string;
  readonly dekTag: string;
  readonly keyId: string;
}

export interface EncryptFileResult {
  readonly bytes: number;
  readonly sha256: string;
  readonly plaintextBytes: number;
  readonly plaintextSha256: string;
}

export interface DecryptFileResult {
  readonly bytes: number;
  readonly sha256: string;
}

function tokenizeCommand(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (const char of raw) {
    if (inQuote !== null) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseCommand(raw: string): { executable: string; args: string[] } {
  const tokens = tokenizeCommand(raw);
  const [executable, ...args] = tokens;
  if (executable === undefined || executable.length === 0) {
    throw validationFailed('Secret source helper command is empty.');
  }

  return { executable, args };
}

export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw validationFailed('Encryption key material must not be empty.');
  }

  if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  if (trimmed.length === 44 && /^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    const candidate = Buffer.from(trimmed, 'base64');
    if (candidate.length === 32) {
      return candidate;
    }
  }

  throw validationFailed(
    'Encryption key must be a valid 32-byte key encoded as 64-character hex or 44-character base64.',
  );
}

async function resolveFileKey(filePath: string): Promise<Buffer> {
  let fileContent: string;
  try {
    fileContent = await readFile(filePath.trim(), 'utf8');
  } catch (error) {
    throw validationFailed(`Failed to read backup encryption key file: ${filePath}`, {
      cause: error,
    });
  }
  return parseEncryptionKey(fileContent);
}

function resolveCommandKey(command: string): Buffer {
  const { executable, args } = parseCommand(command.trim());
  try {
    const result = spawnSync(executable, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      shell: false,
    });
    if (result.error !== undefined || result.status !== 0) {
      throw validationFailed('Secret source helper command for backup encryption failed.');
    }
    return parseEncryptionKey(result.stdout ?? '');
  } catch (error) {
    if (error instanceof Error && error.name === 'DomainError') {
      throw error;
    }
    throw validationFailed('Secret source helper command for backup encryption failed.');
  }
}

export async function resolveMasterEncryptionKey(options: SecretSourceOptions): Promise<{
  key: Buffer;
  keyId: string;
}> {
  const env = options.env ?? process.env;
  const keyId = options.keyId ?? env['ORBIT_BACKUP_ENCRYPTION_KEY_ID'] ?? 'default';

  if (options.key !== undefined && options.key.trim().length > 0) {
    return { key: parseEncryptionKey(options.key), keyId };
  }

  const envKey = env['ORBIT_BACKUP_ENCRYPTION_KEY'];
  if (envKey !== undefined && envKey.trim().length > 0) {
    return { key: parseEncryptionKey(envKey), keyId };
  }

  const keyFilePath = options.keyFile ?? env['ORBIT_BACKUP_ENCRYPTION_KEY_FILE'];
  if (keyFilePath !== undefined && keyFilePath.trim().length > 0) {
    return { key: await resolveFileKey(keyFilePath), keyId };
  }

  const command = options.command ?? env['ORBIT_BACKUP_ENCRYPTION_COMMAND'];
  if (command !== undefined && command.trim().length > 0) {
    return { key: resolveCommandKey(command), keyId };
  }

  throw validationFailed(
    'Backup encryption requested but no encryption key or secret source was provided.',
  );
}

export function createEnvelopeDataKey(
  kek: Buffer,
  keyId: string,
): {
  dek: Buffer;
  envelope: EncryptedKeyEnvelope;
} {
  const dek = randomBytes(32);
  const dekIv = randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', kek, dekIv);
  const encryptedDekBuffer = Buffer.concat([cipher.update(dek), cipher.final()]);
  const dekTag = cipher.getAuthTag();

  return {
    dek,
    envelope: {
      encryptedDek: encryptedDekBuffer.toString('base64'),
      dekIv: dekIv.toString('base64'),
      dekTag: dekTag.toString('base64'),
      keyId,
    },
  };
}

export function decryptEnvelopeDataKey(
  kek: Buffer,
  envelope: {
    readonly encryptedDek: string;
    readonly dekIv: string;
    readonly dekTag: string;
  },
): Buffer {
  try {
    const dekIv = Buffer.from(envelope.dekIv, 'base64');
    const dekTag = Buffer.from(envelope.dekTag, 'base64');
    const encryptedDek = Buffer.from(envelope.encryptedDek, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', kek, dekIv);
    decipher.setAuthTag(dekTag);
    return Buffer.concat([decipher.update(encryptedDek), decipher.final()]);
  } catch (error) {
    throw validationFailed(
      'Backup decryption failed: invalid encryption key or corrupted key envelope.',
      { cause: error },
    );
  }
}

export async function encryptFile(
  inputFile: string,
  outputFile: string,
  dek: Buffer,
): Promise<EncryptFileResult> {
  const iv = randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);

  const inputStream = createReadStream(inputFile);
  await rm(outputFile, { force: true }).catch(() => undefined);
  const outputStream = createWriteStream(outputFile, { mode: 0o600, flags: 'wx' });

  const plaintextHash = createHash('sha256');
  const ciphertextHash = createHash('sha256');

  let plaintextBytes = 0;
  let ciphertextBytes = 0;

  const header = Buffer.concat([ENCRYPTION_MAGIC, iv]);
  let headerPushed = false;

  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!headerPushed) {
        headerPushed = true;
        ciphertextHash.update(header);
        this.push(header);
      }
      plaintextBytes += chunk.length;
      plaintextHash.update(chunk);

      const encryptedChunk = cipher.update(chunk);
      if (encryptedChunk.length > 0) {
        ciphertextBytes += encryptedChunk.length;
        ciphertextHash.update(encryptedChunk);
        this.push(encryptedChunk);
      }
      callback();
    },
    flush(callback) {
      if (!headerPushed) {
        headerPushed = true;
        ciphertextHash.update(header);
        this.push(header);
      }
      try {
        const finalChunk = cipher.final();
        if (finalChunk.length > 0) {
          ciphertextBytes += finalChunk.length;
          ciphertextHash.update(finalChunk);
          this.push(finalChunk);
        }
        const tag = cipher.getAuthTag();
        ciphertextHash.update(tag);
        this.push(tag);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });

  try {
    await pipeline(inputStream, transform, outputStream);
    const totalCiphertextBytes = header.length + ciphertextBytes + ENCRYPTION_TAG_LENGTH;
    return {
      bytes: totalCiphertextBytes,
      sha256: ciphertextHash.digest('hex'),
      plaintextBytes,
      plaintextSha256: plaintextHash.digest('hex'),
    };
  } catch (error) {
    await rm(outputFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function decryptFile(
  encryptedFile: string,
  outputFile: string,
  dek: Buffer,
): Promise<DecryptFileResult> {
  const fileHandle = await open(encryptedFile, 'r');
  try {
    const stat = await fileHandle.stat();
    if (stat.size < MIN_ENCRYPTED_FILE_SIZE) {
      throw validationFailed('Corrupted encrypted backup file: file too short.');
    }

    const header = Buffer.alloc(ENCRYPTION_HEADER_LENGTH);
    await fileHandle.read(header, 0, ENCRYPTION_HEADER_LENGTH, 0);

    const magic = header.subarray(0, ENCRYPTION_MAGIC_LENGTH);
    if (!magic.equals(ENCRYPTION_MAGIC)) {
      throw validationFailed('Corrupted encrypted backup file: missing encryption header.');
    }

    const iv = header.subarray(ENCRYPTION_MAGIC_LENGTH, ENCRYPTION_HEADER_LENGTH);

    const tag = Buffer.alloc(ENCRYPTION_TAG_LENGTH);
    await fileHandle.read(tag, 0, ENCRYPTION_TAG_LENGTH, stat.size - ENCRYPTION_TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(tag);

    const ciphertextStart = ENCRYPTION_HEADER_LENGTH;
    const ciphertextEnd = stat.size - ENCRYPTION_TAG_LENGTH - 1;

    if (ciphertextEnd < ciphertextStart) {
      const finalDecrypted = decipher.final();
      const plaintextHash = createHash('sha256');
      if (finalDecrypted.length > 0) {
        plaintextHash.update(finalDecrypted);
      }
      await rm(outputFile, { force: true }).catch(() => undefined);
      await writeFile(outputFile, finalDecrypted, { mode: 0o600, flag: 'wx' });
      return {
        bytes: finalDecrypted.length,
        sha256: plaintextHash.digest('hex'),
      };
    }

    const readStream = fileHandle.createReadStream({
      start: ciphertextStart,
      end: ciphertextEnd,
    });
    await rm(outputFile, { force: true }).catch(() => undefined);
    const writeStream = createWriteStream(outputFile, { mode: 0o600, flags: 'wx' });
    const plaintextHash = createHash('sha256');
    let plaintextBytes = 0;

    const transform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          const decryptedChunk = decipher.update(chunk);
          if (decryptedChunk.length > 0) {
            plaintextBytes += decryptedChunk.length;
            plaintextHash.update(decryptedChunk);
            this.push(decryptedChunk);
          }
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
      flush(callback) {
        try {
          const finalDecrypted = decipher.final();
          if (finalDecrypted.length > 0) {
            plaintextBytes += finalDecrypted.length;
            plaintextHash.update(finalDecrypted);
            this.push(finalDecrypted);
          }
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
    });

    await pipeline(readStream, transform, writeStream);

    return {
      bytes: plaintextBytes,
      sha256: plaintextHash.digest('hex'),
    };
  } catch (error) {
    await rm(outputFile, { force: true }).catch(() => undefined);
    const isAuthFailure =
      error instanceof Error &&
      (error.message.includes('authenticate') ||
        error.message.includes('Unsupported state') ||
        ('code' in error && error.code === 'ERR_OSSL_GCM_AUTH_TAG'));
    if (isAuthFailure) {
      throw validationFailed(
        'Backup file decryption failed: authentication tag mismatch or corrupted ciphertext.',
        { cause: error },
      );
    }
    throw error;
  } finally {
    await fileHandle.close();
  }
}

export function encryptBuffer(data: Buffer, dek: Buffer): Buffer {
  const iv = randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENCRYPTION_MAGIC, iv, ciphertext, tag]);
}

export function decryptBuffer(encryptedData: Buffer, dek: Buffer): Buffer {
  if (encryptedData.length < MIN_ENCRYPTED_FILE_SIZE) {
    throw validationFailed('Corrupted encrypted backup object: payload too short.');
  }

  const magic = encryptedData.subarray(0, ENCRYPTION_MAGIC_LENGTH);
  if (!magic.equals(ENCRYPTION_MAGIC)) {
    throw validationFailed('Corrupted encrypted backup object: missing encryption header.');
  }

  const iv = encryptedData.subarray(ENCRYPTION_MAGIC_LENGTH, ENCRYPTION_HEADER_LENGTH);
  const tag = encryptedData.subarray(encryptedData.length - ENCRYPTION_TAG_LENGTH);
  const ciphertext = encryptedData.subarray(
    ENCRYPTION_HEADER_LENGTH,
    encryptedData.length - ENCRYPTION_TAG_LENGTH,
  );

  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw validationFailed(
      'Backup object decryption failed: authentication tag mismatch or corrupted ciphertext.',
      { cause: error },
    );
  }
}
