import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

/**
 * Same semantics as lba-social `apps/worker/src/storage/r2.ts`:
 * - R2_BUCKET is either `bucket-name` or `bucket-name/optional/object/key/prefix`
 *   (first path segment = real R2 bucket; rest is prepended to every object key).
 * - R2_ENDPOINT optional full S3 API URL; if unset, derived from R2_ACCOUNT_ID.
 * - If Access Key looks 64 chars and Secret 32 chars, credentials are swapped (paste fix).
 */

function splitBucket(rawBucket: string): { bucketName: string; keyPrefix: string } {
  const parts = rawBucket.trim().split('/').filter(Boolean)
  const bucketName = parts[0] ?? ''
  const keyPrefix = parts.slice(1).join('/')
  return { bucketName, keyPrefix }
}

function buildKey(prefix: string, key: string): string {
  const k = key.replace(/^\//, '')
  if (!prefix) return k
  return `${prefix.replace(/\/$/, '')}/${k}`
}

function getR2Endpoint(): string | null {
  const explicit = process.env.R2_ENDPOINT?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`
  return null
}

function resolveCredentials(): { accessKeyId: string; secretAccessKey: string } | null {
  let accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim()
  let secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim()
  if (!accessKeyId || !secretAccessKey) return null
  if (accessKeyId.length === 64 && secretAccessKey.length === 32) {
    ;[accessKeyId, secretAccessKey] = [secretAccessKey, accessKeyId]
    console.warn(
      '[R2] R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY look reversed (32 vs 64 char lengths); using swapped values (same as lba-social worker).'
    )
  }
  return { accessKeyId, secretAccessKey }
}

export function isR2Configured(): boolean {
  return (
    !!getR2Endpoint() &&
    !!resolveCredentials() &&
    !!process.env.R2_BUCKET?.trim() &&
    !!splitBucket(process.env.R2_BUCKET!.trim()).bucketName &&
    !!process.env.R2_PUBLIC_BASE_URL?.trim()
  )
}

function isR2AccessDenied(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; Code?: string }
  return e.name === 'AccessDenied' || e.Code === 'AccessDenied'
}

function isR2NoSuchBucket(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; Code?: string }
  return e.name === 'NoSuchBucket' || e.Code === 'NoSuchBucket'
}

const R2_ACCESS_DENIED_HINT =
  'R2 returned Access Denied (403). In Cloudflare: R2 → Manage R2 API Tokens — create a token with **Object Read & Write** (or Admin Read & Write) on **this bucket**, or include this bucket in the token scope. Confirm R2_ENDPOINT (or R2_ACCOUNT_ID) matches the account that owns the bucket, R2_BUCKET’s **first path segment** is the exact bucket name, and the access key belongs to that token.'

const R2_NO_SUCH_BUCKET_HINT =
  'R2 says the bucket does not exist (NoSuchBucket). R2_BUCKET must start with the **exact** bucket name (first segment before any `/`). Extra segments are an object key prefix only. Example: `my-bucket` or `my-bucket/graphics/lba`. Create the bucket in Cloudflare R2 if needed; names are case-sensitive.'

/** Upload PNG bytes; returns public URL (R2_PUBLIC_BASE_URL + full object key). */
export async function uploadPublicPng(key: string, body: Buffer): Promise<string> {
  const endpoint = getR2Endpoint()
  const creds = resolveCredentials()
  const rawBucket = process.env.R2_BUCKET?.trim()
  const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, '')
  if (!endpoint || !creds || !rawBucket || !base) {
    throw new Error('R2 is not fully configured (bucket / public URL / credentials)')
  }

  const { bucketName, keyPrefix } = splitBucket(rawBucket)
  if (!bucketName) {
    throw new Error('R2_BUCKET is empty or invalid')
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: creds,
  })

  const objectKey = buildKey(keyPrefix, key)

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: body,
        ContentType: 'image/png',
      })
    )
  } catch (err) {
    if (isR2AccessDenied(err)) {
      console.error('[R2] PutObject AccessDenied', {
        bucketName,
        keyPrefix: keyPrefix || '(none)',
        objectKeyPrefix: objectKey.slice(0, 64),
      })
      throw new Error(R2_ACCESS_DENIED_HINT)
    }
    if (isR2NoSuchBucket(err)) {
      console.error('[R2] PutObject NoSuchBucket', { bucketName, keyPrefix })
      throw new Error(R2_NO_SUCH_BUCKET_HINT)
    }
    throw err
  }

  return `${base}/${objectKey}`
}
