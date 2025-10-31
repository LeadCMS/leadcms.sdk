# Public API Mode & Security

## Security-First Design

The LeadCMS SDK follows a **security-first approach** for content retrieval:

### Read Operations (Always Public)
**All read operations are performed WITHOUT authentication**, regardless of whether an API key is configured:

- ✅ CMS config (`/api/config`) - **No API key sent**
- ✅ Content sync (`/api/content/sync`) - **No API key sent**
- ✅ Comments sync (`/api/comments/sync`) - **No API key sent**
- ✅ Media sync (`/api/media/sync`) - **No API key sent**
- ✅ Content types (`/api/content-types`) - **No API key sent**
- ✅ Media downloads (`/api/media/*`) - **No API key sent**

**Why?** This ensures that:
1. Only publicly visible data is retrieved
2. No risk of accidentally exposing private data in public builds
3. Simpler security model for static sites
4. Better separation of concerns (read vs write)

### Write Operations (Require API Key)
**Write operations require an API key** for authentication:

- 🔒 Content push (`/api/content`) - **Requires API key**
- 🔒 Content update - **Requires API key**
- 🔒 Content delete - **Requires API key**
- 🔒 Status checks (may reveal private content) - **Requires API key**

## Operation Modes

### With API Key Configured
When an API key is present in configuration:
- ✅ Read operations: Public content only (no API key sent)
- ✅ Write operations: Full access using API key
- ✅ Best for development and content management workflows

### Without API Key
When no API key is configured:
- ✅ Read operations: Public content only (same as above)
- ❌ Write operations: Will fail (no authentication)
- ✅ Best for public websites and static deployments

## Configuration

### Public Mode Setup

To use public mode, simply omit the `LEADCMS_API_KEY` from your configuration:

**.env file:**
```bash
# Only URL is required for public mode
LEADCMS_URL=https://your-cms-instance.com
LEADCMS_DEFAULT_LANGUAGE=en

# API key is optional - omit for public-only access
# LEADCMS_API_KEY=your-api-key
```

**leadcms.config.json:**
```json
{
  "url": "https://your-cms-instance.com",
  "defaultLanguage": "en",
  "contentDir": ".leadcms/content",
  "mediaDir": "public/media"
}
```

**Programmatic:**
```typescript
import { configure } from '@leadcms/sdk';

configure({
  url: 'https://your-cms-instance.com',
  // apiKey is omitted for public mode
  defaultLanguage: 'en',
  contentDir: '.leadcms/content',
  mediaDir: 'public/media'
});
```

## CLI Commands

### Commands That Work Without API Key

These commands work in public mode (without API key):

```bash
# Initialize configuration (API key is optional!)
npx leadcms init

# Pull public content and comments
npx leadcms pull

# Pull only public comments
npx leadcms pull-comments

# Check sync status
npx leadcms status

# Generate Docker templates
npx leadcms docker

# Generate environment config
npx leadcms generate-env

# Check version
npx leadcms version
```

### Commands That Require API Key

These commands **require authentication** and will fail without an API key:

```bash
# Push content (requires write access)
npx leadcms push

# Watch for real-time updates (requires SSE access)
npx leadcms watch
```

## Use Cases

### Public Website Deployment

Perfect for public-facing websites that only need published content:

```bash
# 1. Initialize without API key (anonymous mode)
npx leadcms init
# When prompted for API key, just press Enter
# This creates .env with URL and language, no API key needed

# 2. Pull public content
npx leadcms pull

# 3. Build static site
npm run build

# 4. Deploy (no secrets needed!)
docker build -t my-site .
```

**Or manually configure:**
```bash
# 1. Configure without API key
echo "LEADCMS_URL=https://cms.example.com" > .env
echo "LEADCMS_DEFAULT_LANGUAGE=en" >> .env

# 2. Continue as above...
npx leadcms pull
```

**Benefits:**
- ✅ No sensitive API keys in production
- ✅ Reduced security risk
- ✅ Simpler deployment pipeline
- ✅ Lower LeadCMS API rate limits

### Development/Staging Environment

Use authenticated mode for full access during development:

```bash
# .env.local (development only)
LEADCMS_URL=https://cms.example.com
LEADCMS_API_KEY=dev_key_with_full_access
LEADCMS_DEFAULT_LANGUAGE=en
```

**Benefits:**
- ✅ Access draft content
- ✅ Test unpublished content
- ✅ Push content changes
- ✅ Full API access

### CI/CD Pipeline

Separate public and authenticated steps:

```yaml
# .github/workflows/deploy.yml
name: Deploy

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Public pull - no secrets needed
      - name: Pull Public Content
        run: |
          echo "LEADCMS_URL=${{ vars.LEADCMS_URL }}" > .env
          npx leadcms pull
      
      - name: Build Site
        run: npm run build
      
      - name: Deploy
        run: npm run deploy

  content-sync:
    runs-on: ubuntu-latest
    steps:
      # Authenticated push - uses secrets
      - name: Push Content Changes
        env:
          LEADCMS_API_KEY: ${{ secrets.LEADCMS_API_KEY }}
        run: npx leadcms push
```

## Security Considerations

### Public Mode

**Advantages:**
- No API key exposure risk
- Can use public repositories safely
- No secrets management needed
- Can deploy to edge/CDN directly

**Limitations:**
- Only published content visible
- Cannot modify content
- No draft/preview functionality
- No private comments

### Authenticated Mode

**Required for:**
- Content editing workflows
- Preview/draft content
- Admin operations
- Two-way sync

**Security Best Practices:**
- ✅ Use environment variables, never hardcode API keys
- ✅ Use `.env.local` for local development (not committed)
- ✅ Use CI/CD secrets for deployment keys
- ✅ Rotate API keys regularly
- ✅ Use read-only API keys where possible
- ✅ Restrict API key permissions to minimum required

## API Behavior

### Read Endpoints (Always Unauthenticated)

All read endpoints including config and sync endpoints are **always called without authentication**, ensuring only public content is returned:

**Configuration Endpoint:**
```typescript
// /api/config is a public endpoint - NEVER sends authentication
GET /api/config
// NO Authorization header

// Response: public CMS configuration
{
  "defaultLanguage": "en-US",
  "languages": [...],
  "entities": [...],
  ...
}
```

**Sync Endpoints:**
All sync endpoints (`/api/content/sync`, `/api/comments/sync`, `/api/media/sync`) are **always called without authentication**:

```typescript
// SDK ALWAYS sends requests without Authorization header
GET /api/content/sync?filter[limit]=100&syncToken=
// NO Authorization header sent

// Response: only public, published content
{
  "items": [
    { "id": 1, "slug": "public-article", "published": true, ... }
  ],
  "deleted": [],
  "nextSyncToken": "abc123"
}
```

**Security Benefits:**
- ✅ Only public data retrieved
- ✅ No accidental exposure of private content
- ✅ API key cannot be intercepted during read operations
- ✅ Safer for client-side and public deployments

### Write Endpoints (Require Authentication)

Write operations require the API key:

```typescript
// Request with Authorization header for write operations
POST /api/content
Authorization: Bearer your-api-key

{
  "slug": "new-article",
  "title": "New Article",
  "body": "Content...",
  ...
}
```

## Console Output

The SDK logs the operation mode for transparency:

**Read Operations (Always Public):**
```
[FETCH_CONTENT_SYNC] Starting with syncToken: NONE
[FETCH_CONTENT_SYNC] Fetching public content (no authentication)
[FETCH_COMMENT_SYNC] Fetching public comments (no authentication)
[LeadCMS] Fetching public content types (no authentication)
```

**Write Operations (When API Key Present):**
```
[PUSH] Authenticating with API key
[PUSH] API Key: ab12cd34...
```

**Configuration Warnings:**
```
[LeadCMS] No API key provided - write operations will not be available
```

## Troubleshooting

### 403 Forbidden Errors

If you encounter 403 errors during content/comments sync:

```
[FETCH_COMMENT_SYNC] Failed on page 0: Request failed with status code 403
⛔ Access Denied (403 Forbidden)
```

**Important:** The SDK **always** fetches content, comments, and media WITHOUT authentication. A 403 error indicates:

1. **LeadCMS Configuration Issue**: The instance may not be configured to allow public access to these endpoints
2. **API Endpoint Protection**: Check if your LeadCMS has IP restrictions or CORS settings
3. **Feature Disabled**: The comments or content API may be disabled

**Solutions:**
- Contact your LeadCMS administrator to enable public API access
- Check LeadCMS configuration for public content/comments settings
- Verify CORS and IP whitelist settings
- Ensure the endpoints exist (check LeadCMS version compatibility)

### 401 Unauthorized Errors During Sync

If you get 401 errors during content/comments **read operations**:

```
[FETCH_CONTENT_SYNC] Failed: Request failed with status code 401
```

**This indicates a LeadCMS misconfiguration** - read endpoints should be publicly accessible. The SDK never sends authentication for read operations.

**Solutions:**
- Check LeadCMS API settings
- Ensure public API access is enabled
- Contact your administrator

### 401 Errors During Push/Write Operations

If you get 401 errors during **push** or other write operations:

```
[PUSH] Failed: Request failed with status code 401
```

This is expected if no API key is configured. **Solutions:**
- Add `LEADCMS_API_KEY` to your `.env` file
- Verify the API key is valid and not expired
- Check the API key has write permissions

### Missing Content in Public Mode

If content is missing:

**Expected Reasons:**
1. Content is unpublished (check `publishedAt` date)
2. Content has `visibility: private` setting
3. Content is a draft
4. Content is in review/pending state

**This is working as designed** - only public content is retrieved.

**Solutions:**
- Publish content in LeadCMS admin
- Change visibility to public
- Check content status in LeadCMS

### "No API key provided" Warning

```
[LeadCMS] No API key provided - write operations will not be available
```

This is informational, not an error:
- If you only need to pull content → **Ignore the warning**, this is expected
- If you need to push content → Add `LEADCMS_API_KEY` to your `.env` file

## Related Documentation

- [README.md](../README.md) - General SDK usage
- [COMMENTS_TROUBLESHOOTING.md](./COMMENTS_TROUBLESHOOTING.md) - Comments-specific issues
- [DEVELOPMENT.md](./DEVELOPMENT.md) - SDK development guide
