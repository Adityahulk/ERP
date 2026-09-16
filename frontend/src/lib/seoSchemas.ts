import { canonicalUrl, SEO_CONTENT, SEO_SITE_URL, type SeoPage } from '@/lib/seo';

export type JsonLd = Record<string, unknown>;

export function schemaForPage(page: SeoPage): JsonLd[] {
  const url = canonicalUrl(page.slug);
  const schemas: JsonLd[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SEO_CONTENT.siteName,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url,
      description: page.description,
      featureList: page.features.map((feature) => feature.title),
      publisher: {
        '@type': 'Organization',
        name: SEO_CONTENT.siteName,
        url: SEO_SITE_URL,
        logo: `${SEO_SITE_URL}/logo-microtechnique.svg`
      }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SEO_SITE_URL },
        { '@type': 'ListItem', position: 2, name: page.navLabel, item: url }
      ]
    }
  ];

  if (page.faqs.length) {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer }
      }))
    });
  }

  if (page.slug === 'pricing') {
    schemas[0] = {
      ...schemas[0],
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'INR',
        lowPrice: '9999',
        highPrice: '30999',
        offerCount: '3'
      }
    };
  }

  return schemas;
}

export function homeSchemas(): JsonLd[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SEO_CONTENT.siteName,
      url: SEO_SITE_URL,
      logo: `${SEO_SITE_URL}/logo-microtechnique.svg`,
      email: SEO_CONTENT.supportEmail,
      telephone: SEO_CONTENT.phone
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SEO_CONTENT.siteName,
      url: SEO_SITE_URL,
      inLanguage: 'en-IN'
    }
  ];
}
