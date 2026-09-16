import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PUBLIC_SEO_PATHS } from '@/lib/seo';

export default function PrivateRouteSeo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    if (PUBLIC_SEO_PATHS.has(normalized)) return;

    document.title = 'Microtechnique Accounts';
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex,nofollow,noarchive';
    document.head.querySelector('link[rel="canonical"]')?.remove();
    document.head.querySelectorAll('script[data-seo-schema]').forEach((node) => node.remove());
  }, [pathname]);

  return null;
}
