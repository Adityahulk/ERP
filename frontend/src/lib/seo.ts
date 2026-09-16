import seoContent from '@/content/seo-pages.json';

export type SeoFeature = {
  title: string;
  body: string;
};

export type SeoSection = {
  title: string;
  body: string;
  bullets: string[];
};

export type SeoFaq = {
  question: string;
  answer: string;
};

export type SeoPage = {
  slug: string;
  navLabel: string;
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  intro: string;
  primaryKeyword: string;
  features: SeoFeature[];
  sections: SeoSection[];
  faqs: SeoFaq[];
  related: string[];
};

export const SEO_CONTENT = seoContent as {
  siteName: string;
  siteUrl: string;
  supportEmail: string;
  phone: string;
  pages: SeoPage[];
};

export const SEO_PAGES = SEO_CONTENT.pages;
export const SEO_PAGE_BY_SLUG = new Map(SEO_PAGES.map((page) => [page.slug, page]));
export const PUBLIC_SEO_PATHS = new Set(SEO_PAGES.map((page) => page.slug ? `/${page.slug}` : '/'));
export const SEO_SITE_URL = String(import.meta.env.VITE_SITE_URL || SEO_CONTENT.siteUrl).replace(/\/+$/, '');

export function canonicalUrl(slug: string): string {
  return slug ? `${SEO_SITE_URL}/${slug}` : SEO_SITE_URL;
}

export function pageForSlug(slug: string | undefined): SeoPage | undefined {
  return SEO_PAGE_BY_SLUG.get(String(slug || '').replace(/^\/+|\/+$/g, ''));
}
