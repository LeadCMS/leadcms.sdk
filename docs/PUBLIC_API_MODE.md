# Public API Mode & Security

## Overview

The LeadCMS SDK operates in two modes based on API key presence:

**Public Mode (No API Key):**
- ✅ Read operations: Pull public content, comments, media
- ❌ Write operations: Cannot push content changes
- ✅ Best for: Static sites, production deployments

**Authenticated Mode (With API Key):**
- ✅ Read operations: Same public data (API key not sent)
- ✅ Write operations: Push content using API key
- ✅ Best for: Development, content management

### Security Model

All read operations use public endpoints without authentication, ensuring:
- Only published content is accessible
- No risk of exposing private data in builds
- Safe deployment without secrets management

## Configuration

**Public Mode (no API key):**
```bash
# .env
LEADCMS_URL=https://your-cms-instance.com
LEADCMS_DEFAULT_LANGUAGE=en
```

**Authenticated Mode (with API key):**
```bash
# .env (development) or CI/CD secrets (production)
LEADCMS_URL=https://your-cms-instance.com
LEADCMS_API_KEY=your-api-key
LEADCMS_DEFAULT_LANGUAGE=en
```

## CLI Commands by Mode

| Command | Public Mode | Authenticated Mode |
|---------|-------------|-------------------|
| `npx leadcms init` | ✅ Works | ✅ Works |
| `npx leadcms pull*` | ✅ Works | ✅ Works |
| `npx leadcms status` | ✅ Works | ✅ Works |
| `npx leadcms docker` | ✅ Works | ✅ Works |
| `npx leadcms push` | ❌ Fails (401) | ✅ Works |
| `npx leadcms watch` | ❌ Fails (401) | ✅ Works |

*Includes `pull-content`, `pull-comments`, `pull-media`

## Typical Workflows

### Production Static Site (Public Mode)

```bash
# 1. Setup without API key
npx leadcms init
# Press Enter when prompted for API key

# 2. Pull and build
npx leadcms pull
npm run build
```

### Development & Preview Environment (Authenticated Mode)

```bash
# 1. Setup with API key in .env
LEADCMS_API_KEY=dev_key

# 2. Full workflow
npx leadcms pull    # Get latest content
# Edit content locally
npx leadcms push    # Upload changes
npx leadcms watch   # Real-time updates (requires API key)
```

## Security Best Practices

**API Key Management:**
- ✅ Never commit API keys to version control
- ✅ Use `.env` for development (gitignored)
- ✅ Use CI/CD secrets for deployment
- ✅ Rotate API keys regularly

**Mode Selection:**
- **Production sites**: Use public mode when possible (no secrets required)
- **Development & Preview**: Use authenticated mode for content editing and `watch` command
- **Public repositories**: Prefer public mode to avoid secret exposure

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `403 Forbidden` during sync | Instance not configured for public access | Contact administrator to enable public API |
| `401 Unauthorized` during push | No API key (expected in public mode) | Add `LEADCMS_API_KEY` or use authenticated mode |
| Missing content | Only published content is accessible | Publish content in LeadCMS admin |
| "No API key provided" warning | Informational message | Normal in public mode; add key for write access |

## Related Documentation

- [README.md](../README.md) - Main documentation
- [INTERACTIVE_INIT.md](./INTERACTIVE_INIT.md) - Setup guide
