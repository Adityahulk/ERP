import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Phone,
  CheckCircle2,
  BarChart3,
  PackageSearch,
  Users,
  FileText,
  ShieldCheck,
  ChevronDown,
  ArrowRight,
  Receipt,
  Store,
  Briefcase,
  TrendingUp,
  ClipboardList,
  ScanLine,
  Star,
  Zap,
  Diamond,
  XCircle,
  UserPlus,
  Mail,
  MessageCircle,
  Sparkles,
  Wand2,
} from 'lucide-react';

const TIERS = [
  {
    name: 'silver',
    display: 'Silver',
    icon: Star,
    price: '₹9,999',
    period: '/year',
    maxUsers: 4,
    description: 'Perfect for small businesses. Core business features to get started.',
    gradient: 'from-slate-500 to-slate-400',
    textColor: 'text-slate-200',
    included: [
      'GST Invoicing & Billing',
      'Inventory Management',
      'Purchase Orders & GRN',
      'Parties & Ledger',
      'Basic Reports',
      '4 User Seats',
    ],
    excluded: [
      'GST Filing (GSTR-1/3B)',
      'Expense Tracking',
      'HR & Attendance',
      'Manufacturing & BOM',
      'Job Work Challans',
      'OCR Bill Scanning',
    ],
  },
  {
    name: 'gold',
    display: 'Gold',
    icon: Zap,
    price: '₹18,999',
    period: '/year',
    maxUsers: 5,
    description: 'Grow confidently. Full application with GST filing and expense management.',
    gradient: 'from-yellow-500 to-amber-400',
    textColor: 'text-yellow-900',
    badge: 'Most Popular',
    included: [
      'GST Invoicing & Billing',
      'Inventory Management',
      'Purchase Orders & GRN',
      'Parties & Ledger',
      'Advanced Reports',
      '5 User Seats',
      'GST Filing (GSTR-1/3B)',
      'Expense Tracking',
      'OCR Bill Scanning',
    ],
    excluded: [
      'HR & Attendance',
      'Manufacturing & BOM',
      'Job Work Challans',
    ],
  },
  {
    name: 'diamond',
    display: 'Diamond',
    icon: Diamond,
    price: '₹30,999',
    period: '/year',
    maxUsers: 7,
    description: 'Enterprise-grade. Every module, 7 seats, priority support.',
    gradient: 'from-cyan-500 to-blue-500',
    textColor: 'text-cyan-900',
    badge: 'Best Value',
    included: [
      'GST Invoicing & Billing',
      'Inventory Management',
      'Purchase Orders & GRN',
      'Parties & Ledger',
      'Advanced Reports',
      '7 User Seats',
      'GST Filing (GSTR-1/3B)',
      'Expense Tracking',
      'OCR Bill Scanning',
      'HR & Attendance',
      'Manufacturing & BOM',
      'Job Work Challans',
    ],
    excluded: [],
  },
];

export default function LandingPage() {
  const [showPhone, setShowPhone] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const features = [
    {
      icon: FileText,
      title: 'GST Invoicing & Billing',
      desc: 'Create professional, GST-compliant invoices in under 60 seconds. E-way bills, credit notes, and proforma — all in one place.',
    },
    {
      icon: PackageSearch,
      title: 'Inventory Management',
      desc: 'Track stock in real-time across multiple godowns, get low-stock alerts, and manage serialised items effortlessly.',
    },
    {
      icon: Receipt,
      title: 'Purchase & GRN',
      desc: 'Raise purchase orders, receive goods with OCR-assisted bill scanning, and auto-update inventory on confirmation.',
    },
    {
      icon: ScanLine,
      title: 'OCR Bill Scanning',
      desc: 'Upload a supplier bill image or PDF and let the system auto-fill bill number, date, and amounts — zero manual entry.',
    },
    {
      icon: BarChart3,
      title: 'Reports & Analytics',
      desc: 'Generate P&L, balance sheets, GSTR-1/3B, and business dashboards instantly — no spreadsheet juggling required.',
    },
    {
      icon: TrendingUp,
      title: 'Quotations & Sales Orders',
      desc: 'Send branded quotations, convert them to invoices in one click, and track every deal through its lifecycle.',
    },
    {
      icon: ClipboardList,
      title: 'Expense Tracking',
      desc: 'Log business expenses with GST breakdowns and get a clear view of outflows alongside your income.',
    },
    {
      icon: Users,
      title: 'Parties & Ledger',
      desc: 'Maintain customer and supplier accounts, track outstanding balances, and reconcile ledgers in seconds.',
    },
    {
      icon: Briefcase,
      title: 'Multi-User Access',
      desc: 'Invite your accountant, sales team, or warehouse staff with role-based permissions — collaborate securely.',
    },
  ];

  const industries = [
    { icon: Store, label: 'Retail & Wholesale' },
    { icon: Briefcase, label: 'Service Businesses' },
    { icon: PackageSearch, label: 'Distributors & Traders' },
    { icon: Receipt, label: 'Restaurants & Food' },
    { icon: ClipboardList, label: 'Manufacturers' },
    { icon: TrendingUp, label: 'Freelancers & Consultants' },
  ];

  const faqs = [
    {
      q: 'Is my data secure?',
      a: 'Yes. Every company\'s data is completely isolated — no other company can ever see your data. We use bank-level encryption and automated backups.',
    },
    {
      q: 'Is it GST compliant?',
      a: 'Absolutely. Designed for Indian SMEs with 100% GST compliance — HSN/SAC codes, GSTR-1/3B filing, e-way bills, and more.',
    },
    {
      q: 'How does licensing work?',
      a: 'Register once, verify your email, then use the registrant dashboard to start a 15-day Diamond trial, request paid plans, open companies, and track pending activations.',
    },
    {
      q: 'Can multiple users access the system?',
      a: 'Yes! Silver gives 4 seats, Gold gives 5, and Diamond gives 7. Each user gets their own login with role-based permissions.',
    },
    {
      q: 'Can one user log in on multiple devices?',
      a: 'For security, each user can be logged in on only one device at a time. Logging in on a new device automatically signs out the previous session.',
    },
    {
      q: 'How does OCR bill scanning work?',
      a: 'Simply photograph or upload a PDF of your supplier\'s bill. The system reads the text automatically and pre-fills the bill number, date, and amount — confirm and save in seconds.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-[#420662] selection:text-white">
      <a
        href="https://wa.me/916355997080"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Message support on WhatsApp"
        className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-2xl shadow-emerald-500/30 transition-transform hover:scale-105 hover:bg-emerald-600"
      >
        <MessageCircle className="h-7 w-7" />
      </a>
      {/* ── Navbar ── */}
      <nav
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${
          scrolled ? 'bg-white shadow-md py-3' : 'bg-transparent py-4'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <Link to="/" className="flex items-center gap-3 min-w-0 shrink">
            <img src="/logo-microtechnique.svg" alt="Microtechnique" className="w-20 h-20 shrink-0 drop-shadow" />
            <div className="leading-tight min-w-0 text-left">
              <p className="text-[15px] font-semibold text-slate-900 leading-snug">
                <span className="block">Microtechnique</span>
                <span className="block">Accounts</span>
              </p>
            </div>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">
              Features
            </a>
            <a href="#pricing" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">
              Pricing
            </a>
            <a href="#who-its-for" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">
              Who It's For
            </a>
            <a href="#faq" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">
              FAQ
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="text-sm font-medium text-[#420662] hover:text-[#2d0444] transition-colors hidden sm:block"
            >
              Login
            </Link>
            <Link
              to="/register?intent=trial"
              className="hidden sm:inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-amber-500/30"
            >
              <Zap className="w-4 h-4" />
              Start / Register
            </Link>
            <button
              onClick={() => setShowPhone(!showPhone)}
              className="bg-white border border-slate-200 hover:border-[#420662] text-slate-700 hover:text-[#420662] px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 active:scale-95"
            >
              <Phone className="w-4 h-4" />
              {showPhone ? '+91 6355 997 080' : 'Contact Us'}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-36 pb-24 lg:pt-44 lg:pb-32 overflow-hidden">
        {/* Soft background blobs */}
        <div className="absolute top-0 right-0 -mr-40 -mt-40 w-[640px] h-[640px] rounded-full bg-[#420662]/10 blur-3xl opacity-70 pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-40 -mb-40 w-[520px] h-[520px] rounded-full bg-indigo-500/10 blur-3xl opacity-70 pointer-events-none" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full bg-fuchsia-400/10 blur-3xl opacity-60 pointer-events-none" />

        {/* Subtle grid texture */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #420662 1px, transparent 1px), linear-gradient(to bottom, #420662 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          }}
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            {/* Tagline pill */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/80 backdrop-blur ring-1 ring-[#420662]/15 text-[#420662] text-xs font-semibold mb-7 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#420662] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#420662]" />
              </span>
              India's All-in-One Business Accounts
            </div>

            {/* — Bill With AI showcase — */}
            <div className="mb-7 flex justify-center">
              <div className="group relative inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#420662] via-indigo-600 to-fuchsia-600 shadow-[0_8px_32px_-4px_rgba(66,6,98,0.5)]">
                {/* Animated glow */}
                <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-r from-fuchsia-500 via-indigo-500 to-[#420662] blur-md opacity-60 -z-10 animate-pulse" />
                <Sparkles className="w-4 h-4 text-amber-300 drop-shadow-[0_0_4px_rgba(251,191,36,0.7)]" />
                <span className="text-white text-[13px] font-bold tracking-wider uppercase">
                  Bill With&nbsp;
                  <span className="bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 bg-clip-text text-transparent">
                    AI
                  </span>
                </span>
                <Wand2 className="w-4 h-4 text-amber-300 drop-shadow-[0_0_4px_rgba(251,191,36,0.7)]" />
              </div>
            </div>

            {/* Main headline */}
            <h1 className="text-[2.5rem] md:text-6xl lg:text-7xl font-extrabold text-slate-900 tracking-tight leading-[1.05] mb-6">
              Run Your Entire Business —
              <br className="hidden md:block" />{' '}
              <span className="relative inline-block">
                <span className="relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-[#420662] via-indigo-600 to-fuchsia-600">
                  Bills, Stock &amp; GST Sorted
                </span>
                <span className="absolute -bottom-1 left-0 right-0 h-3 bg-amber-200/60 -z-0 rounded-full blur-[2px]" aria-hidden />
              </span>
            </h1>

            <p className="text-lg md:text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
              GST-compliant billing, inventory, purchases &amp; reports — supercharged with
              <span className="text-[#420662] font-semibold"> AI that scans bills, drafts invoices, and answers your books</span>.
              Built for every Indian business, from the corner shop to a growing enterprise.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/register?intent=trial"
                className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl font-bold text-lg transition-all shadow-xl shadow-amber-500/30 flex items-center justify-center gap-2 group"
              >
                <Zap className="w-5 h-5" />
                Start 15-Day Free Trial
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                to="/login"
                className="w-full sm:w-auto px-8 py-4 bg-white border-2 border-slate-200 hover:border-[#420662] hover:text-[#420662] text-slate-700 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2"
              >
                Already have access? Sign In
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              No credit card required &bull; All features unlocked &bull; 15 days free &bull;{' '}
              <Link to="/register?intent=plan" className="underline text-[#420662]">Request a plan</Link> any time
            </p>

            {/* AI capability chips */}
            <div className="mt-12 flex flex-wrap items-center justify-center gap-2.5 max-w-3xl mx-auto">
              {[
                { icon: ScanLine, label: 'Scan bills with AI' },
                { icon: Wand2, label: 'Auto-draft invoices' },
                { icon: Sparkles, label: 'Smart GST insights' },
                { icon: ShieldCheck, label: 'IRN & E-Way bill' },
              ].map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur ring-1 ring-slate-200 text-slate-700 text-xs font-medium shadow-sm hover:ring-[#420662]/40 hover:text-[#420662] transition-colors"
                >
                  <chip.icon className="w-3.5 h-3.5 text-[#420662]" />
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Trial Strip ── */}
      <section className="py-6 bg-gradient-to-r from-amber-50 to-orange-50 border-y border-amber-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-amber-900">Try Microtechnique Accounts free for 15 days</p>
              <p className="text-sm text-amber-700">Full Diamond plan — all features unlocked. No credit card. No commitment.</p>
            </div>
          </div>
          <Link
            to="/register?intent=trial"
            className="shrink-0 inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-amber-500/30 text-sm"
          >
            Start Free Trial
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* ── Social Proof ── */}
      <section className="py-10 bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-semibold text-slate-500 uppercase tracking-wider mb-6">
            Trusted by fast-growing Indian businesses
          </p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-16 text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-[#420662]" />
              <span className="font-bold text-slate-700">100% Secure & Isolated</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-6 h-6 text-[#420662]" />
              <span className="font-bold text-slate-700">Multi-User Access</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-[#420662]" />
              <span className="font-bold text-slate-700">GST Compliant</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Who It's For ── */}
      <section id="who-its-for" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Built for Every Kind of Business
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Whether you sell products, offer services, or do both — this software
              adapts to the way you work.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
            {industries.map((ind, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl p-6 flex flex-col items-center text-center shadow-sm border border-slate-100 hover:border-[#420662]/30 hover:shadow-md transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-[#420662]/10 flex items-center justify-center mb-4">
                  <ind.icon className="w-6 h-6 text-[#420662]" />
                </div>
                <span className="text-sm font-semibold text-slate-700 leading-tight">{ind.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section id="features" className="py-24 bg-white relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Everything You Need to Grow
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              One platform that replaces your billing software, inventory tracker,
              expense book, and GST spreadsheets.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <div
                key={i}
                className="bg-slate-50 p-8 rounded-2xl shadow-sm border border-slate-100 hover:shadow-xl hover:border-[#420662]/30 transition-all group"
              >
                <div className="w-14 h-14 rounded-xl bg-[#420662]/10 flex items-center justify-center mb-6 group-hover:bg-[#420662] transition-colors">
                  <f.icon className="w-7 h-7 text-[#420662] group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{f.title}</h3>
                <p className="text-slate-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing / License Tiers ── */}
      <section
        id="pricing"
        className="py-24 bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(120,50,200,0.15),_transparent_70%)] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-lg text-purple-300 max-w-2xl mx-auto">
              Register once, start a full Diamond trial, request a plan, and manage every company from one account.
            </p>
            <div className="flex items-center justify-center gap-4 mt-6 text-sm text-purple-300">
              <a href="tel:+916355997080" className="flex items-center gap-2 hover:text-purple-200 transition-colors">
                <Phone className="w-4 h-4" />
                +91 6355 997 080
              </a>
              <span className="text-white/20">|</span>
              <a href="mailto:support@microtechnique.in" className="flex items-center gap-2 hover:text-purple-200 transition-colors">
                <Mail className="w-4 h-4" />
                support@microtechnique.in
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TIERS.map((tier) => {
              const TierIcon = tier.icon;
              return (
                <div
                  key={tier.name}
                  className={`relative bg-white/5 border border-white/10 rounded-2xl p-8 flex flex-col hover:border-white/20 transition-all ${tier.badge ? 'ring-1 ring-yellow-500/40' : ''}`}
                >
                  {tier.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className={`px-4 py-1 rounded-full text-xs font-bold bg-gradient-to-r ${tier.gradient} text-slate-900`}>
                        {tier.badge}
                      </span>
                    </div>
                  )}

                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${tier.gradient} flex items-center justify-center mb-4`}>
                    <TierIcon className="w-6 h-6 text-white" />
                  </div>

                  <h3 className="text-2xl font-bold text-white mb-1">{tier.display}</h3>
                  <p className="text-slate-400 text-sm mb-5">{tier.description}</p>

                  <div className="mb-5">
                    <span className="text-4xl font-bold text-white">{tier.price}</span>
                    <span className="text-slate-400">{tier.period}</span>
                    <p className="text-purple-300 text-sm mt-1">{tier.maxUsers} user seats</p>
                  </div>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {tier.included.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                    {tier.excluded.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-sm text-slate-600">
                        <XCircle className="w-4 h-4 text-slate-700 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <Link
                    to={`/register?intent=plan&tier=${tier.name}`}
                    className={`w-full py-3 rounded-xl font-semibold text-sm text-center transition-all bg-gradient-to-r ${tier.gradient} text-slate-900 hover:opacity-90 hover:shadow-lg`}
                  >
                    Request {tier.display} Plan
                  </Link>
                </div>
              );
            })}
          </div>

          <p className="text-center text-slate-500 text-sm mt-10">
            Payments processed offline via call or email. Our team responds within 24 hours.
          </p>
        </div>
      </section>

      {/* ── How it Works ── */}
      <section
        id="how-it-works"
        className="py-24 bg-[#420662]/5 border-y border-[#420662]/10"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Up and Running in 4 Steps
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              From registration to live business operations in under 24 hours.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-8 relative">
            {[
              {
                step: '1',
                title: 'Register Once',
                desc: 'Create one verified account for trials, license requests, and company access.',
              },
              {
                step: '2',
                title: 'Start Trial or Request Plan',
                desc: 'Use the 15-day Diamond trial and request Silver, Gold, or Diamond whenever you are ready.',
              },
              {
                step: '3',
                title: 'Activate Paid License',
                desc: 'Contact us via phone or email to complete offline payment. We activate the requested company.',
              },
              {
                step: '4',
                title: 'Start Operating',
                desc: 'Log in, complete onboarding, and start billing, managing stock, and filing GST.',
              },
            ].map((s, i) => (
              <div key={i} className="relative z-10 text-center">
                <div className="w-20 h-20 mx-auto bg-white rounded-full border-4 border-[#420662] flex items-center justify-center text-2xl font-black text-[#420662] shadow-xl mb-5">
                  {s.step}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{s.title}</h3>
                <p className="text-slate-600 text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link
              to="/register?intent=trial"
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-[#420662] to-indigo-600 hover:from-[#2d0444] hover:to-indigo-700 text-white rounded-xl font-bold text-lg transition-all shadow-xl shadow-[#420662]/30 group"
            >
              <UserPlus className="w-5 h-5" />
              Start with Step 1 — Register
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Frequently Asked Questions
            </h2>
          </div>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="border border-slate-200 rounded-xl overflow-hidden transition-all duration-200 hover:border-[#420662]/50"
              >
                <button
                  className="w-full px-6 py-5 text-left flex justify-between items-center bg-white hover:bg-slate-50"
                  onClick={() => setActiveFaq(activeFaq === i ? null : i)}
                >
                  <span className="font-bold text-slate-800 text-lg">{faq.q}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-slate-500 transition-transform duration-300 flex-shrink-0 ${
                      activeFaq === i ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    activeFaq === i ? 'max-h-48 border-t border-slate-100' : 'max-h-0'
                  }`}
                >
                  <div className="px-6 py-5 text-slate-600 leading-relaxed bg-slate-50/50">
                    {faq.a}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 relative overflow-hidden bg-[#420662]">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight">
            Ready to simplify how you run your business?
          </h2>
          <p className="text-xl text-purple-200 mb-10">
            Register once, start the free trial, and request paid activation when you are ready.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <Link
              to="/register?intent=trial"
              className="px-10 py-5 bg-white text-[#420662] hover:bg-purple-50 rounded-xl font-extrabold text-xl transition-all shadow-2xl hover:shadow-white/20 hover:scale-105 flex items-center justify-center gap-3"
            >
              <UserPlus className="w-6 h-6" />
              Start / Register
            </Link>
            <button
              onClick={() => setShowPhone(true)}
              className="px-10 py-5 bg-transparent border-2 border-white/30 hover:border-white text-white rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3"
            >
              <Phone className="w-5 h-5" />
              {showPhone ? '+91 6355 997 080' : 'Contact Sales'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-6 flex items-start gap-3">
              <img src="/logo-microtechnique.svg" alt="Microtechnique" className="w-20 h-20 shrink-0 drop-shadow brightness-0 invert" />
              <div className="leading-tight min-w-0">
                <p className="text-base font-semibold text-white leading-snug">
                  <span className="block">Microtechnique</span>
                  <span className="block">Accounts</span>
                </p>
              </div>
            </div>
            <p className="mb-6 max-w-sm">
              India's all-in-one business software for retail, wholesale, service, and
              manufacturing businesses. Simplify operations and scale faster.
            </p>
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-[#420662] transition-colors cursor-pointer text-white text-sm font-bold">X</div>
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-[#420662] transition-colors cursor-pointer text-white text-sm font-bold">in</div>
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-[#420662] transition-colors cursor-pointer text-white text-sm font-bold">f</div>
            </div>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6">Company</h4>
            <ul className="space-y-3">
              <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
              <li><Link to="/register" className="hover:text-white transition-colors">Register</Link></li>
              <li><Link to="/login" className="hover:text-white transition-colors">Login</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6">Contact Info</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <Phone className="w-5 h-5 mt-0.5 text-[#420662] shrink-0" />
                <a
                  href="tel:+916355997080"
                  className="hover:text-white transition-colors underline-offset-2 hover:underline break-all"
                >
                  +91 6355 997 080
                </a>
              </li>
              <li className="flex items-start gap-2">
                <Mail className="w-5 h-5 mt-0.5 text-[#420662] shrink-0" />
                <a
                  href="mailto:support@microtechnique.in"
                  className="hover:text-white transition-colors underline-offset-2 hover:underline break-all"
                >
                  support@microtechnique.in
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
          <p>&copy; 2020 Microtechnique Accounts. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-white transition-colors">Refund Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
