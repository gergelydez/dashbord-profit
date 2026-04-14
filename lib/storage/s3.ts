/**
 * lib/storage/s3.ts — PDF storage abstraction
 *
 * Strategy (in priority order):
 *  1. AWS S3 / Cloudflare R2 / MinIO — if S3_BUCKET is configured
 *  2. PostgreSQL Bytes column — fallback for simple/serverless deployments
 *
 * The public interface returns a "storage key" string:
 *   - S3:  "s3://{bucket}/{key}"          e.g. "s3://my-bucket/invoices/uuid.pdf"
 *   - DB:  "db:{entity_id}"               e.g. "db:abc123" (sentinel, actual bytes in DB)
 *
 * Download endpoints fetch the key, determine the backend, and stream the bytes.
 *
 * NOTE: We never expose raw S3 URLs publicly. All access goes through the
 * signed /api/invoice and /api/shipping-label endpoints.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { logger } from '@/lib/logger';

// ─── S3 Configuration ────────────────────────────────────────────────────────

const S3_BUCKET    = process.env.S3_BUCKET        || '';
const S3_REGION    = process.env.S3_REGION        || 'eu-central-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY_ID || '';
const S3_SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY || '';
const S3_ENDPOINT  = process.env.S3_ENDPOINT      || undefined; // for R2/MinIO

export const S3_CONFIGURED = !!(S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials: {
        accessKeyId:     S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
      // Required for Cloudflare R2 path-style access
      forcePathStyle: !!S3_ENDPOINT,
    });
  }
  return _s3Client;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type StorageBackend = 's3' | 'db';

export interface StorageResult {
  key: string;           // storage key to persist in DB
  backend: StorageBackend;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Store a PDF buffer.
 * If S3 is configured, uploads to S3 and returns the S3 key.
 * Otherwise returns the sentinel "db:{entityId}" — caller must store bytes inline.
 *
 * @param pdfBuffer  - raw PDF bytes
 * @param prefix     - folder prefix: "invoices" | "labels"
 * @param entityId   - UUID of the Invoice or Shipment row
 */
export async function storePdf(
  pdfBuffer: Buffer,
  prefix: 'invoices' | 'labels',
  entityId: string,
): Promise<StorageResult> {
  if (S3_CONFIGURED) {
    return uploadToS3(pdfBuffer, prefix, entityId);
  }
  // DB fallback — caller is responsible for persisting pdfData column
  return { key: `db:${entityId}`, backend: 'db' };
}

async function uploadToS3(
  pdfBuffer: Buffer,
  prefix: string,
  entityId: string,
): Promise<StorageResult> {
  const key = `${prefix}/${entityId}.pdf`;
  const log = logger.child({ module: 's3', key });

  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket:      S3_BUCKET,
        Key:         key,
        Body:        pdfBuffer,
        ContentType: 'application/pdf',
        // Server-side encryption at rest
        ServerSideEncryption: 'AES256',
        // Never cache (PDFs are served through signed API endpoints)
        CacheControl: 'no-store',
        // Mark as attachment so browsers download rather than render inline
        ContentDisposition: 'attachment',
      }),
    );

    log.info('PDF uploaded to S3', { size: pdfBuffer.length });
    return { key: `s3://${S3_BUCKET}/${key}`, backend: 's3' };
  } catch (err) {
    log.error('S3 upload failed', { error: (err as Error).message });
    throw err;
  }
}

// ─── Download ────────────────────────────────────────────────────────────────

/**
 * Fetch PDF bytes from S3 given a storage key like "s3://bucket/invoices/x.pdf".
 */
export async function fetchFromS3(storageKey: string): Promise<Buffer> {
  // Parse: "s3://bucket/key/path"
  const withoutProtocol = storageKey.replace(/^s3:\/\/[^/]+\//, '');
  const bucket = storageKey.replace(/^s3:\/\//, '').split('/')[0];
  const key = withoutProtocol;

  const response = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  if (!response.Body) throw new Error(`Empty S3 response for key: ${key}`);

  // Convert ReadableStream to Buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete a PDF from S3.
 */
export async function deleteFromS3(storageKey: string): Promise<void> {
  const withoutProtocol = storageKey.replace(/^s3:\/\/[^/]+\//, '');
  const bucket = storageKey.replace(/^s3:\/\//, '').split('/')[0];

  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: withoutProtocol }),
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** True if the storage key points to S3 */
export function isS3Key(key: string | null | undefined): boolean {
  return !!key && key.startsWith('s3://');
}

/** True if the storage key points to DB inline storage */
export function isDbKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith('db:');
}
