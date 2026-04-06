/**
 * Thin wrapper around getContainerStatus + waitForContainerReady.
 * Re-exports for reuse.
 */

export {
  getContainerStatus,
  waitForContainerReady,
} from "./metaClient.js";
