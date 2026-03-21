import { createHash } from 'crypto'

/** Stable SHA-256 hash for cache keys. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}
