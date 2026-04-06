export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    baseMs?: number;
    maxMs?: number;
    /** If false, error is not retried (e.g. token expired). Default: all errors retried. */
    isRetryable?: (err: unknown) => boolean;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, baseMs = 1000, maxMs = 10000, isRetryable } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryable && !isRetryable(err)) throw err;
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
