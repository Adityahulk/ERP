import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Menu, Phone, X } from 'lucide-react';
import { SEO_CONTENT, SEO_PAGES } from '@/lib/seo';

const primaryLinks = [
  { to: '/gst-software', label: 'GST' },
  { to: '/billing-software', label: 'Billing' },
  { to: '/accounting-software', label: 'Accounting' },
  { to: '/inventory-management-software', label: 'Inventory' },
  { to: '/gst-reports', label: 'GST Reports' },
  { to: '/pricing', label: 'Pricing' }
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const productPages = SEO_PAGES.filter((page) => page.slug && page.slug !== 'pricing');

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label="Microtechnique Accounts home">
            <img
              src="/logo-microtechnique.svg"
              alt="Microtechnique Accounts logo"
              width="56"
              height="56"
              className="h-14 w-14 shrink-0 object-contain"
            />
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-extrabold text-[#420662]">Microtechnique</span>
              <span className="block text-xs font-semibold text-slate-600">Accounts</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-5 lg:flex" aria-label="Main navigation">
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-semibold text-slate-700 hover:text-[#420662]">
                Products <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="absolute left-1/2 top-9 grid w-[560px] -translate-x-1/2 grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
                {productPages.map((page) => (
                  <Link key={page.slug} to={`/${page.slug}`} className="rounded-md px-3 py-2.5 hover:bg-slate-50">
                    <span className="block text-sm font-semibold text-slate-900">{page.navLabel}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">{page.primaryKeyword}</span>
                  </Link>
                ))}
              </div>
            </details>
            {primaryLinks.map((link) => (
              <Link key={link.to} to={link.to} className="text-sm font-semibold text-slate-700 hover:text-[#420662]">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 sm:flex">
            <Link to="/login" className="px-3 py-2 text-sm font-semibold text-slate-700 hover:text-[#420662]">Sign in</Link>
            <Link to="/register?intent=trial" className="rounded-md bg-[#420662] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#300447]">
              Start free trial
            </Link>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-marketing-menu"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <nav id="mobile-marketing-menu" className="border-t border-slate-200 bg-white px-4 py-4 lg:hidden" aria-label="Mobile navigation">
            <div className="grid gap-1 sm:grid-cols-2">
              {productPages.map((page) => (
                <Link key={page.slug} to={`/${page.slug}`} onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-50">
                  {page.navLabel}
                </Link>
              ))}
              <Link to="/pricing" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-50">Pricing</Link>
              <Link to="/login" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-50">Sign in</Link>
              <Link to="/register?intent=trial" onClick={() => setMenuOpen(false)} className="mt-2 rounded-md bg-[#420662] px-3 py-2.5 text-center text-sm font-bold text-white sm:col-span-2">Start free trial</Link>
            </div>
          </nav>
        )}
      </header>

      <main>{children}</main>

      <footer className="border-t border-slate-800 bg-slate-950 text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr] lg:px-8">
          <div>
            <Link to="/" className="inline-flex items-center gap-3">
              <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" width="64" height="64" className="h-16 w-16 object-contain brightness-0 invert" />
              <span className="font-extrabold text-white">Microtechnique Accounts</span>
            </Link>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
              GST billing, accounting, inventory and business reports for Indian businesses.
            </p>
            <a href={`tel:${SEO_CONTENT.phone.replace(/\s/g, '')}`} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-white hover:text-amber-300">
              <Phone className="h-4 w-4" aria-hidden="true" /> {SEO_CONTENT.phone}
            </a>
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase text-white">Software</h2>
            <ul className="mt-4 grid gap-2 text-sm">
              {productPages.slice(0, 5).map((page) => (
                <li key={page.slug}><Link to={`/${page.slug}`} className="hover:text-white">{page.navLabel}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase text-white">Explore</h2>
            <ul className="mt-4 grid gap-2 text-sm">
              {productPages.slice(5).map((page) => (
                <li key={page.slug}><Link to={`/${page.slug}`} className="hover:text-white">{page.navLabel}</Link></li>
              ))}
              <li><Link to="/pricing" className="hover:text-white">Pricing</Link></li>
              <li><Link to="/login" className="hover:text-white">Software login</Link></li>
              <li><a href={`mailto:${SEO_CONTENT.supportEmail}`} className="hover:text-white">{SEO_CONTENT.supportEmail}</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800 px-4 py-5 text-center text-xs text-slate-500">
          &copy; {new Date().getFullYear()} Microtechnique Accounts. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
