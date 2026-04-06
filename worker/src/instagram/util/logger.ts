const PREFIX = "[LBA-IG]";

export const logger = {
  info(msg: string, meta?: Record<string, unknown>) {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`${ts} ${PREFIX} [INFO] ${msg}${metaStr}`);
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.warn(`${ts} ${PREFIX} [WARN] ${msg}${metaStr}`);
  },
  error(msg: string, err?: unknown, meta?: Record<string, unknown>) {
    const ts = new Date().toISOString();
    const errStr = err instanceof Error ? ` ${err.message}` : err ? ` ${String(err)}` : "";
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.error(`${ts} ${PREFIX} [ERROR] ${msg}${errStr}${metaStr}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  },
  debug(msg: string, meta?: Record<string, unknown>) {
    if (process.env.DEBUG) {
      const ts = new Date().toISOString();
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
      console.log(`${ts} ${PREFIX} [DEBUG] ${msg}${metaStr}`);
    }
  },
};
