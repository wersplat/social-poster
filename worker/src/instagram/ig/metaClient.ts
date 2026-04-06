import { logger } from "../util/logger.js";

const baseUrl = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION ?? "v24.0"}`;
const igUserId = process.env.IG_USER_ID;
const accessToken = process.env.META_ACCESS_TOKEN;

if (!igUserId || !accessToken) {
  throw new Error("IG_USER_ID and META_ACCESS_TOKEN must be set");
}

function redactToken(s: string) {
  return accessToken ? s.replace(accessToken, "***REDACTED***") : s;
}

/** Thrown when Meta returns 190 (token expired). Do not retry; refresh META_ACCESS_TOKEN. */
export class TokenExpiredError extends Error {
  readonly code = 190;
  constructor(message: string) {
    super(message);
    this.name = "TokenExpiredError";
  }
}

interface MetaError {
  message?: string;
  code?: number;
  error_user_msg?: string;
  error_user_title?: string;
}

type ContainerStatusCode =
  | "EXPIRED"
  | "ERROR"
  | "FINISHED"
  | "IN_PROGRESS"
  | "PUBLISHED";

async function graphGet(path: string, params: Record<string, string> = {}) {
  const url = `${baseUrl}/${path}?${new URLSearchParams({ ...params, access_token: accessToken! })}`;
  const res = await fetch(url, { method: "GET" });
  const json = (await res.json()) as { status_code?: ContainerStatusCode } & {
    error?: MetaError;
  };
  if (!res.ok) {
    const err = json.error ?? {};
    logger.error("Meta API error", undefined, {
      path,
      code: err.code,
      message: err.message,
      user_msg: err.error_user_msg,
    });
    if (err.code === 190) {
      throw new TokenExpiredError(
        err.message ?? "Access token expired or invalid"
      );
    }
    throw new Error(
      err.message ??
        `Meta API ${res.status}: ${JSON.stringify(redactToken(JSON.stringify(json)))}`
    );
  }
  return json;
}

async function graphPost(path: string, params: Record<string, string>) {
  const url = `${baseUrl}/${path}?${new URLSearchParams({ ...params, access_token: accessToken! })}`;
  const res = await fetch(url, { method: "POST" });
  const json = (await res.json()) as { id?: string } & { error?: MetaError };
  if (!res.ok) {
    const err = json.error ?? {};
    logger.error("Meta API error", undefined, {
      path,
      code: err.code,
      message: err.message,
      user_msg: err.error_user_msg,
    });
    if (err.code === 190) {
      throw new TokenExpiredError(
        err.message ?? "Access token expired or invalid"
      );
    }
    throw new Error(err.message ?? `Meta API ${res.status}: ${JSON.stringify(redactToken(JSON.stringify(json)))}`);
  }
  return json;
}

export async function createImageContainer(
  imageUrl: string,
  caption?: string
): Promise<string> {
  const params: Record<string, string> = {
    image_url: imageUrl,
    is_carousel_item: "false",
  };
  if (caption) params.caption = caption;
  const res = await graphPost(`${igUserId}/media`, params);
  if (!res.id) throw new Error("No creation id in response");
  return res.id;
}

export async function createCarouselChild(imageUrl: string): Promise<string> {
  const res = await graphPost(`${igUserId}/media`, {
    image_url: imageUrl,
    is_carousel_item: "true",
  });
  if (!res.id) throw new Error("No creation id in response");
  return res.id;
}

export async function createCarouselParent(
  childrenCreationIds: string[],
  caption?: string
): Promise<string> {
  const params: Record<string, string> = {
    media_type: "CAROUSEL",
    children: childrenCreationIds.join(","),
  };
  if (caption) params.caption = caption;
  const res = await graphPost(`${igUserId}/media`, params);
  if (!res.id) throw new Error("No creation id in response");
  return res.id;
}

/** GET container status. Container must be FINISHED before media_publish. */
export async function getContainerStatus(
  creationId: string
): Promise<ContainerStatusCode> {
  const res = await graphGet(creationId, { fields: "status_code" });
  const code = res.status_code;
  if (!code) throw new Error("No status_code in container response");
  return code;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_WAIT_MS = 60_000;

/** Poll container until FINISHED or ERROR/EXPIRED. Then safe to call media_publish. */
export async function waitForContainerReady(
  creationId: string,
  options?: { pollIntervalMs?: number; maxWaitMs?: number }
): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const status = await getContainerStatus(creationId);
    if (status === "FINISHED" || status === "PUBLISHED") {
      return;
    }
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Container not ready for publish: ${status}`);
    }
    logger.debug("Container not ready, waiting", {
      creationId,
      status,
      nextPollMs: pollIntervalMs,
    });
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `Container still not ready after ${maxWaitMs}ms (creation_id=${creationId})`
  );
}

/** Create a Story container. Requires a publicly accessible image URL. */
export async function createStoryContainer(
  imageUrl: string
): Promise<string> {
  const res = await graphPost(`${igUserId}/media`, {
    media_type: "STORIES",
    image_url: imageUrl,
  });
  if (!res.id) throw new Error("No creation id in story response");
  return res.id;
}

/** Create a video container for Stories or Reels. Requires a publicly accessible video URL. */
export async function createVideoContainer(params: {
  video_url: string;
  caption?: string;
  media_type: "STORIES" | "REELS";
}): Promise<string> {
  const postParams: Record<string, string> = {
    video_url: params.video_url,
    media_type: params.media_type,
  };
  if (params.caption) postParams.caption = params.caption;
  const res = await graphPost(`${igUserId}/media`, postParams);
  if (!res.id) throw new Error("No creation id in video container response");
  return res.id;
}

export async function publishContainer(creationId: string): Promise<string> {
  const res = await graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
  });
  if (!res.id) throw new Error("No media id in response");
  return res.id;
}
