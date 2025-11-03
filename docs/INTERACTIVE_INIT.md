# Interactive Init Command

## Overview

The `leadcms init` command provides an interactive setup wizard that connects to your LeadCMS instance, fetches configuration, and optionally handles authentication - all in a single command.

## Features

- 🔌 Auto-fetches default language from LeadCMS
- 🔐 Integrated authentication (optional)
- 📁 Smart config file management
- ✨ Intelligent defaults

## Usage

```bash
npx leadcms init
```

## Interactive Flow

### 1. URL Input
```
Enter your LeadCMS URL: https://your-instance.leadcms.ai
```

### 2. Authentication (Optional)

**With existing API key:**
```
✓ API key found in environment
```

**Without API key:**
```
🔐 Authentication Setup
   Authentication is optional and can be skipped for most use cases.
   • Without authentication: You can pull content and build your site (read-only access)
   • With authentication: You can also push content changes back to LeadCMS
   • You can always authenticate later by running: leadcms login

Would you like to authenticate now? (Y/n):
```

- **Yes**: Runs authentication flow (device auth or manual)
- **No**: Continues in read-only mode

### 3. CMS Configuration

Automatically fetches from public `/api/config` endpoint:

```
🔍 Connecting to LeadCMS...
✅ Connected successfully!

📋 Available languages:
   1. English (United States) [en-US] (default)
   2. Russian (Russia) [ru-RU]

Default language code [en-US]: 
✓ Using default language: en-US

📦 Supported entity types:
   ✓ Content
   ✓ Media
   ✓ Comments
```

### 4. Directory Configuration

```
Content directory [.leadcms/content]:
Media directory [public/media]:
Comments directory [.leadcms/comments]:
```

Press Enter for defaults or specify custom paths.

### 5. File Creation

```
📝 Creating configuration files...

✅ Updated .env
ℹ️  Using default directories, no leadcms.config.json needed.
```

Creates:
- **`.env`** with URL, language, and optionally API key
- **`leadcms.config.json`** only if custom directories specified

## Configuration Files

### .env (with API key)
```bash
LEADCMS_URL=https://your-instance.leadcms.ai
LEADCMS_API_KEY=your-api-key
LEADCMS_DEFAULT_LANGUAGE=en-US
```

### .env (without API key)
```bash
LEADCMS_URL=https://your-instance.leadcms.ai
LEADCMS_DEFAULT_LANGUAGE=en-US
# Add LEADCMS_API_KEY for write operations
```

### leadcms.config.json (only if needed)
```json
{
  "contentDir": "custom/content/path",
  "mediaDir": "custom/media/path"
}
```

## Next Steps

After initialization:

```bash
# Pull content
npx leadcms pull

# Use in your app
import { getCMSContentBySlugForLocale } from '@leadcms/sdk';
const content = getCMSContentBySlugForLocale('about', 'en-US');
```

## Advantages

| Manual Setup | `leadcms init` |
|--------------|----------------|
| Must look up default language | Auto-detected |
| Unknown available languages | Displayed during setup |
| Multiple steps | Single command |
| Manual credential storage | Automatic |
| Always creates config file | Only if needed |
| Unclear auth requirements | Integrated with guidance |

## Related Documentation

- [README.md](../README.md) - Main documentation
- [PUBLIC_API_MODE.md](./PUBLIC_API_MODE.md) - Authentication details
