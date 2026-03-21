import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

function getClient(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) return null

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

export function isR2Configured(): boolean {
  return (
    !!process.env.R2_ACCOUNT_ID &&
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_BUCKET &&
    !!process.env.R2_PUBLIC_BASE_URL
  )
}

/** Upload PNG bytes; returns public URL (R2_PUBLIC_BASE_URL + key). */
export async function uploadPublicPng(key: string, body: Buffer): Promise<string> {
  const client = getClient()
  const bucket = process.env.R2_BUCKET
  const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, '')
  if (!client || !bucket || !base) {
    throw new Error('R2 is not fully configured (bucket / public URL / credentials)')
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'image/png',
    })
  )

  return `${base}/${key}`
}
