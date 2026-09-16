import { useEffect } from 'react';
import { canonicalUrl, SEO_CONTENT, SEO_SITE_URL, type SeoPage } from '@/lib/seo';
import { schemaForPage, type JsonLd } from '@/lib/seoSchemas';

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => element!.setAttribute(key, value));
}

function setCanonical(url: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement('link');
    element.rel = 'canonical';
    document.head.appendChild(element);
  }
  element.href = url;
}

export default function SeoHead({ page, schemas }: { page: SeoPage; schemas?: JsonLd[] }) {
  useEffect(() => {
    const url = canonicalUrl(page.slug);
    const verification = String(import.meta.env.VITE_GOOGLE_SITE_VERIFICATION || '').trim();
    document.title = page.title;
    document.documentElement.lang = 'en-IN';

    upsertMeta('meta[name="description"]', { name: 'description', content: page.description });
    upsertMeta('meta[name="robots"]', { name: 'robots', content: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: SEO_CONTENT.siteName });
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: page.title });
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: page.description });
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url });
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: `${SEO_SITE_URL}/logo-microtechnique.svg` });
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: page.title });
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: page.description });
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: `${SEO_SITE_URL}/logo-microtechnique.svg` });
    if (verification) {
      upsertMeta('meta[name="google-site-verification"]', { name: 'google-site-verification', content: verification });
    }
    setCanonical(url);

    document.head.querySelectorAll('script[data-seo-schema]').forEach((node) => node.remove());
    (schemas || schemaForPage(page)).forEach((schema, index) => {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.seoSchema = String(index);
      script.text = JSON.stringify(schema).replace(/</g, '\\u003c');
      document.head.appendChild(script);
    });
  }, [page, schemas]);

  return null;
}
