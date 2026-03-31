/**
 * SEO metadata utilities for LeadCMS SDK
 *
 * Handles mapping between human-friendly frontmatter SEO fields and API SeoMetadataDto,
 * default value computation, and diffing to avoid storing redundant values.
 */

/**
 * SEO metadata as stored in frontmatter (human-friendly field names)
 */
export interface FrontmatterSeo {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  robots?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  keywords?: string[];
}

/**
 * SEO metadata as sent/received from the API (SeoMetadataDto)
 */
export interface SeoMetadataDto {
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonicalUrl?: string | null;
  openGraphTitle?: string | null;
  openGraphDescription?: string | null;
  openGraphImageUrl?: string | null;
  robots?: string | null;
  keywords?: string[] | null;
}

/**
 * Content fields used to compute SEO defaults
 */
export interface SeoDefaultSources {
  title?: string;
  description?: string;
  coverImageUrl?: string;
}

/** Default robots value for content with SEO enabled */
export const DEFAULT_ROBOTS = 'index,follow';

/**
 * Compute default SEO values from content fields.
 * These are the values the server would infer if no explicit SEO overrides are set.
 */
export function computeSeoDefaults(sources: SeoDefaultSources): SeoMetadataDto {
  return {
    metaTitle: sources.title || null,
    metaDescription: sources.description || null,
    canonicalUrl: null,
    openGraphTitle: sources.title || null,
    openGraphDescription: sources.description || null,
    openGraphImageUrl: sources.coverImageUrl || null,
    robots: DEFAULT_ROBOTS,
    keywords: null,
  };
}

/**
 * Convert API SeoMetadataDto to frontmatter-friendly seo object,
 * stripping any values that match the computed defaults.
 *
 * Returns undefined if all values match defaults (nothing to override).
 */
export function apiSeoToFrontmatter(
  apiSeo: SeoMetadataDto | null | undefined,
  sources: SeoDefaultSources
): FrontmatterSeo | undefined {
  if (!apiSeo) return undefined;

  const defaults = computeSeoDefaults(sources);
  const fm: FrontmatterSeo = {};

  if (apiSeo.metaTitle && apiSeo.metaTitle !== defaults.metaTitle) {
    fm.title = apiSeo.metaTitle;
  }
  if (apiSeo.metaDescription && apiSeo.metaDescription !== defaults.metaDescription) {
    fm.description = apiSeo.metaDescription;
  }
  if (apiSeo.canonicalUrl) {
    fm.canonicalUrl = apiSeo.canonicalUrl;
  }
  if (apiSeo.robots && apiSeo.robots !== defaults.robots) {
    fm.robots = apiSeo.robots;
  }
  if (apiSeo.openGraphTitle && apiSeo.openGraphTitle !== defaults.openGraphTitle) {
    fm.ogTitle = apiSeo.openGraphTitle;
  }
  if (apiSeo.openGraphDescription && apiSeo.openGraphDescription !== defaults.openGraphDescription) {
    fm.ogDescription = apiSeo.openGraphDescription;
  }
  if (apiSeo.openGraphImageUrl && apiSeo.openGraphImageUrl !== defaults.openGraphImageUrl) {
    fm.ogImage = apiSeo.openGraphImageUrl;
  }
  if (apiSeo.keywords && apiSeo.keywords.length > 0) {
    fm.keywords = apiSeo.keywords;
  }

  // Return undefined if no overrides exist
  if (Object.keys(fm).length === 0) return undefined;
  return fm;
}

/**
 * Convert frontmatter seo object back to API SeoMetadataDto.
 * Only includes fields that are explicitly set (non-default overrides).
 * Fields not present in frontmatter are sent as null to let the server use defaults.
 */
export function frontmatterSeoToApi(
  fmSeo: FrontmatterSeo | undefined,
  sources: SeoDefaultSources
): SeoMetadataDto | undefined {
  if (!fmSeo || Object.keys(fmSeo).length === 0) return undefined;

  const defaults = computeSeoDefaults(sources);
  const dto: SeoMetadataDto = {};

  // Only send values that differ from defaults
  if (fmSeo.title && fmSeo.title !== defaults.metaTitle) {
    dto.metaTitle = fmSeo.title;
  }
  if (fmSeo.description && fmSeo.description !== defaults.metaDescription) {
    dto.metaDescription = fmSeo.description;
  }
  if (fmSeo.canonicalUrl) {
    dto.canonicalUrl = fmSeo.canonicalUrl;
  }
  if (fmSeo.robots && fmSeo.robots !== defaults.robots) {
    dto.robots = fmSeo.robots;
  }
  if (fmSeo.ogTitle && fmSeo.ogTitle !== defaults.openGraphTitle) {
    dto.openGraphTitle = fmSeo.ogTitle;
  }
  if (fmSeo.ogDescription && fmSeo.ogDescription !== defaults.openGraphDescription) {
    dto.openGraphDescription = fmSeo.ogDescription;
  }
  if (fmSeo.ogImage && fmSeo.ogImage !== defaults.openGraphImageUrl) {
    dto.openGraphImageUrl = fmSeo.ogImage;
  }
  if (fmSeo.keywords && fmSeo.keywords.length > 0) {
    dto.keywords = fmSeo.keywords;
  }

  if (Object.keys(dto).length === 0) return undefined;
  return dto;
}
