# getAllContentForLocale - Optimization Example

The new `getAllContentForLocale()` function optimizes the common pattern of fetching content by eliminating the need to first get slugs and then fetch content individually.

## Before (Repetitive Pattern)

```typescript
// Old pattern: Get slugs first, then fetch content one by one
const blogSlugs = getAllContentSlugsForLocale(locale, ['blog-article'], userUid as any);
const blogPosts: BlogPost[] = blogSlugs
  .map((slug: string) => {
    const postContent = getCMSContentBySlugForLocale(slug, locale, userUid as any);
    if (!postContent || postContent.type !== 'blog-article') return null;

    return {
      slug: postContent.slug,
      title: postContent.title || '',
      description: postContent.description || '',
      excerpt: (postContent.excerpt as string | undefined) || postContent.description || '',
      author: postContent.author,
      publishedAt: postContent.publishedAt || postContent.createdAt,
      category: postContent.category,
      tags: postContent.tags as string[] | undefined,
      featured: postContent.featured as boolean | undefined,
      coverImageUrl: postContent.coverImageUrl as string | undefined,
      body: postContent.body,
    } as BlogPost;
  })
  .filter((post: BlogPost | null): post is BlogPost => post !== null)
  .sort((a: BlogPost, b: BlogPost) => {
    // Sort featured posts first, then by published date
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
```

**Issues with the old pattern:**
- Multiple function calls (1 + N where N is number of slugs)
- Repetitive filtering and null checking
- Type casting with `as any`
- Manual content type validation

## After (Optimized Pattern)

```typescript
// New pattern: Get content objects directly
import { getAllContentForLocale } from '@leadcms/sdk';

const blogPosts: BlogPost[] = getAllContentForLocale(locale, ['blog-article'], userUid)
  .map((postContent) => ({
    slug: postContent.slug,
    title: postContent.title || '',
    description: postContent.description || '',
    excerpt: (postContent.excerpt as string | undefined) || postContent.description || '',
    author: postContent.author,
    publishedAt: postContent.publishedAt || postContent.createdAt,
    category: postContent.category,
    tags: postContent.tags as string[] | undefined,
    featured: postContent.featured as boolean | undefined,
    coverImageUrl: postContent.coverImageUrl as string | undefined,
    body: postContent.body,
  } as BlogPost))
  .sort((a: BlogPost, b: BlogPost) => {
    // Sort featured posts first, then by published date
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
```

**Benefits of the new pattern:**
- ✅ Single function call instead of 1 + N calls
- ✅ Content type filtering handled internally  
- ✅ No manual null checking needed
- ✅ No type casting required
- ✅ Same security and draft isolation rules apply
- ✅ Consistent with environment-based draft detection

## Performance Comparison

```typescript
// Performance test example
const startTime = Date.now();

// Old pattern: 1 + N function calls
const slugs = getAllContentSlugsForLocale('en', ['blog-article']);
const oldPattern = slugs.map(slug => getCMSContentBySlugForLocale(slug, 'en'));

const oldPatternTime = Date.now() - startTime;

const startTime2 = Date.now();

// New pattern: 1 function call
const newPattern = getAllContentForLocale('en', ['blog-article']);

const newPatternTime = Date.now() - startTime2;

console.log(`Old pattern: ${oldPatternTime}ms (${slugs.length + 1} function calls)`);
console.log(`New pattern: ${newPatternTime}ms (1 function call)`);
```

## Usage Examples

### Basic Content Retrieval
```typescript
// Get all articles
const articles = getAllContentForLocale('en', ['article']);

// Get all content (any type)
const allContent = getAllContentForLocale('en');

// Get user-specific content (includes user's drafts)
const userContent = getAllContentForLocale('en', undefined, userUid);
```

### Blog Post Listing
```typescript
interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: Date;
  featured?: boolean;
}

const blogPosts: BlogPost[] = getAllContentForLocale('en', ['blog-post'])
  .map(content => ({
    slug: content.slug,
    title: content.title,
    excerpt: content.excerpt || content.description,
    publishedAt: new Date(content.publishedAt || content.createdAt),
    featured: content.featured as boolean,
  }))
  .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
```

### Product Catalog
```typescript
interface Product {
  slug: string;
  name: string;
  price: number;
  category: string;
  inStock: boolean;
}

const products: Product[] = getAllContentForLocale('en', ['product'])
  .filter(content => content.published) // Additional filtering
  .map(content => ({
    slug: content.slug,
    name: content.title,
    price: content.price as number,
    category: content.category,
    inStock: content.inStock as boolean,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
```

### Multi-language Content
```typescript
// Get content for specific locale
const englishPosts = getAllContentForLocale('en', ['blog-post']);
const spanishPosts = getAllContentForLocale('es', ['blog-post']);

// Combine for multi-language site
const allLocalizedPosts = [
  ...englishPosts.map(post => ({ ...post, locale: 'en' })),
  ...spanishPosts.map(post => ({ ...post, locale: 'es' })),
];
```

## Draft Handling

The new function respects all the same draft handling rules as the existing functions:

```typescript
// Development mode - includes drafts when userUid provided
process.env.NODE_ENV = 'development';
const devContent = getAllContentForLocale('en', ['article'], userUid);
// Returns: published articles + user's draft articles

// Production mode - only published content
process.env.NODE_ENV = 'production'; 
const prodContent = getAllContentForLocale('en', ['article'], userUid);
// Returns: only published articles (drafts filtered out)

// Force preview mode
process.env.LEADCMS_PREVIEW = 'true';
const previewContent = getAllContentForLocale('en', ['article'], userUid);
// Returns: published articles + user's draft articles
```

## Migration Guide

### Step 1: Update imports
```typescript
// Add the new function to your imports
import { 
  getAllContentForLocale,  // <- Add this
  getAllContentSlugsForLocale, 
  getCMSContentBySlugForLocale 
} from '@leadcms/sdk';
```

### Step 2: Replace the pattern
```typescript
// Before
const slugs = getAllContentSlugsForLocale(locale, contentTypes, userUid);
const content = slugs
  .map(slug => getCMSContentBySlugForLocale(slug, locale, userUid))
  .filter(item => item !== null);

// After  
const content = getAllContentForLocale(locale, contentTypes, userUid);
```

### Step 3: Remove redundant filtering
```typescript
// Before - needed manual type checking
const validContent = content.filter(item => item.type === 'blog-post');

// After - type filtering handled by contentTypes parameter
const validContent = getAllContentForLocale(locale, ['blog-post'], userUid);
```

This optimization reduces code complexity, improves performance, and maintains all existing security and draft handling behaviors.