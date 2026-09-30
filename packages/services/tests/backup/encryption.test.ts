import { describe, expect, it } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEnvelopeDataKey,
  decryptBuffer,
  decryptEnvelopeDataKey,
  decryptFile,
  encryptBuffer,
  encryptFile,
  parseEncryptionKey,
  resolveMasterEncryptionKey,
} from '../../src/backup/encryption.ts';

describe('backup encryption', () => {
  const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const base64Key = Buffer.from('12345678901234567890123456789012', 'utf8').toString('base64');

  it('parses 64-character hex keys directly into 32-byte buffers', () => {
    const parsed = parseEncryptionKey(hexKey);
    expect(parsed.length).toBe(32);
    expect(parsed.toString('hex')).toBe(hexKey);
  });

  it('parses 44-character base64 keys into 32-byte buffers', () => {
    const parsed = parseEncryptionKey(base64Key);
    expect(parsed.length).toBe(32);
    expect(parsed.toString('base64')).toBe(base64Key);
  });

  it('rejects keys that are not valid 32-byte hex or base64', () => {
    expect(() => parseEncryptionKey('my-operator-secret-passphrase')).toThrow();
    expect(() => parseEncryptionKey('too-short')).toThrow();
  });

  it('rejects empty or whitespace encryption keys', () => {
    expect(() => parseEncryptionKey('')).toThrow();
    expect(() => parseEncryptionKey('   ')).toThrow();
  });

  it('resolves master key from explicit options', async () => {
    const resolved = await resolveMasterEncryptionKey({
      key: hexKey,
      keyId: 'test-key-id',
    });
    expect(resolved.key.toString('hex')).toBe(hexKey);
    expect(resolved.keyId).toBe('test-key-id');
  });

  it('resolves master key from key file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-key-test-'));
    const filePath = join(tempDir, 'key.txt');
    try {
      await writeFile(filePath, `${hexKey}\n`, 'utf8');
      const resolved = await resolveMasterEncryptionKey({
        keyFile: filePath,
      });
      expect(resolved.key.toString('hex')).toBe(hexKey);
      expect(resolved.keyId).toBe('default');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves key parsing error when key file contains invalid key format', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-key-invalid-'));
    const filePath = join(tempDir, 'invalid-key.txt');
    try {
      await writeFile(filePath, 'not-a-valid-32-byte-hex-or-base64\n', 'utf8');
      await expect(
        resolveMasterEncryptionKey({
          keyFile: filePath,
        }),
      ).rejects.toThrow('Encryption key must be a valid 32-byte key');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves master key from secret command helper', async () => {
    const resolved = await resolveMasterEncryptionKey({
      command: `"${process.execPath}" -e "process.stdout.write('${hexKey}')"`,
    });
    expect(resolved.key.toString('hex')).toBe(hexKey);
  });

  it('creates and decrypts envelope data encryption keys', () => {
    const kek = parseEncryptionKey(hexKey);
    const { dek, envelope } = createEnvelopeDataKey(kek, 'vault-k1');

    expect(dek.length).toBe(32);
    expect(envelope.keyId).toBe('vault-k1');
    expect(envelope.encryptedDek.length).toBeGreaterThan(0);
    expect(envelope.dekIv.length).toBeGreaterThan(0);
    expect(envelope.dekTag.length).toBeGreaterThan(0);

    const decryptedDek = decryptEnvelopeDataKey(kek, envelope);
    expect(decryptedDek).toEqual(dek);
  });

  it('fails safely when decrypting envelope with invalid key', () => {
    const kek = parseEncryptionKey(hexKey);
    const wrongKek = parseEncryptionKey(
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    );
    const { envelope } = createEnvelopeDataKey(kek, 'vault-k1');

    expect(() => decryptEnvelopeDataKey(wrongKek, envelope)).toThrow();
  });

  it('encrypts and decrypts memory buffers with authentication verification', () => {
    const dek = randomBytes(32);
    const payload = Buffer.from('hello attachment binary data 12345', 'utf8');

    const encrypted = encryptBuffer(payload, dek);
    expect(encrypted.length).toBeGreaterThan(payload.length);
    expect(encrypted.subarray(0, 8).toString('utf8')).toBe('ORBITENC');

    const decrypted = decryptBuffer(encrypted, dek);
    expect(decrypted).toEqual(payload);
  });

  it('rejects tampered buffer ciphertext during decryption', () => {
    const dek = randomBytes(32);
    const payload = Buffer.from('secure data', 'utf8');
    const encrypted = encryptBuffer(payload, dek);

    const tampered = Buffer.from(encrypted);
    const middleIndex = Math.floor(tampered.length / 2);
    tampered[middleIndex] = (tampered[middleIndex] ?? 0) ^ 0xff;

    expect(() => decryptBuffer(tampered, dek)).toThrow();
  });

  it('streams file encryption and decryption preserving exact byte content and hashes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-file-enc-test-'));
    const sourcePath = join(tempDir, 'source.txt');
    const encPath = join(tempDir, 'source.txt.enc');
    const decPath = join(tempDir, 'restored.txt');

    try {
      const originalContent =
        'Sample database dump content that spans several lines\nLine 2\nLine 3\n';
      await writeFile(sourcePath, originalContent, 'utf8');

      const dek = randomBytes(32);
      const encResult = await encryptFile(sourcePath, encPath, dek);

      expect(encResult.plaintextBytes).toBe(Buffer.byteLength(originalContent, 'utf8'));
      expect(encResult.bytes).toBeGreaterThan(encResult.plaintextBytes);

      const decResult = await decryptFile(encPath, decPath, dek);
      expect(decResult.bytes).toBe(encResult.plaintextBytes);
      expect(decResult.sha256).toBe(encResult.plaintextSha256);

      const restoredText = await readFile(decPath, 'utf8');
      expect(restoredText).toBe(originalContent);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects corrupted encrypted file with authentication error', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-corrupt-file-test-'));
    const sourcePath = join(tempDir, 'source.txt');
    const encPath = join(tempDir, 'source.txt.enc');
    const decPath = join(tempDir, 'restored.txt');

    try {
      await writeFile(sourcePath, 'sensitive database content', 'utf8');
      const dek = randomBytes(32);
      await encryptFile(sourcePath, encPath, dek);

      const rawEnc = await readFile(encPath);
      rawEnc[rawEnc.length - 5] = (rawEnc.at(-5) ?? 0) ^ 0xff;
      await writeFile(encPath, rawEnc);

      await expect(decryptFile(encPath, decPath, dek)).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('streams empty file encryption and decryption correctly', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orbit-empty-file-test-'));
    const sourcePath = join(tempDir, 'empty.txt');
    const encPath = join(tempDir, 'empty.txt.enc');
    const decPath = join(tempDir, 'restored.txt');

    try {
      await writeFile(sourcePath, Buffer.alloc(0));
      const dek = randomBytes(32);
      const encResult = await encryptFile(sourcePath, encPath, dek);
      expect(encResult.plaintextBytes).toBe(0);

      const decResult = await decryptFile(encPath, decPath, dek);
      expect(decResult.bytes).toBe(0);
      expect(decResult.sha256).toBe(encResult.plaintextSha256);

      const restored = await readFile(decPath);
      expect(restored.length).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
