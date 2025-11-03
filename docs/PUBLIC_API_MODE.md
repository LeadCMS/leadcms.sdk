# Public API Mode & Security

## Security-First Design

The LeadCMS SDK uses a **security-first approach** for all operations:

### Read Operations (Always Public)

**All read operations are performed WITHOUT authentication:**

- ✅ CMS config (`/api/config`)
- ✅ Content sync (`/api/content/sync`)
- ✅ Comments sync (`/api/comments/sync`)
- ✅ Media sync (`/api/media/sync`)
- ✅ Content types (`/api/content-types`)

**Why?** This ensures:
1. Only public data is retrieved
2. No risk of exposing private data in public builds
3. Simpler security model
4. Better separation of concerns

### Write Operations (Require API Key)

**Write operations require authentication:**

- 🔒 Content push (`/api/content`)
- 🔒 Content updates
- 🔒 Content deletion

## Operation Modes

### With API Key
- ✅ Read: Public content only (no API key sent)
- ✅ Write: Full access using API key
- ✅ Best for: Development and content management

### Without API Key
- ✅ Read: Public content only
- ❌ Write: Will fail
- ✅ Best for: Public websites and static sites

## Configuration

### Public Mode Setup

Omit `LEADCMS_API_KEY` from configuration:

```bash
# .env
LEADCMS_URL=https://your-cms-instance.com
LEADCMS_DEFAULT_LANGUAGE=en
# No API key needed
```

## CLI Commands

### Work Without API Key

```bash
npx leadcms init          # Interactive setup
npx leadcms pull          # Pull public content
npx leadcms pull-comments # Pull public comments
npx leadcms status        # Check sync status
npx leadcms docker        # Generate templates
```

### Require API Key

```bash
npx leadcms push          # Push content changes
npx leadcms watch         # Real-time updates
```

## Use Cases

### Public Website

Perfect for static sites with public content only:

```bash
# 1. Initialize (no API key)
npx leadcms init
# Press Enter when prompted for API key

# 2. Pull content
npx leadcms pull

# 3. Build and deploy
npm run build
```

**Benefits:**
- ✅ No secrets in production
- ✅ Reduced security risk
- ✅ Simpler deployment

### Development Environment

Use API key for full access:

```bash
# .env.local
LEADCMS_URL=https://cms.example.com
LEADCMS_API_KEY=dev_key
LEADCMS_DEFAULT_LANGUAGE=en
```

**Benefits:**
- ✅ Access draft content
- ✅ Push content changes
- ✅ Full API access

### CI/CD Pipeline

Separate public and authenticated steps:

```yaml
jobs:
  build:
    steps:
      # Public pull - no secrets
      - name: Pull Content
        run: |
          echo "LEADCMS_URL=${{ vars.LEADCMS_URL }}" > .env
          npx leadcms pull
      
      - name: Build
        run: npm run build

  content-sync:
    steps:
      # Authenticated push - uses secrets
      - name: Push Changes
        env:
          LEADCMS_API_KEY: ${{ secrets.LEADCMS_API_KEY }}
        run: npx leadcms push
```

## API Behavior

### Read Endpoints

**Always called without authentication:**

```http
GET /api/config
GET /api/content/sync
GET /api/comments/sync
# No Authorization header sent
```

Response includes only public data.

### Write Endpoints

**Require authentication:**

```http
POST /api/content
Authorization: Bearer your-api-key
```

## Security Best Practices

### Public Mode

**Advantages:**
- No API key exposure risk
- Safe for public repositories
- No secrets management
- Deploy to edge/CDN directly

**Limitations:**
- Only published content visible
- Cannot modify content
- No draft/preview functionality

### Authenticated Mode

**Best Practices:**
- ✅ Use environment variables only
- ✅ Use `.env.local` for development (not committed)
- ✅ Use CI/CD secrets for deployment
- ✅ Rotate API keys regularly
- ✅ Use read-only keys where possible

## Troubleshooting

### 403 Forbidden During Sync

```
[FETCH_COMMENT_SYNC] Failed: 403 Forbidden
```

**Cause:** LeadCMS instance not configured for public access

**Solution:**
- Contact LeadCMS administrator
- Enable public API access
- Check CORS and IP settings

### 401 During Push

```
[PUSH] Failed: 401 Unauthorized
```

**Expected if no API key configured.**

**Solution:**
- Add `LEADCMS_API_KEY` to `.env`
- Verify key is valid
- Check key has write permissions

### Missing Content

**Expected:** Only published content is retrieved.

**Reasons:**
1. Content is unpublished
2. Content has `visibility: private`
3. Content is in draft
4. Content pending review

**Solution:** Publish content in LeadCMS admin

### "No API key provided" Warning

```
[LeadCMS] No API key provided
```

**This is informational, not an error.**

- Ignore if you only need to pull content
- Add API key if you need to push content

## Related Documentation

- [README.md](../README.md) - Main documentation
- [INTERACTIVE_INIT.md](./INTERACTIVE_INIT.md) - Setup guide
