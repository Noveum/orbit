import { ALLOWED_UPLOAD_MIME_PREFIXES } from '@orbit/shared/constants';
import { z } from 'zod';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { attachmentSchema } from '@/lib/query/schemas.ts';

const presignSchema = z.object({
  attachment: attachmentSchema,
  upload: z.object({
    key: z.string(),
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
  }),
});

const completeSchema = z.object({ attachment: attachmentSchema });

const GENERIC_CONTENT_TYPE = 'application/octet-stream';

const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function offendingLabel(declared: string, extension: string, fileName: string): string {
  if (declared.length > 0) return declared;
  return extension.length > 0 ? `.${extension}` : fileName;
}

export function uploadContentType(file: { readonly name: string; readonly type: string }): string {
  const declared = file.type.trim().toLowerCase();
  const extension = file.name.toLowerCase().split('.').slice(1).at(-1) ?? '';
  const resolved =
    declared.length > 0 && declared !== GENERIC_CONTENT_TYPE
      ? declared
      : EXTENSION_CONTENT_TYPES[extension];

  if (
    resolved === undefined ||
    !ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => resolved.startsWith(prefix))
  ) {
    throw new Error(
      `That file type is not supported. (${offendingLabel(declared, extension, file.name)})`,
    );
  }
  return resolved;
}

export interface UploadProgress {
  readonly loaded: number;
  readonly total: number;
}

const UPLOAD_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 400;

interface PutRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly file: File;
  readonly onProgress?: ((progress: UploadProgress) => void) | undefined;
}

function putOnce(put: PutRequest): Promise<number> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('PUT', put.url, true);
    for (const [name, value] of Object.entries(put.headers)) request.setRequestHeader(name, value);
    const report = put.onProgress;
    if (report !== undefined) {
      request.upload.addEventListener('progress', (event: ProgressEvent) => {
        if (event.lengthComputable) report({ loaded: event.loaded, total: event.total });
      });
    }
    request.addEventListener('loadend', () => resolve(request.status));
    request.send(put.file);
  });
}

function isRetriable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

async function putFile(put: PutRequest): Promise<void> {
  let status = 0;
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * attempt));
    }
    status = await putOnce(put);
    if (status >= 200 && status < 300) return;
    if (!isRetriable(status)) break;
  }
  throw new Error(
    `Uploading ${put.file.name} failed${status === 0 ? '' : ` with status ${status}`}.`,
  );
}

export interface UploadedFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly url: string;
}

export interface UploadOptions {
  readonly onProgress?: (progress: UploadProgress) => void;
}

export async function uploadDocFile(
  docId: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  const contentType = uploadContentType(file);
  const presigned = await apiFetch('/api/attachments/presign', presignSchema, {
    method: 'POST',
    body: {
      fileName: file.name,
      contentType,
      size: file.size,
      parentType: 'doc',
      parentId: docId,
    },
  });

  await putFile({
    url: presigned.upload.url,
    headers: presigned.upload.headers,
    file,
    onProgress: options.onProgress,
  });

  await apiFetch(`/api/attachments/${presigned.attachment.id}/complete`, completeSchema, {
    method: 'POST',
  });

  return {
    fileName: file.name,
    contentType,
    url: `/api/files/${presigned.upload.key.split('/').map(encodeURIComponent).join('/')}`,
  };
}
