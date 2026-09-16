# SEO deployment

The public marketing pages are generated as crawlable route-specific HTML during `npm run build`. The application also updates the same metadata during client-side navigation.

## Google Search Console

1. Add `https://microtechnique.in` as a URL-prefix property in Google Search Console.
2. Choose the HTML tag verification method and copy only the value from the tag's `content` attribute.
3. Set `VITE_GOOGLE_SITE_VERIFICATION` in the frontend build environment or pass it as a Docker build argument.
4. Rebuild and deploy the application, then use **Verify** in Search Console.
5. Submit `https://microtechnique.in/sitemap.xml` under **Sitemaps**.

Example Docker build:

```bash
docker build \
  --build-arg VITE_SITE_URL=https://microtechnique.in \
  --build-arg VITE_GOOGLE_SITE_VERIFICATION=your-verification-token \
  -t microtechnique-accounts .
```

The verification value is embedded at build time. Changing it requires a new frontend build.

## Post-deployment checks

- Open `/robots.txt` and `/sitemap.xml` on the production domain.
- Inspect the source of each public page and confirm its title, description, canonical URL and JSON-LD are present.
- Use Search Console URL Inspection for the home page and every new product page.
- Keep authenticated ERP routes out of the sitemap; they are marked `noindex` by the application.
