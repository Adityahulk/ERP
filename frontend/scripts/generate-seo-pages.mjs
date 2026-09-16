import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, '..');
const distDirectory = path.join(frontendDirectory, 'dist');
const content = JSON.parse(await readFile(path.join(frontendDirectory, 'src/content/seo-pages.json'), 'utf8'));
const template = await readFile(path.join(distDirectory, 'index.html'), 'utf8');
const siteUrl = String(process.env.VITE_SITE_URL || process.env.SEO_SITE_URL || content.siteUrl).replace(/\/$/, '');
const verification = String(process.env.VITE_GOOGLE_SITE_VERIFICATION || process.env.GOOGLE_SITE_VERIFICATION || '').trim();

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const escapeXml = escapeHtml;
const pageUrl = (slug) => `${siteUrl}${slug ? `/${slug}` : ''}`;
const pageBySlug = new Map(content.pages.map((page) => [page.slug, page]));

function schemasForPage(page) {
  if (!page.slug) {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: content.siteName,
        url: siteUrl,
        logo: `${siteUrl}/logo-microtechnique.svg`,
        email: content.supportEmail,
        telephone: content.phone
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: content.siteName,
        url: siteUrl,
        inLanguage: 'en-IN'
      }
    ];
  }

  const software = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: content.siteName,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: pageUrl(page.slug),
    description: page.description,
    featureList: page.features.map((feature) => feature.title),
    publisher: {
      '@type': 'Organization',
      name: content.siteName,
      url: siteUrl,
      logo: `${siteUrl}/logo-microtechnique.svg`
    }
  };

  if (page.slug === 'pricing') {
    software.offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'INR',
      lowPrice: '9999',
      highPrice: '30999',
      offerCount: '3'
    };
  }

  const schemas = [
    software,
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
        { '@type': 'ListItem', position: 2, name: page.navLabel, item: pageUrl(page.slug) }
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

  return schemas;
}

function navigationMarkup() {
  return content.pages
    .map((page) => `<a href="/${escapeHtml(page.slug)}">${escapeHtml(page.navLabel)}</a>`)
    .join('');
}

function fallbackMarkup(page) {
  const features = page.features
    .map((feature) => `<article><h2>${escapeHtml(feature.title)}</h2><p>${escapeHtml(feature.body)}</p></article>`)
    .join('');
  const sections = page.sections
    .map((section) => `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p><ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul></section>`)
    .join('');
  const faqs = page.faqs.length
    ? `<section><h2>Frequently asked questions</h2>${page.faqs.map((faq) => `<article><h3>${escapeHtml(faq.question)}</h3><p>${escapeHtml(faq.answer)}</p></article>`).join('')}</section>`
    : '';
  const related = page.related
    .map((slug) => pageBySlug.get(slug))
    .filter(Boolean)
    .map((relatedPage) => `<a href="/${escapeHtml(relatedPage.slug)}">${escapeHtml(relatedPage.navLabel)}</a>`)
    .join('');

  return `<div class="seo-static-shell">
    <header><a class="seo-brand" href="/"><img src="/logo-microtechnique.svg" width="42" height="42" alt="Microtechnique Accounts logo"><span>${escapeHtml(content.siteName)}</span></a><nav aria-label="Primary navigation">${navigationMarkup()}</nav></header>
    <main>
      ${page.slug ? `<nav class="seo-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span>${escapeHtml(page.navLabel)}</span></nav>` : ''}
      <section class="seo-hero"><p>${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.h1)}</h1><div>${escapeHtml(page.intro)}</div><a class="seo-cta" href="/register">Start free trial</a></section>
      <section class="seo-features">${features}</section>
      ${sections}
      ${faqs}
      <section><h2>Explore related business software</h2><div class="seo-related">${related}</div></section>
    </main>
    <footer><strong>${escapeHtml(content.siteName)}</strong><p>GST billing, accounting, inventory and reporting software for Indian businesses.</p><nav aria-label="Footer navigation">${navigationMarkup()}</nav></footer>
  </div>`;
}

const staticStyles = `<style data-seo-static>
  .seo-static-shell{font-family:Inter,Arial,sans-serif;color:#0f172a;background:#fff;line-height:1.6}.seo-static-shell *{box-sizing:border-box}.seo-static-shell header,.seo-static-shell main,.seo-static-shell footer{max-width:1180px;margin:auto;padding:22px 24px}.seo-static-shell header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0}.seo-static-shell header nav,.seo-static-shell footer nav,.seo-related{display:flex;flex-wrap:wrap;gap:10px 18px}.seo-static-shell a{color:#420662;text-decoration:none}.seo-brand{display:flex;align-items:center;gap:10px;font-weight:800}.seo-hero{padding:80px 0 54px;max-width:820px}.seo-hero>p{font-size:13px;font-weight:800;text-transform:uppercase;color:#7c3aed}.seo-hero h1{font-size:48px;line-height:1.08;margin:12px 0 20px}.seo-hero div{font-size:20px;color:#475569}.seo-cta{display:inline-block;margin-top:24px;padding:11px 18px;background:#420662;color:#fff!important;border-radius:6px;font-weight:700}.seo-features{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.seo-static-shell article,.seo-static-shell main>section:not(.seo-hero):not(.seo-features){padding:24px;border:1px solid #e2e8f0;margin:20px 0}.seo-static-shell h2{font-size:26px;line-height:1.25}.seo-static-shell h3{font-size:18px}.seo-static-shell footer{border-top:1px solid #e2e8f0;margin-top:48px}.seo-breadcrumb{padding-top:20px;display:flex;gap:8px;color:#64748b;font-size:14px}@media(max-width:800px){.seo-static-shell header{align-items:flex-start;gap:18px}.seo-static-shell header nav{display:none}.seo-hero{padding-top:48px}.seo-hero h1{font-size:36px}.seo-features{grid-template-columns:1fr}}
</style>`;

function renderPage(page) {
  const canonical = pageUrl(page.slug);
  const meta = `
    <meta name="description" content="${escapeHtml(page.description)}">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${escapeHtml(content.siteName)}">
    <meta property="og:title" content="${escapeHtml(page.title)}">
    <meta property="og:description" content="${escapeHtml(page.description)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta property="og:image" content="${escapeHtml(`${siteUrl}/logo-microtechnique.svg`)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(page.title)}">
    <meta name="twitter:description" content="${escapeHtml(page.description)}">
    <meta name="twitter:image" content="${escapeHtml(`${siteUrl}/logo-microtechnique.svg`)}">
    ${verification ? `<meta name="google-site-verification" content="${escapeHtml(verification)}">` : ''}
    ${schemasForPage(page).map((schema, index) => `<script type="application/ld+json" data-seo-schema="static-${index}">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`).join('\n    ')}
    ${staticStyles}`;

  return template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(page.title)}</title>`)
    .replace(/\s*<meta name="description"[^>]*>/i, '')
    .replace(/\s*<meta name="robots"[^>]*>/i, '')
    .replace('</head>', `${meta}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${fallbackMarkup(page)}</div>`);
}

for (const page of content.pages) {
  const filename = page.slug ? `${page.slug}.html` : 'index.html';
  await writeFile(path.join(distDirectory, filename), renderPage(page), 'utf8');
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${content.pages.map((page) => `  <url><loc>${escapeXml(pageUrl(page.slug))}</loc><changefreq>${page.slug === 'pricing' ? 'weekly' : 'monthly'}</changefreq><priority>${page.slug ? '0.8' : '1.0'}</priority></url>`).join('\n')}
</urlset>\n`;

const robots = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /superadmin/
Disallow: /register/
Disallow: /uploads/
Disallow: /settings
Disallow: /dashboard
Disallow: /onboarding

Sitemap: ${siteUrl}/sitemap.xml
`;

await writeFile(path.join(distDirectory, 'sitemap.xml'), sitemap, 'utf8');
await writeFile(path.join(distDirectory, 'robots.txt'), robots, 'utf8');
console.log(`Generated ${content.pages.length} SEO pages, sitemap.xml and robots.txt for ${siteUrl}`);
