import "dotenv/config";
import { EventSource } from "eventsource";
import {
  leadCMSUrl,
  leadCMSApiKey,
  defaultLanguage,
  CONTENT_DIR,
  fetchContentTypes,
} from "./leadcms-helpers.js";
import { saveContentFile } from "../lib/content-transformation.js";
import { fetchLeadCMSContent } from "./fetch-leadcms-content.js";
import { logger } from "../lib/logger.js";

// Type definitions
interface SSEEventData {
  entityType?: string;
  operation?: string;
  createdById?: string;
  data?: any;
}

interface ConnectedEventData {
  clientId: string;
  startingChangeLogId: string;
}

interface HeartbeatEventData {
  timestamp: string;
}

interface DraftEventData extends SSEEventData {
  createdById: string;
  data: any;
}

// Log environment configuration for debugging
logger.verbose(`[SSE ENV] LeadCMS URL: ${leadCMSUrl}`);
logger.verbose(
  `[SSE ENV] LeadCMS API Key: ${leadCMSApiKey ? `${leadCMSApiKey.substring(0, 8)}...` : "NOT_SET"}`
);
logger.verbose(`[SSE ENV] Default Language: ${defaultLanguage}`);
logger.verbose(`[SSE ENV] Content Dir: ${CONTENT_DIR}`);

// ── Debounced & serialized content fetch ─────────────────────────────
// Prevents concurrent syncs and coalesces rapid SSE events into a single
// fetch. This is critical for watch mode to avoid merge conflicts caused
// by overlapping pulls that read stale sync tokens.
let fetchInProgress = false;
let fetchQueued = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

/**
 * Schedule a debounced, serialized content fetch.
 *
 * - **Debounced**: waits DEBOUNCE_MS after the last call before firing,
 *   so rapid events (e.g. content-updated + onmessage for the same change)
 *   are coalesced into one fetch.
 * - **Serialized**: only one fetch runs at a time. If a fetch is already
 *   in progress, at most one more is queued so that changes received
 *   during the fetch are not lost.
 * - **forceOverwrite**: always passes { forceOverwrite: true } to skip
 *   three-way merge logic, ensuring watch mode never produces conflicts.
 */
function scheduleFetch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    executeFetch();
  }, DEBOUNCE_MS);
}

async function executeFetch(): Promise<void> {
  if (fetchInProgress) {
    // Another fetch is running — queue one more (coalesced)
    fetchQueued = true;
    logger.verbose("[SSE] Fetch already in progress — queued another");
    return;
  }

  fetchInProgress = true;
  try {
    logger.verbose("[SSE] Starting content fetch (forceOverwrite)...");
    await fetchLeadCMSContent({ forceOverwrite: true });
    logger.verbose("[SSE] Content fetch completed successfully");
  } catch (error: any) {
    logger.verbose("[SSE] Content fetch failed:", error.message);
  } finally {
    fetchInProgress = false;

    // If another event arrived while we were fetching, run one more time
    if (fetchQueued) {
      fetchQueued = false;
      logger.verbose("[SSE] Processing queued fetch...");
      executeFetch();
    }
  }
}

// Legacy helper kept for backward-compatibility (exported tests, etc.)
// Delegates to the debounced scheduler now.
async function triggerContentFetch(): Promise<void> {
  scheduleFetch();
}

function buildSSEUrl(): string {
  logger.verbose(`[SSE URL] Building SSE URL with base: ${leadCMSUrl}`);
  const url = new URL("/api/sse/stream", leadCMSUrl || "");
  url.searchParams.set("entities", "Content");
  url.searchParams.set("includeContent", "true");
  url.searchParams.set("includeLiveDrafts", "true");
  const finalUrl = url.toString();
  logger.verbose(`[SSE URL] Final SSE URL: ${finalUrl}`);
  return finalUrl;
}

async function startSSEWatcher(): Promise<void> {
  logger.verbose(`[SSE] Starting SSE watcher...`);
  const typeMap = await fetchContentTypes();
  const sseUrl = buildSSEUrl();
  const eventSourceOptions: any = {};

  if (leadCMSApiKey) {
    logger.verbose(`[SSE] Using API key for authentication`);
    eventSourceOptions.fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
      logger.verbose(`[SSE FETCH] Making authenticated request to: ${input}`);
      logger.verbose(
        `[SSE FETCH] Headers:`,
        JSON.stringify(
          {
            ...init?.headers,
            Authorization: `Bearer ${leadCMSApiKey?.substring(0, 8)}...`,
          },
          null,
          2
        )
      );

      return fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${leadCMSApiKey}`,
        },
      })
        .then((response) => {
          logger.verbose(`[SSE FETCH] Response status: ${response.status} ${response.statusText}`);
          logger.verbose(
            `[SSE FETCH] Response headers:`,
            JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)
          );
          if (!response.ok) {
            logger.verbose(`[SSE FETCH] Failed response: ${response.status} ${response.statusText}`);
          }
          return response;
        })
        .catch((error) => {
          logger.verbose(`[SSE FETCH] Fetch error:`, error.message);
          throw error;
        });
    };
  } else {
    logger.verbose(`[SSE] No API key provided - attempting unauthenticated connection`);
  }

  logger.verbose(`[SSE] Connecting to: ${sseUrl}`);
  logger.verbose(`[SSE] Event source options:`, JSON.stringify(eventSourceOptions, null, 2));
  const es = new EventSource(sseUrl, eventSourceOptions);

  es.onopen = () => {
    logger.verbose("[SSE] Connection opened successfully");
  };

  es.onmessage = (event) => {
    logger.verbose(`[SSE] Received message:`, event.data);
    try {
      const data: SSEEventData = JSON.parse(event.data);
      logger.verbose(`[SSE] Parsed message data:`, JSON.stringify(data, null, 2));

      if (data.entityType === "Content") {
        logger.verbose(`[SSE] Content message - Operation: ${data.operation}`);
        logger.verbose(`[SSE] Content change detected - triggering full fetch`);
        triggerContentFetch();
      } else {
        logger.verbose(`[SSE] Non-content message - Entity type: ${data.entityType}`);
      }
    } catch (e: any) {
      logger.verbose("[SSE] Failed to parse SSE message:", e.message);
      logger.verbose("[SSE] Raw event data:", event.data);
    }
  };

  es.addEventListener("connected", (event) => {
    logger.verbose(`[SSE] Received 'connected' event:`, event.data);
    try {
      const data: ConnectedEventData = JSON.parse(event.data);
      logger.verbose(
        `[SSE] Connected successfully - Client ID: ${data.clientId}, Starting change log ID: ${data.startingChangeLogId}`
      );
    } catch (e: any) {
      logger.verbose("[SSE] Failed to parse connected event:", e.message);
      logger.verbose("[SSE] Raw connected event data:", event.data);
    }
  });

  es.addEventListener("heartbeat", (event) => {
    logger.verbose(`[SSE] Received heartbeat:`, event.data);
    try {
      const data: HeartbeatEventData = JSON.parse(event.data);
      logger.verbose(`[SSE] Heartbeat at ${data.timestamp}`);
    } catch (e: any) {
      logger.verbose("[SSE] Failed to parse heartbeat event:", e.message);
      logger.verbose("[SSE] Raw heartbeat event data:", event.data);
    }
  });

  es.addEventListener("draft-updated", (event) => {
    logger.verbose(`[SSE] Received 'draft-updated' event:`, event.data);
    try {
      const data: DraftEventData = JSON.parse(event.data);
      logger.verbose(`[SSE] Draft updated data:`, JSON.stringify(data, null, 2));

      if (data.createdById && data.data) {
        logger.verbose(`[SSE] Processing draft update for user: ${data.createdById}`);
        let contentData: any;
        try {
          contentData = typeof data.data === "string" ? JSON.parse(data.data) : data.data;
          logger.verbose(`[SSE] Draft content data:`, JSON.stringify(contentData, null, 2));
        } catch (e: any) {
          logger.verbose("[SSE] Failed to parse draft content data:", e.message);
          logger.verbose("[SSE] Raw data:", data.data);
          return;
        }

        // Determine content type for draft handling
        let contentType: string | undefined = undefined;
        if (contentData && contentData.type && typeMap && typeMap[contentData.type]) {
          contentType = typeMap[contentData.type];
        }

        logger.verbose(`[SSE] Draft updated - triggering full fetch`);
        triggerContentFetch();

        if (contentType === "MDX" || contentType === "JSON") {
          if (contentData && typeof contentData === "object") {
            const previewSlug = `${contentData.slug}-${data.createdById}`;
            logger.verbose(`[SSE] Saving draft content file for preview: ${previewSlug}`);
            (async () => {
              try {
                await saveContentFile({
                  content: contentData,
                  typeMap,
                  contentDir: CONTENT_DIR,
                  previewSlug: previewSlug,
                });
                logger.verbose(`[SSE] Saved draft preview for ${previewSlug}`);
              } catch (error: any) {
                logger.verbose(`[SSE] Error processing draft update:`, error.message);
              }
            })();
          }
        } else {
          logger.verbose(`[SSE] Draft is not MDX or JSON (type: ${contentType}), skipping file save.`);
        }
      }
    } catch (e: any) {
      logger.verbose("[SSE] Failed to parse draft-updated event:", e.message);
      logger.verbose("[SSE] Raw draft-updated event data:", event.data);
    }
  });

  // Handle legacy DraftModified messages for backward compatibility
  es.addEventListener("message", (event) => {
    try {
      const data: SSEEventData = JSON.parse(event.data);

      // Only handle DraftModified operations here for backward compatibility
      if (data.entityType === "Content" && data.operation === "DraftModified" && data.createdById && data.data) {
        logger.verbose(`[SSE] Received legacy 'DraftModified' message for user: ${data.createdById}`);
        let contentData: any;
        try {
          contentData = typeof data.data === "string" ? JSON.parse(data.data) : data.data;
          logger.verbose(`[SSE] Legacy draft content data:`, JSON.stringify(contentData, null, 2));
        } catch (e: any) {
          logger.verbose("[SSE] Failed to parse legacy draft content data:", e.message);
          logger.verbose("[SSE] Raw data:", data.data);
          return;
        }

        // Determine content type for legacy draft handling
        let contentType: string | undefined = undefined;
        if (contentData && contentData.type && typeMap && typeMap[contentData.type]) {
          contentType = typeMap[contentData.type];
        }

        logger.verbose(`[SSE] Legacy draft modified - triggering full fetch`);
        triggerContentFetch();

        if (contentType === "MDX" || contentType === "JSON") {
          if (contentData && typeof contentData === "object") {
            const previewSlug = `${contentData.slug}-${data.createdById}`;
            logger.verbose(`[SSE] Saving legacy draft content file for preview: ${previewSlug}`);
            (async () => {
              try {
                await saveContentFile({
                  content: contentData,
                  typeMap,
                  contentDir: CONTENT_DIR,
                  previewSlug: previewSlug,
                });
                logger.verbose(`[SSE] Saved legacy draft preview for ${previewSlug}`);
              } catch (error: any) {
                logger.verbose(`[SSE] Error processing legacy draft modification:`, error.message);
              }
            })();
          }
        } else {
          logger.verbose(`[SSE] Legacy draft is not MDX or JSON (type: ${contentType}), skipping file save.`);
        }
      }
    } catch {
      // Silently ignore parse errors for non-JSON messages
    }
  });

  es.addEventListener("content-updated", (event) => {
    logger.verbose(`[SSE] Received 'content-updated' event:`, event.data);
    try {
      const data: SSEEventData = JSON.parse(event.data);
      logger.verbose(`[SSE] Content updated data:`, JSON.stringify(data, null, 2));

      logger.verbose(`[SSE] Content updated - triggering full fetch`);
      triggerContentFetch();
    } catch (e: any) {
      logger.verbose("[SSE] Failed to parse content-updated event:", e.message);
      logger.verbose("[SSE] Raw content-updated event data:", event.data);
    }
  });

  es.onerror = (err: any) => {
    logger.verbose("[SSE] Connection error occurred:", {
      type: err.type,
      message: err.message,
      code: err.code,
      timestamp: new Date().toISOString(),
      readyState: es.readyState,
      url: es.url,
    });

    // Log specific error types
    if (err.code === 401) {
      logger.verbose("[SSE] Authentication failed (401) - check your LEADCMS_API_KEY");
      logger.verbose(
        "[SSE] Current API Key (first 8 chars):",
        leadCMSApiKey ? leadCMSApiKey.substring(0, 8) : "NOT_SET"
      );
    } else if (err.code === 403) {
      logger.verbose("[SSE] Forbidden (403) - insufficient permissions");
    } else if (err.code === 404) {
      logger.verbose("[SSE] Not Found (404) - check your LEADCMS_URL and endpoint path");
    } else if (err.code >= 500) {
      logger.verbose("[SSE] Server error (5xx) - LeadCMS server issue");
    }

    logger.verbose("[SSE] Closing connection and will reconnect in 5s");
    es.close();
    setTimeout(() => {
      logger.verbose("[SSE] Attempting to reconnect...");
      startSSEWatcher();
    }, 5000);
  };
}

// Export the watcher function and types
export { startSSEWatcher };
export type { SSEEventData, ConnectedEventData, HeartbeatEventData, DraftEventData };

// Export internals for testing
export { scheduleFetch, DEBOUNCE_MS };
export function _resetFetchState(): void {
  fetchInProgress = false;
  fetchQueued = false;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
