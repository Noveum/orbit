export const STORAGE_KINDS = ['image', 'video', 'audio', 'pdf', 'text', 'other'] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

export interface UploadTarget {
  readonly key: string;
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly maxBytes: number;
  readonly expiresAt: string;
}

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
  readonly updatedAt: Date;
}

export interface DownloadOptions {
  readonly contentType?: string;
  readonly disposition?: string;
}

export interface StorageDriver {
  readonly name: 's3';
  createUploadTarget(key: string, contentType: string, size: number): Promise<UploadTarget>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getUrl(key: string, expiresInSeconds: number, options?: DownloadOptions): Promise<string>;
  delete(key: string): Promise<void>;
  stat(key: string): Promise<StoredObject | null>;
}
