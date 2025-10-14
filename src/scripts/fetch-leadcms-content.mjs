import "dotenv/config"
import fs from "fs/promises"
import path from "path"
import axios from "axios"
import {
  extractMediaUrlsFromContent,
  downloadMediaFileDirect,
  saveContentFile,
  leadCMSUrl,
  leadCMSApiKey,
  defaultLanguage,
  CONTENT_DIR,
  MEDIA_DIR,
  fetchContentTypes,
} from "./leadcms-helpers.mjs"

// Add axios request/response interceptors for debugging
axios.interceptors.request.use(
  (config) => {
    console.log(`[AXIOS REQUEST] ${config.method?.toUpperCase()} ${config.url}`)

    // Mask the Authorization header for security
    const maskedHeaders = { ...config.headers }
    if (maskedHeaders.Authorization && typeof maskedHeaders.Authorization === "string") {
      const authParts = maskedHeaders.Authorization.split(" ")
      if (authParts.length === 2 && authParts[0] === "Bearer") {
        maskedHeaders.Authorization = `Bearer ${authParts[1].substring(0, 8)}...`
      }
    }

    return config
  },
  (error) => {
    console.error(`[AXIOS REQUEST ERROR]`, error)
    return Promise.reject(error)
  }
)

axios.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    console.error(
      `[AXIOS RESPONSE ERROR] ${error.response?.status || "NO_STATUS"} ${error.response?.statusText || "NO_STATUS_TEXT"} for ${error.config?.url || "NO_URL"}`
    )
    if (error.response) {
      console.error(`[AXIOS RESPONSE ERROR] Response data:`, error.response.data)
      console.error(
        `[AXIOS RESPONSE ERROR] Response headers:`,
        JSON.stringify(error.response.headers, null, 2)
      )
    }
    console.error(`[AXIOS RESPONSE ERROR] Full error:`, error.message)
    return Promise.reject(error)
  }
)

const SYNC_TOKEN_PATH = path.resolve(".leadcms/sync-token.txt")
const MEDIA_SYNC_TOKEN_PATH = path.resolve(".leadcms/media-sync-token.txt")

async function readSyncToken() {
  try {
    return (await fs.readFile(SYNC_TOKEN_PATH, "utf8")).trim()
  } catch {
    return undefined
  }
}

async function writeSyncToken(token) {
  await fs.mkdir(path.dirname(SYNC_TOKEN_PATH), { recursive: true })
  await fs.writeFile(SYNC_TOKEN_PATH, token, "utf8")
}

async function readMediaSyncToken() {
  try {
    return (await fs.readFile(MEDIA_SYNC_TOKEN_PATH, "utf8")).trim()
  } catch {
    return undefined
  }
}

async function writeMediaSyncToken(token) {
  await fs.mkdir(path.dirname(MEDIA_SYNC_TOKEN_PATH), { recursive: true })
  await fs.writeFile(MEDIA_SYNC_TOKEN_PATH, token, "utf8")
}

async function fetchContentSync(syncToken) {
  console.log(`[FETCH_CONTENT_SYNC] Starting with syncToken: ${syncToken || "NONE"}`)
  let allItems = []
  let allDeleted = []
  let token = syncToken || ""
  let nextSyncToken = undefined
  let page = 0

  while (true) {
    const url = new URL("/api/content/sync", leadCMSUrl)
    url.searchParams.set("filter[limit]", "100")
    url.searchParams.set("syncToken", token)

    console.log(`[FETCH_CONTENT_SYNC] Page ${page}, URL: ${url.toString()}`)

    try {
      const res = await axios.get(url.toString(), {
        headers: { Authorization: `Bearer ${leadCMSApiKey}` },
      })

      if (res.status === 204) {
        console.log(`[FETCH_CONTENT_SYNC] Got 204 No Content - ending sync`)
        break
      }

      const data = res.data
      console.log(
        `[FETCH_CONTENT_SYNC] Page ${page} - Got ${data.items?.length || 0} items, ${data.deleted?.length || 0} deleted`
      )

      if (data.items && Array.isArray(data.items)) allItems.push(...data.items)

      if (data.deleted && Array.isArray(data.deleted)) {
        allDeleted.push(...data.deleted)
      }

      const newSyncToken = res.headers["x-next-sync-token"] || token
      console.log(`[FETCH_CONTENT_SYNC] Next sync token: ${newSyncToken}`)

      if (!newSyncToken || newSyncToken === token) {
        nextSyncToken = newSyncToken || token
        console.log(`[FETCH_CONTENT_SYNC] No new sync token - ending sync`)
        break
      }

      nextSyncToken = newSyncToken
      token = newSyncToken
      page++
    } catch (error) {
      console.error(`[FETCH_CONTENT_SYNC] Failed on page ${page}:`, error.message)
      throw error
    }
  }

  console.log(
    `[FETCH_CONTENT_SYNC] Completed - Total items: ${allItems.length}, deleted: ${allDeleted.length}`
  )
  return {
    items: allItems,
    deleted: allDeleted,
    nextSyncToken: nextSyncToken || token,
  }
}

async function fetchMediaSync(syncToken) {
  console.log(`[FETCH_MEDIA_SYNC] Starting with syncToken: ${syncToken || "NONE"}`)
  let allItems = []
  let token = syncToken || ""
  let nextSyncToken = undefined
  let page = 0

  while (true) {
    const url = new URL("/api/media/sync", leadCMSUrl)
    url.searchParams.set("filter[limit]", "100")
    url.searchParams.set("syncToken", token)

    console.log(`[FETCH_MEDIA_SYNC] Page ${page}, URL: ${url.toString()}`)

    try {
      const res = await axios.get(url.toString(), {
        headers: { Authorization: `Bearer ${leadCMSApiKey}` },
      })

      if (res.status === 204) {
        console.log(`[FETCH_MEDIA_SYNC] Got 204 No Content - ending sync`)
        break
      }

      const data = res.data
      console.log(
        `[FETCH_MEDIA_SYNC] Page ${page} - Got ${data.items?.length || 0} items`
      )

      if (data.items && Array.isArray(data.items)) allItems.push(...data.items)

      const newSyncToken = res.headers["x-next-sync-token"] || token
      console.log(`[FETCH_MEDIA_SYNC] Next sync token: ${newSyncToken}`)

      if (!newSyncToken || newSyncToken === token) {
        nextSyncToken = newSyncToken || token
        console.log(`[FETCH_MEDIA_SYNC] No new sync token - ending sync`)
        break
      }

      nextSyncToken = newSyncToken
      token = newSyncToken
      page++
    } catch (error) {
      console.error(`[FETCH_MEDIA_SYNC] Failed on page ${page}:`, error.message)
      throw error
    }
  }

  console.log(
    `[FETCH_MEDIA_SYNC] Completed - Total items: ${allItems.length}`
  )
  return {
    items: allItems,
    nextSyncToken: nextSyncToken || token,
  }
}

async function main() {
  // Log environment configuration for debugging
  console.log(`[ENV] LeadCMS URL: ${leadCMSUrl}`)
  console.log(
    `[ENV] LeadCMS API Key: ${leadCMSApiKey ? `${leadCMSApiKey.substring(0, 8)}...` : "NOT_SET"}`
  )
  console.log(`[ENV] Default Language: ${defaultLanguage}`)
  console.log(`[ENV] Content Dir: ${CONTENT_DIR}`)
  console.log(`[ENV] Media Dir: ${MEDIA_DIR}`)

  await fs.mkdir(CONTENT_DIR, { recursive: true })
  await fs.mkdir(MEDIA_DIR, { recursive: true })

  const typeMap = await fetchContentTypes()

  const lastSyncToken = await readSyncToken()
  const lastMediaSyncToken = await readMediaSyncToken()

  let items = [],
    deleted = [],
    nextSyncToken

  let mediaItems = [],
    nextMediaSyncToken

  // Sync content
  try {
    if (lastSyncToken) {
      console.log(`Syncing content from LeadCMS using sync token: ${lastSyncToken}`)
      ;({ items, deleted, nextSyncToken } = await fetchContentSync(lastSyncToken))
    } else {
      console.log("No content sync token found. Doing full fetch from LeadCMS...")
      ;({ items, deleted, nextSyncToken } = await fetchContentSync(undefined))
    }
  } catch (error) {
    console.error(`[MAIN] Failed to fetch content:`, error.message)
    if (error.response?.status === 401) {
      console.error(`[MAIN] Authentication failed - check your LEADCMS_API_KEY`)
    }
    throw error
  }

  // Sync media
  try {
    if (lastMediaSyncToken) {
      console.log(`Syncing media from LeadCMS using sync token: ${lastMediaSyncToken}`)
      ;({ items: mediaItems, nextSyncToken: nextMediaSyncToken } = await fetchMediaSync(lastMediaSyncToken))
    } else {
      console.log("No media sync token found. Doing full fetch from LeadCMS...")
      ;({ items: mediaItems, nextSyncToken: nextMediaSyncToken } = await fetchMediaSync(undefined))
    }
  } catch (error) {
    console.error(`[MAIN] Failed to fetch media:`, error.message)
    if (error.response?.status === 401) {
      console.error(`[MAIN] Authentication failed - check your LEADCMS_API_KEY`)
    }
    // Don't throw here, continue with content sync even if media sync fails
    console.warn(`[MAIN] Continuing without media sync...`)
  }

  console.log(`Fetched ${items.length} content items, ${deleted.length} deleted.`)
  console.log(`Fetched ${mediaItems.length} media items.`)

  // Save content files and collect all media URLs from content
  const allMediaUrls = new Set()
  for (const content of items) {
    if (content && typeof content === "object") {
      await saveContentFile({
        content,
        typeMap,
        contentDir: CONTENT_DIR,
      })
      for (const url of extractMediaUrlsFromContent(content)) {
        allMediaUrls.add(url)
      }
    }
  }

  // Remove deleted content files from all language directories
  for (const id of deleted) {
    const idStr = String(id)

    // Function to recursively search for files in a directory
    async function findAndDeleteContentFile(dir) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            // Recursively search subdirectories
            await findAndDeleteContentFile(fullPath)
          } else if (entry.isFile()) {
            try {
              const content = await fs.readFile(fullPath, "utf8")
              // Exact-match YAML frontmatter: lines like `id: 10` or `id: '10'`
              const yamlRegex = new RegExp(`(^|\\n)id:\\s*['\"]?${idStr}['\"]?(\\n|$)`)
              // Exact-match JSON: "id": 10 or "id": "10"
              const jsonRegex = new RegExp(`\\"id\\"\\s*:\\s*['\"]?${idStr}['\"]?\\s*(,|\\}|\\n|$)`)
              if (yamlRegex.test(content) || jsonRegex.test(content)) {
                await fs.unlink(fullPath)
                console.log(`Deleted: ${fullPath}`)
              }
            } catch {}
          }
        }
      } catch (err) {
        // Directory might not exist, that's okay
        if (err.code !== 'ENOENT') {
          console.warn(`Warning: Could not read directory ${dir}:`, err.message)
        }
      }
    }

    await findAndDeleteContentFile(CONTENT_DIR)
  }

  // Handle media sync results
  if (mediaItems.length > 0) {
    console.log(`\nProcessing media changes...`)

    // Download new/updated media files
    let downloaded = 0
    for (const mediaItem of mediaItems) {
      if (mediaItem.location) {
        const relPath = mediaItem.location.replace(/^\/api\/media\//, "")
        const destPath = path.join(MEDIA_DIR, relPath)
        const didDownload = await downloadMediaFileDirect(mediaItem.location, destPath, leadCMSUrl, leadCMSApiKey)
        if (didDownload) {
          console.log(`Downloaded: ${mediaItem.location} -> ${destPath}`)
          downloaded++
        }
      }
    }
    console.log(`\nDone. ${downloaded} media files downloaded.\n`)
  } else {
    console.log(`\nNo media changes detected.\n`)
  }  // Save new sync tokens
  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken)
    console.log(`Content sync token updated: ${nextSyncToken}`)
  }

  if (nextMediaSyncToken) {
    await writeMediaSyncToken(nextMediaSyncToken)
    console.log(`Media sync token updated: ${nextMediaSyncToken}`)
  }
}

main().catch((err) => {
  console.error("Error in fetch-leadcms-content:", err)
  process.exit(1)
})
