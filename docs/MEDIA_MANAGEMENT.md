# Media Management Guide

## Overview

The LeadCMS SDK automatically handles media file synchronization, storing files locally and providing utilities for media management. Media files are downloaded during content sync and organized in your configured media directory.

## Quick Start

### Sync Media Files

```bash
# Pull all media files
npx leadcms pull

# Pull only media (no content, no comments)
npx leadcms pull-media
```

## Configuration

### Media Directory Setup

Default media directory is `public/media`, which works for most frameworks:

```bash
# .env
LEADCMS_URL=https://your-cms-instance.com
LEADCMS_MEDIA_DIR=public/media
```

Or in `leadcms.config.json`:

```json
{
  "mediaDir": "public/media"
}
```

### Framework-Specific Paths

**Next.js:**
```bash
LEADCMS_MEDIA_DIR=public/media
# Accessible at: /media/filename.jpg
```

**Astro:**
```bash
LEADCMS_MEDIA_DIR=public/media
# Accessible at: /media/filename.jpg
```

**Gatsby:**
```bash
LEADCMS_MEDIA_DIR=static/media
# Accessible at: /media/filename.jpg
```

**Nuxt:**
```bash
LEADCMS_MEDIA_DIR=public/media
# Accessible at: /media/filename.jpg
```

## Media Sync Behavior

### Automatic Media Extraction

The SDK automatically detects and downloads media files referenced in your content:

1. **Content Parsing**: Extracts media URLs from content body
2. **Smart Download**: Downloads only new or updated files
3. **Local Storage**: Saves to configured media directory
4. **Reference Update**: Content references work immediately

### Supported Media References

**Markdown Images:**
```markdown
![Alt text](/api/media/about-us/image.jpg)
```

**HTML Images:**
```html
<img src="/api/media/about-us/photo.jpg" alt="Photo">
```

**Other Media:**
```markdown
[Download PDF](/api/media/document.pdf)
<video src="/api/media/about-us/video.mp4"></video>
<audio src="/api/media/about-us/audio.mp3"></audio>
```

## Media Directory Structure

Media files are typically organized by content slug paths:

```
public/
  media/
    blog-article/           # Content slug folder
      hero-image.jpg
      diagram.png
      video-intro.mp4
    another-article/
      thumbnail.jpg
      attachment.pdf
    about-us/
      team-photo.jpg
      company-logo.svg
    shared/                 # Shared media across content
      icons/
        favicon.ico
        social-icons.svg
```

**Organization patterns:**
- **By content slug** (most common): `/media/{content-slug}/filename.ext`
- **By media type**: `/media/images/`, `/media/documents/`, `/media/videos/`
- **Shared media**: `/media/shared/` for assets used across multiple content items

**Important:** Media files cannot be placed directly in the root `media/` directory. They must be organized in subdirectories.

## Using Media in Your Application

### In Content

Media is referenced in content and automatically works after sync:

```markdown
---
title: "My Blog Article"
slug: "my-blog-article" 
---

![Hero Image](/api/media/blog/my-blog-article/hero.jpg)

Check out this [PDF guide](/api/media/blog/my-blog-article/guide.pdf).

![Shared logo](/api/media/shared/icons/logo.svg)
```

After sync, these paths are accessible in your built site.

## Media Path Transformation

The LeadCMS SDK automatically handles path transformation between CMS and local formats during pull/push operations:

### CMS Format (LeadCMS Admin UI)
When editing content in the LeadCMS admin interface, media references use the `/api/media/` prefix:

```markdown
![Hero Image](/api/media/my-article/hero.jpg)
[Download PDF](/api/media/my-article/guide.pdf)
```

### Local Format (After Pull)
When content is pulled locally, media paths are automatically transformed to the local format without `/api/`:

```markdown
![Hero Image](/media/my-article/hero.jpg)
[Download PDF](/media/my-article/guide.pdf)
```

### Transformation Process

**During Pull (`npx leadcms pull`):**
- Content with `/api/media/` references is downloaded
- SDK transformation script converts `/api/media/` → `/media/` in content files
- Local MDX/JSON files use the `/media/` format for static site compatibility

**During Push (`npx leadcms push`):**
- Local content with `/media/` references is processed
- SDK transformation script converts `/media/` → `/api/media/` before uploading
- CMS receives content with proper `/api/media/` references

**Why This Matters:**
- **Static Sites**: Need `/media/` paths to reference files in the `public/media/` directory
- **CMS Admin**: Needs `/api/media/` paths to properly preview and manage media through the LeadCMS API
- **Seamless Workflow**: Developers work with standard static site paths locally, while CMS maintains API-based references

### In Components

**Next.js:**
```typescript
import Image from 'next/image';

export default function Article({ content }) {
  return (
    <div>
      {/* Use local /media/ format in components */}
      <Image 
        src="/media/blog/my-article/hero.jpg" 
        alt="Hero" 
        width={800} 
        height={600} 
      />
      {/* Content body already has transformed /media/ paths */}
      <div dangerouslySetInnerHTML={{ __html: content.body }} />
    </div>
  );
}
```

**Astro:**
```astro
---
const { content } = Astro.props;
---

<article>
  <img src="/media/hero.jpg" alt="Hero" />
  <div set:html={content.body} />
</article>
```

**React (Generic):**
```typescript
export default function Article({ content }) {
  return (
    <article>
      <img src="/media/hero.jpg" alt="Hero" />
      <div dangerouslySetInnerHTML={{ __html: content.body }} />
    </article>
  );
}
```

## Media File Information

### File Organization

Media files maintain their original:
- Filename
- Extension
- Directory structure (if using subdirectories)

### File Types Supported

**Media Files:**
- **Images**: `.png`, `.jpg`, `.jpeg`, `.ico`, `.webp`, `.svg`, `.gif`, `.avif`
- **Videos**: `.mp4`
- **Documents**: `.pdf`

**Other Files:**
- **Archives**: `.zip`
- **Documents**: `.doc`, `.docx`, `.txt`
- **XML Files**: `.xml`, `.xmlx`, `.xmlm`

> **Note**: These are the default supported file types in LeadCMS. The exact list may vary by instance configuration.

## Media Sync Process

### How Media Sync Works

1. **Content Analysis**: SDK scans all content for media references
2. **URL Detection**: Identifies media URLs matching LeadCMS patterns
3. **Deduplication**: Tracks already-downloaded files
4. **Download**: Fetches missing or updated media
5. **Storage**: Saves to configured media directory
6. **Verification**: Ensures files are accessible

### Incremental Sync

Media sync is incremental:
- Only downloads new or updated files
- Skips existing files with matching names
- Tracks download status per file

### Manual Media Sync

```bash
# Sync only media
npx leadcms pull-media

# Full sync (content + media + comments)
npx leadcms pull
```

## Security & Authentication

### Public Media Access

**Media files are accessed without authentication** during sync:

```bash
# No API key needed for media download
LEADCMS_URL=https://your-cms.com
npx leadcms pull-media
```

This ensures only publicly accessible media is downloaded.

See [Public API Mode](./PUBLIC_API_MODE.md) for details.

## Deployment Considerations

### Static Site Deployment

Media files are part of your static build:

```bash
# Build process
npx leadcms pull      # Download content and media
npm run build         # Build static site
npm run deploy        # Deploy with media included
```

## Media File Size Limitations

### LeadCMS Upload Limits

LeadCMS has built-in file size limitations to ensure optimal performance:

**Media File Limits (Default):**
- **Images** (`.png`, `.jpg`, `.jpeg`, `.ico`, `.webp`, `.svg`, `.gif`): **500KB**
- **AVIF Images** (`.avif`): **2MB**
- **Videos** (`.mp4`): **10MB**
- **PDFs** (`.pdf`): **20MB**

**Other File Limits (Default):**
- **Documents** (`.doc`, `.docx`, `.txt`, `.xml`, `.xmlx`, `.xmlm`): **1MB**
- **ZIP Archives** (`.zip`): **3MB**

**Supported File Types:**
- **Media**: `.png`, `.jpg`, `.jpeg`, `.ico`, `.webp`, `.svg`, `.gif`, `.mp4`, `.avif`, `.pdf`
- **Files**: `.zip`, `.xml`, `.xmlx`, `.xmlm`, `.doc`, `.docx`, `.txt`

> **Note**: These limits can be customized per LeadCMS instance via environment variables. For the most up-to-date configuration, see the [LeadCMS Core configuration](https://github.com/LeadCMS/leadcms.core/blob/cc4a32701ab934ad1215faa48add79608f5f1996/src/LeadCMS/appsettings.json#L99).

### Important Considerations

**Size Limit Increases:**
- While it's possible to increase these limits in LeadCMS configuration, **this is not recommended**
- Larger media files can significantly impact:
  - Site loading speed
  - Lighthouse performance scores
  - User experience on slower connections
  - Mobile device performance

**No Backend Compression:**
- **LeadCMS backend** does not provide automatic media compression or optimization
- LeadCMS expects media files to be uploaded in already optimized format
- This backend feature may be added in future releases
- **Pre-optimize** all media before uploading (see Performance Tips below for tools and techniques)

### Best Practices for Content Creators

**For Images:**
- **Compress images** before uploading (aim for under 500KB)
- **Use appropriate formats**:
  - Photos: JPEG with 70-85% quality
  - Graphics with transparency: PNG (optimized)
  - Simple graphics: SVG when possible
- **Resize images** to actual display dimensions
- **Use online tools**: TinyPNG, ImageOptim, or similar services

**For Documents:**
- **Optimize PDFs** before upload
- **Remove unnecessary metadata** and embedded fonts when possible
- **Consider alternative formats** for large documents (external hosting, CDN)

**For Videos:**
- **Compress videos** significantly or use external hosting (YouTube, Vimeo)
- **Consider thumbnails** instead of auto-playing videos
- **Use appropriate codecs**: H.264 for web compatibility

### Workflow Recommendations

1. **Train content creators** on media optimization best practices
2. **Establish guidelines** for acceptable file sizes and formats
3. **Use external CDNs** for large media files when necessary
4. **Monitor performance** regularly with tools like Lighthouse
5. **Pre-optimize media** before uploading to LeadCMS (see Performance Tips below for guidance)

## Performance Tips

Since LeadCMS backend expects pre-optimized media uploads, ensure your media files are properly optimized before uploading:

### Pre-Upload Optimization

1. **Compress images** before uploading to LeadCMS
2. **Use appropriate formats**:
   - Photos: `.jpg` (70-85% quality), `.webp`
   - Graphics: `.png` (optimized), `.svg`
   - Modern browsers: `.avif` (best compression)
3. **Resize images** to actual display dimensions
4. **Optimize videos** before upload to stay within size limits

### Tools for Optimization

- **Online tools**: TinyPNG, ImageOptim, Squoosh
- **Command line**: ImageMagick, FFmpeg for videos
- **Design software**: Export with web optimization settings

## Related Documentation

- [Content Management](./CONTENT_MANAGEMENT.md) - Working with content
- [Public API Mode](./PUBLIC_API_MODE.md) - Security and authentication
- [README](../README.md) - Main documentation
