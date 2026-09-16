import { ArrowRight, Check, CheckCircle2 } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import MarketingLayout from '@/components/seo/MarketingLayout';
import ProductWorkspaceVisual from '@/components/seo/ProductWorkspaceVisual';
import SeoHead from '@/components/seo/SeoHead';
import { pageForSlug } from '@/lib/seo';

const plans = [
  { name: 'Silver', price: '₹9,999', users: 'Up to 4 users', description: 'Core billing, inventory, purchases, parties, ledgers and basic reports.' },
  { name: 'Gold', price: '₹18,999', users: 'Up to 5 users', description: 'Adds advanced reports, GST filing, expenses and OCR bill scanning.', featured: true },
  { name: 'Diamond', price: '₹30,999', users: 'Up to 7 users', description: 'Adds HR, attendance, manufacturing, BOM and job work workflows.' }
];

export default function ProductSeoPage() {
  const { slug } = useParams();
  const page = pageForSlug(slug);
  if (!page || !page.slug) return <Navigate to="/" replace />;

  const relatedPages = page.related.map((relatedSlug) => pageForSlug(relatedSlug)).filter(Boolean);
  const isPricing = page.slug === 'pricing';

  return (
    <MarketingLayout>
      <SeoHead page={page} />

      <section className="relative min-h-[620px] overflow-hidden border-b border-slate-200 bg-slate-50">
        <ProductWorkspaceVisual slug={page.slug} />
        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-24 pt-14 sm:px-6 lg:px-8 lg:pb-28 lg:pt-20">
          <nav className="mb-12 text-sm text-slate-500" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-[#420662]">Home</Link>
            <span className="mx-2" aria-hidden="true">/</span>
            <span aria-current="page">{page.navLabel}</span>
          </nav>
          <div className="max-w-2xl bg-slate-50/95 pr-4 lg:min-h-[410px]">
            <p className="mb-4 text-sm font-extrabold uppercase tracking-wider text-[#420662]">{page.eyebrow}</p>
            <h1 className="max-w-2xl text-4xl font-extrabold leading-tight text-slate-950 sm:text-5xl lg:text-6xl">{page.h1}</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">{page.intro}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/register?intent=trial" className="inline-flex items-center justify-center gap-2 rounded-md bg-[#420662] px-6 py-3.5 font-bold text-white hover:bg-[#300447]">
                Start 15-day free trial <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/login" className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-6 py-3.5 font-bold text-slate-800 hover:border-[#420662] hover:text-[#420662]">
                Open software
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">No credit card required. Set up your company and test the complete workflow.</p>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase text-amber-700">Connected by design</p>
            <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">What {page.primaryKeyword} should help you do</h2>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {page.features.map((feature, index) => (
              <article key={feature.title} className="rounded-lg border border-slate-200 p-6 shadow-sm">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#420662] text-sm font-black text-white">{index + 1}</span>
                <h3 className="mt-5 text-xl font-bold text-slate-950">{feature.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {isPricing && (
        <section className="border-y border-slate-200 bg-slate-50 py-20" aria-labelledby="plans-heading">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 id="plans-heading" className="text-center text-3xl font-extrabold text-slate-950 sm:text-4xl">Annual plans</h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">Choose by workflow and team size. Applicable taxes and final terms are confirmed during purchase.</p>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {plans.map((plan) => (
                <article key={plan.name} className={`rounded-lg border bg-white p-7 ${plan.featured ? 'border-[#420662] shadow-lg' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-2xl font-extrabold">{plan.name}</h3>
                    {plan.featured && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Popular</span>}
                  </div>
                  <p className="mt-5 text-4xl font-black text-[#420662]">{plan.price}<span className="text-sm font-semibold text-slate-500"> / year</span></p>
                  <p className="mt-2 text-sm font-semibold text-slate-700">{plan.users}</p>
                  <p className="mt-5 min-h-[72px] leading-6 text-slate-600">{plan.description}</p>
                  <Link to="/register?intent=trial" className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-slate-950 px-4 py-3 font-bold text-white hover:bg-[#420662]">Start free trial</Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {page.sections.map((section, index) => (
        <section key={section.title} className={`border-t border-slate-200 py-20 ${index % 2 === 0 ? 'bg-slate-50' : 'bg-white'}`}>
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_.8fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase text-[#420662]">{page.navLabel}</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-slate-950 sm:text-4xl">{section.title}</h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">{section.body}</p>
            </div>
            <ul className="grid content-start gap-3" aria-label={`${section.title} capabilities`}>
              {section.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-3 border-b border-slate-200 py-3 font-semibold text-slate-800">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" /> {bullet}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      {relatedPages.length > 0 && (
        <section className="border-t border-slate-200 bg-white py-20" aria-labelledby="related-heading">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 id="related-heading" className="text-3xl font-extrabold text-slate-950">Explore connected business software</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {relatedPages.map((related) => related && (
                <Link key={related.slug} to={`/${related.slug}`} className="group rounded-lg border border-slate-200 p-5 hover:border-[#420662] hover:shadow-md">
                  <h3 className="font-bold text-slate-950 group-hover:text-[#420662]">{related.navLabel}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{related.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-[#420662]">Learn more <ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {page.faqs.length > 0 && (
        <section className="border-t border-slate-200 bg-slate-50 py-20" aria-labelledby="faq-heading">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 id="faq-heading" className="text-center text-3xl font-extrabold text-slate-950">Frequently asked questions</h2>
            <div className="mt-9 divide-y divide-slate-200 border-y border-slate-200">
              {page.faqs.map((faq) => (
                <details key={faq.question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-slate-900">
                    {faq.question}<span className="text-xl text-[#420662] group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="max-w-3xl pt-3 leading-7 text-slate-600">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="bg-[#420662] py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-7 px-4 sm:px-6 lg:flex-row lg:items-center lg:px-8">
          <div>
            <h2 className="text-3xl font-extrabold">See the complete workflow with your business data</h2>
            <p className="mt-3 text-purple-100">Start a trial, configure the company, and create your first transaction.</p>
          </div>
          <Link to="/register?intent=trial" className="inline-flex shrink-0 items-center gap-2 rounded-md bg-amber-400 px-6 py-3.5 font-extrabold text-slate-950 hover:bg-amber-300">
            Start free trial <Check className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
