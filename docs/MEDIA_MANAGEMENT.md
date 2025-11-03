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

# Check sync status
npx leadcms status
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
![Alt text](/api/media/image.jpg)
![Logo](https://your-cms.com/api/media/logo.png)
```

**HTML Images:**
```html
<img src="/api/media/photo.jpg" alt="Photo">
<img src="https://your-cms.com/api/media/banner.png">
```

**Other Media:**
```markdown
[Download PDF](/api/media/document.pdf)
<video src="/api/media/video.mp4"></video>
<audio src="/api/media/audio.mp3"></audio>
```

## Media Directory Structure

```
public/
  media/
    image1.jpg              # Images
    image2.png
    document.pdf            # Documents
    video.mp4               # Videos
    audio.mp3               # Audio files
    icons/
      favicon.ico           # Organized in subdirectories
      logo.svg
```

## Using Media in Your Application

### In Content

Media is referenced in content and automatically works after sync:

```markdown
---
title: "My Article"
---

![Hero Image](/api/media/hero.jpg)

Check out this [PDF guide](/api/media/guide.pdf).
```

After sync, these paths are accessible in your built site.

### In Components

**Next.js:**
```typescript
import Image from 'next/image';

export default function Article({ content }) {
  return (
    <div>
      <Image 
        src="/media/hero.jpg" 
        alt="Hero" 
        width={800} 
        height={600} 
      />
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

- **Images**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`
- **Documents**: `.pdf`, `.doc`, `.docx`, `.txt`
- **Videos**: `.mp4`, `.webm`, `.mov`, `.avi`
- **Audio**: `.mp3`, `.wav`, `.ogg`
- **Other**: Any file type served by LeadCMS

## Advanced Media Handling

### Custom Media Processing

You can process downloaded media files after sync:

```javascript
// scripts/process-media.js
import fs from 'fs';
import path from 'path';
import sharp from 'sharp'; // Image processing library

const mediaDir = './public/media';

// Generate thumbnails
fs.readdirSync(mediaDir)
  .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
  .forEach(async (file) => {
    const input = path.join(mediaDir, file);
    const output = path.join(mediaDir, 'thumbs', file);
    
    await sharp(input)
      .resize(200, 200, { fit: 'cover' })
      .toFile(output);
  });
```

### Optimizing Media

**Next.js (Automatic):**
Next.js automatically optimizes images:
```typescript
import Image from 'next/image';

<Image 
  src="/media/photo.jpg" 
  width={800} 
  height={600} 
  alt="Photo"
  // Automatically optimized
/>
```

**Build-Time Optimization:**
```bash
# Install image optimization tool
npm install sharp

# Add to build script
"scripts": {
  "prebuild": "npx leadcms pull && node scripts/optimize-images.js",
  "build": "next build"
}
```

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

# Check what needs syncing
npx leadcms status
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

### Private Media

If your LeadCMS instance has private media:
- Private media won't be downloaded without authentication
- Add API key for access to private media:

```bash
LEADCMS_URL=https://your-cms.com
LEADCMS_API_KEY=your-api-key
npx leadcms pull-media
```

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

### CDN Deployment

For CDN deployment, media is served from your CDN:

```bash
# After build
public/
  media/              # These files go to CDN
    image.jpg
    video.mp4
```

### Docker Deployment

Media is included in Docker image:

```dockerfile
# Dockerfile
FROM node:20-alpine

COPY public/media /app/public/media

# Media files are part of the image
```

## Troubleshooting

### Media Not Downloading

**Check content references:**
```bash
# Verify media URLs in content
grep -r "api/media" .leadcms/content/
```

**Check media directory:**
```bash
# Verify directory exists and is writable
ls -la public/media/
```

**Check sync status:**
```bash
npx leadcms status
```

### Media 404 Errors

**Verify path configuration:**
```bash
# Check media directory setting
cat .env | grep MEDIA_DIR
```

**Check file existence:**
```bash
# Verify file was downloaded
ls -la public/media/image.jpg
```

**Check framework config:**
- Next.js: Files in `public/` are served at root
- Astro: Files in `public/` are served at root
- Gatsby: Files in `static/` are served at root

### Large Media Files

For large media files:

1. **Increase timeout** (if needed):
```typescript
// Custom download with timeout
import { configure } from '@leadcms/sdk';

configure({
  url: 'https://your-cms.com',
  // Extend timeout for large files
});
```

2. **Use CDN** for large files:
Store large files on CDN and reference directly:
```markdown
![Large Image](https://cdn.example.com/large-image.jpg)
```

3. **Selective sync**:
Only sync media you need by filtering content types.

## Performance Tips

### Optimize Sync Speed

1. **Use incremental sync** (automatic)
2. **Filter content types** to sync less media
3. **Use parallel downloads** (automatic)
4. **Cache media files** in CI/CD

### Reduce Media Size

1. **Compress images** before uploading to LeadCMS
2. **Use appropriate formats**:
   - Photos: `.jpg`, `.webp`
   - Graphics: `.png`, `.svg`
   - Videos: `.mp4` (H.264)
3. **Optimize during build**:

```bash
# Build script
"scripts": {
  "prebuild": "npx leadcms pull && node scripts/optimize-media.js",
  "build": "next build"
}
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Deploy

jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      
      - name: Pull Media
        env:
          LEADCMS_URL: ${{ vars.LEADCMS_URL }}
        run: npx leadcms pull-media
      
      - name: Build
        run: npm run build
      
      - name: Deploy
        run: npm run deploy
```

### Caching Media

Cache media in CI/CD to speed up builds:

```yaml
- name: Cache Media
  uses: actions/cache@v3
  with:
    path: public/media
    key: media-${{ hashFiles('.leadcms/media-sync-token.txt') }}
    restore-keys: media-
```

## Related Documentation

- [Content Management](./CONTENT_MANAGEMENT.md) - Working with content
- [Public API Mode](./PUBLIC_API_MODE.md) - Security and authentication
- [README](../README.md) - Main documentation
