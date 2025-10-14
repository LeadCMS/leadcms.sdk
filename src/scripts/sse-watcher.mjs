import "dotenv/config"
import { EventSource } from "eventsource"
import {
  saveContentFile,
  leadCMSUrl,
  leadCMSApiKey,
  defaultLanguage,
  CONTENT_DIR,
} from "./leadcms-helpers.mjs"
import { fetchContentTypes } from "./leadcms-helpers.mjs"
import { fetchLeadCMSContent } from "./fetch-leadcms-content.mjs"

// Log environment configuration for debugging
console.log(`[SSE ENV] LeadCMS URL: ${leadCMSUrl}`)
console.log(
  `[SSE ENV] LeadCMS API Key: ${leadCMSApiKey ? `${leadCMSApiKey.substring(0, 8)}...` : "NOT_SET"}`
)
console.log(`[SSE ENV] Default Language: ${defaultLanguage}`)
console.log(`[SSE ENV] Content Dir: ${CONTENT_DIR}`)

// Helper function to trigger content fetch
async function triggerContentFetch() {
  try {
    console.log("[SSE] Starting content fetch...")
    await fetchLeadCMSContent()
    console.log("[SSE] Content fetch completed successfully")
  } catch (error) {
    console.error("[SSE] Content fetch failed:", error.message)
  }
}

function buildSSEUrl() {
  console.log(`[SSE URL] Building SSE URL with base: ${leadCMSUrl}`)
  const url = new URL("/api/sse/stream", leadCMSUrl)
  url.searchParams.set("entities", "Content")
  url.searchParams.set("includeContent", "true")
  url.searchParams.set("includeLiveDrafts", "true")
  const finalUrl = url.toString()
  console.log(`[SSE URL] Final SSE URL: ${finalUrl}`)
  return finalUrl
}

async function startSSEWatcher() {
  console.log(`[SSE] Starting SSE watcher...`)
  const typeMap = await fetchContentTypes()
  const sseUrl = buildSSEUrl()
  const eventSourceOptions = {}

  if (leadCMSApiKey) {
    console.log(`[SSE] Using API key for authentication`)
    eventSourceOptions.fetch = (input, init) => {
      console.log(`[SSE FETCH] Making authenticated request to: ${input}`)
      console.log(
        `[SSE FETCH] Headers:`,
        JSON.stringify(
          {
            ...init?.headers,
            Authorization: `Bearer ${leadCMSApiKey.substring(0, 8)}...`,
          },
          null,
          2
        )
      )

      return fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${leadCMSApiKey}`,
        },
      })
        .then((response) => {
          console.log(`[SSE FETCH] Response status: ${response.status} ${response.statusText}`)
          console.log(
            `[SSE FETCH] Response headers:`,
            JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)
          )
          if (!response.ok) {
            console.error(`[SSE FETCH] Failed response: ${response.status} ${response.statusText}`)
          }
          return response
        })
        .catch((error) => {
          console.error(`[SSE FETCH] Fetch error:`, error.message)
          throw error
        })
    }
  } else {
    console.warn(`[SSE] No API key provided - attempting unauthenticated connection`)
  }

  console.log(`[SSE] Connecting to: ${sseUrl}`)
  console.log(`[SSE] Event source options:`, JSON.stringify(eventSourceOptions, null, 2))
  const es = new EventSource(sseUrl, eventSourceOptions)

  es.onopen = () => {
    console.log("[SSE] Connection opened successfully")
  }

  es.onmessage = (event) => {
    console.log(`[SSE] Received message:`, event.data)
    try {
      const data = JSON.parse(event.data)
      console.log(`[SSE] Parsed message data:`, JSON.stringify(data, null, 2))

      if (data.entityType === "Content") {
        console.log(`[SSE] Content message - Operation: ${data.operation}`)
        console.log(`[SSE] Content change detected - triggering full fetch`)
        triggerContentFetch()
      } else {
        console.log(`[SSE] Non-content message - Entity type: ${data.entityType}`)
      }
    } catch (e) {
      console.warn("[SSE] Failed to parse SSE message:", e.message)
      console.warn("[SSE] Raw event data:", event.data)
    }
  }

  es.addEventListener("connected", (event) => {
    console.log(`[SSE] Received 'connected' event:`, event.data)
    try {
      const data = JSON.parse(event.data)
      console.log(
        `[SSE] Connected successfully - Client ID: ${data.clientId}, Starting change log ID: ${data.startingChangeLogId}`
      )
    } catch (e) {
      console.warn("[SSE] Failed to parse connected event:", e.message)
      console.warn("[SSE] Raw connected event data:", event.data)
    }
  })

  es.addEventListener("heartbeat", (event) => {
    console.log(`[SSE] Received heartbeat:`, event.data)
    try {
      const data = JSON.parse(event.data)
      console.log(`[SSE] Heartbeat at ${data.timestamp}`)
    } catch (e) {
      console.warn("[SSE] Failed to parse heartbeat event:", e.message)
      console.warn("[SSE] Raw heartbeat event data:", event.data)
    }
  })

  es.addEventListener("draft-updated", (event) => {
    console.log(`[SSE] Received 'draft-updated' event:`, event.data)
    try {
      const data = JSON.parse(event.data)
      console.log(`[SSE] Draft updated data:`, JSON.stringify(data, null, 2))

      if (data.createdById && data.data) {
        console.log(`[SSE] Processing draft update for user: ${data.createdById}`)
        let contentData
        try {
          contentData = typeof data.data === "string" ? JSON.parse(data.data) : data.data
          console.log(`[SSE] Draft content data:`, JSON.stringify(contentData, null, 2))
        } catch (e) {
          console.warn("[SSE] Failed to parse draft content data:", e.message)
          console.warn("[SSE] Raw data:", data.data)
          return
        }

        // Determine content type for draft handling
        let contentType = undefined
        if (contentData && contentData.type && typeMap && typeMap[contentData.type]) {
          contentType = typeMap[contentData.type]
        }

        console.log(`[SSE] Draft updated - triggering full fetch`)
        triggerContentFetch()

        if (contentType === "MDX" || contentType === "JSON") {
          if (contentData && typeof contentData === "object") {
            const previewSlug = `${contentData.slug}-${data.createdById}`
            console.log(`[SSE] Saving draft content file for preview: ${previewSlug}`)
            ;(async () => {
              try {
                await saveContentFile({
                  content: contentData,
                  typeMap,
                  contentDir: CONTENT_DIR,
                  previewSlug: previewSlug,
                })
                console.log(`[SSE] Saved draft preview for ${previewSlug}`)
              } catch (error) {
                console.error(`[SSE] Error processing draft update:`, error.message)
              }
            })()
          }
        } else {
          console.log(`[SSE] Draft is not MDX or JSON (type: ${contentType}), skipping file save.`)
        }
      }
    } catch (e) {
      console.warn("[SSE] Failed to parse draft-updated event:", e.message)
      console.warn("[SSE] Raw draft-updated event data:", event.data)
    }
  })

  // Handle legacy DraftModified messages for backward compatibility
  es.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data)

      // Only handle DraftModified operations here for backward compatibility
      if (data.entityType === "Content" && data.operation === "DraftModified" && data.createdById && data.data) {
        console.log(`[SSE] Received legacy 'DraftModified' message for user: ${data.createdById}`)
        let contentData
        try {
          contentData = typeof data.data === "string" ? JSON.parse(data.data) : data.data
          console.log(`[SSE] Legacy draft content data:`, JSON.stringify(contentData, null, 2))
        } catch (e) {
          console.warn("[SSE] Failed to parse legacy draft content data:", e.message)
          console.warn("[SSE] Raw data:", data.data)
          return
        }

        // Determine content type for legacy draft handling
        let contentType = undefined
        if (contentData && contentData.type && typeMap && typeMap[contentData.type]) {
          contentType = typeMap[contentData.type]
        }

        console.log(`[SSE] Legacy draft modified - triggering full fetch`)
        triggerContentFetch()

        if (contentType === "MDX" || contentType === "JSON") {
          if (contentData && typeof contentData === "object") {
            const previewSlug = `${contentData.slug}-${data.createdById}`
            console.log(`[SSE] Saving legacy draft content file for preview: ${previewSlug}`)
            ;(async () => {
              try {
                await saveContentFile({
                  content: contentData,
                  typeMap,
                  contentDir: CONTENT_DIR,
                  previewSlug: previewSlug,
                })
                console.log(`[SSE] Saved legacy draft preview for ${previewSlug}`)
              } catch (error) {
                console.error(`[SSE] Error processing legacy draft modification:`, error.message)
              }
            })()
          }
        } else {
          console.log(`[SSE] Legacy draft is not MDX or JSON (type: ${contentType}), skipping file save.`)
        }
      }
    } catch {
      // Silently ignore parse errors for non-JSON messages
    }
  })

  es.addEventListener("content-updated", (event) => {
    console.log(`[SSE] Received 'content-updated' event:`, event.data)
    try {
      const data = JSON.parse(event.data)
      console.log(`[SSE] Content updated data:`, JSON.stringify(data, null, 2))

      console.log(`[SSE] Content updated - triggering full fetch`)
      triggerContentFetch()
    } catch (e) {
      console.warn("[SSE] Failed to parse content-updated event:", e.message)
      console.warn("[SSE] Raw content-updated event data:", event.data)
    }
  })

  es.onerror = (err) => {
    console.error("[SSE] Connection error occurred:", {
      type: err.type,
      message: err.message,
      code: err.code,
      timestamp: new Date().toISOString(),
      readyState: es.readyState,
      url: es.url,
    })

    // Log specific error types
    if (err.code === 401) {
      console.error("[SSE] Authentication failed (401) - check your LEADCMS_API_KEY")
      console.error(
        "[SSE] Current API Key (first 8 chars):",
        leadCMSApiKey ? leadCMSApiKey.substring(0, 8) : "NOT_SET"
      )
    } else if (err.code === 403) {
      console.error("[SSE] Forbidden (403) - insufficient permissions")
    } else if (err.code === 404) {
      console.error("[SSE] Not Found (404) - check your LEADCMS_URL and endpoint path")
    } else if (err.code >= 500) {
      console.error("[SSE] Server error (5xx) - LeadCMS server issue")
    }

    console.log("[SSE] Closing connection and will reconnect in 5s")
    es.close()
    setTimeout(() => {
      console.log("[SSE] Attempting to reconnect...")
      startSSEWatcher()
    }, 5000)
  }
}

startSSEWatcher()
