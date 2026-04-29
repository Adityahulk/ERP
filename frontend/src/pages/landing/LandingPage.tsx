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
} from 'lucide-react';

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
      a: 'Yes, we use bank-level encryption and automated backups to ensure your business data is always safe and accessible only by you.',
    },
    {
      q: 'Is it GST compliant?',
      a: 'Absolutely. The software is designed for Indian SMEs, ensuring 100% compliance with current GST laws, HSN/SAC codes, and GSTR filing requirements.',
    },
    {
      q: 'Which types of businesses can use this?',
      a: 'Any Indian business that needs GST billing, inventory management, or financial tracking — retail shops, service providers, wholesalers, manufacturers, freelancers, and more.',
    },
    {
      q: 'Can multiple users access the system?',
      a: 'Yes! Add multiple users — accountants, sales staff, managers — each with specific role-based permissions so everyone sees only what they need.',
    },
    {
      q: 'Do I need accounting knowledge?',
      a: 'Not at all. The interface is designed for business owners, making it extremely easy to manage finances without a CA degree.',
    },
    {
      q: 'How does OCR bill scanning work?',
      a: 'Simply photograph or upload a PDF of your supplier\'s bill. The system reads the text automatically and pre-fills the bill number, date, and amount so you can confirm and save in seconds.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-[#420662] selection:text-white">
      {/* ── Navbar ── */}
      <nav
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${
          scrolled ? 'bg-white shadow-md py-3' : 'bg-transparent py-4'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center text-white text-lg font-black shadow-sm">
              M
            </div>
            <div className="leading-tight">
              <p className="text-base font-semibold text-slate-900">Microtechnique</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-violet-700 font-semibold">IT</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">
              Features
            </a>
            <a href="#who-its-for" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">
              Who It's For
            </a>
            <a href="#how-it-works" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">
              How It Works
            </a>
            <a href="#faq" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">
              FAQ
            </a>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="text-sm font-medium text-[#420662] hover:text-[#2d0444] transition-colors hidden sm:block"
            >
              Login
            </Link>
            <button
              onClick={() => setShowPhone(!showPhone)}
              className="bg-[#420662] hover:bg-[#2d0444] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 shadow-lg shadow-[#420662]/30 active:scale-95 w-44 justify-center"
            >
              <Phone className="w-4 h-4" />
              {showPhone ? '+91 93907 54255' : 'Contact Us'}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-36 pb-20 lg:pt-52 lg:pb-32 overflow-hidden">
        <div className="absolute top-0 right-0 -mr-40 -mt-40 w-[600px] h-[600px] rounded-full bg-[#420662]/10 blur-3xl opacity-60 pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-40 -mb-40 w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-3xl opacity-60 pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#420662]/10 text-[#420662] text-xs font-semibold mb-6 border border-[#420662]/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#420662] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#420662]" />
              </span>
              India's All-in-One Business ERP
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold text-slate-900 tracking-tight leading-tight mb-6">
              Run Your Entire Business —{' '}
              <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#420662] to-indigo-600">
                Bills, Stock &amp; GST Sorted
              </span>
            </h1>
            <p className="text-lg md:text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
              GST-compliant billing, inventory, purchases, and reports — for any
              Indian business, from the corner shop to a growing enterprise.
              No accounting degree needed.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/login"
                className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-[#420662] to-indigo-600 hover:from-[#2d0444] hover:to-indigo-700 text-white rounded-xl font-bold text-lg transition-all shadow-xl shadow-[#420662]/30 flex items-center justify-center gap-2 group"
              >
                Access Dashboard
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <button
                onClick={() => setShowPhone(true)}
                className="w-full sm:w-auto px-8 py-4 bg-white border-2 border-slate-200 hover:border-[#420662] hover:text-[#420662] text-slate-700 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2"
              >
                <Phone className="w-5 h-5" />
                {showPhone ? '+91 93907 54255' : 'Request Demo'}
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              No credit card required &bull; Free onboarding support
            </p>
          </div>
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
              <span className="font-bold text-slate-700">100% Secure</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-6 h-6 text-[#420662]" />
              <span className="font-bold text-slate-700">10,000+ Users</span>
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
              Whether you sell products, offer services, or do both — this ERP
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

      {/* ── How it Works ── */}
      <section
        id="how-it-works"
        className="py-24 bg-[#420662]/5 border-y border-[#420662]/10"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Up and Running in 3 Steps
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Get your business running efficiently in minutes, not days.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-12 relative">
            <div className="hidden md:block absolute top-12 left-1/6 right-1/6 h-0.5 bg-gradient-to-r from-[#420662]/20 via-[#420662]/50 to-[#420662]/20 z-0" />
            {[
              {
                step: '1',
                title: 'Set Up Your Account',
                desc: 'Enter your GSTIN and let us auto-fetch your company details. Add your items, parties, and opening stock.',
              },
              {
                step: '2',
                title: 'Start Billing & Buying',
                desc: 'Create invoices for your customers and purchase orders for suppliers — GST calculated automatically.',
              },
              {
                step: '3',
                title: 'Track & Grow',
                desc: 'Monitor profit, stock levels, outstanding payments, and GSTR reports from a single dashboard.',
              },
            ].map((s, i) => (
              <div key={i} className="relative z-10 text-center">
                <div className="w-24 h-24 mx-auto bg-white rounded-full border-4 border-[#420662] flex items-center justify-center text-3xl font-black text-[#420662] shadow-xl mb-6">
                  {s.step}
                </div>
                <h3 className="text-2xl font-bold text-slate-900 mb-3">{s.title}</h3>
                <p className="text-slate-600">{s.desc}</p>
              </div>
            ))}
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
                    className={`w-5 h-5 text-slate-500 transition-transform duration-300 ${
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
            Join thousands of Indian SMEs managing billing, stock, and GST
            effortlessly with Microtechnique IT.
          </p>
          <button
            onClick={() => setShowPhone(true)}
            className="px-10 py-5 bg-white text-[#420662] hover:bg-purple-50 rounded-xl font-extrabold text-xl transition-all shadow-2xl hover:shadow-white/20 hover:scale-105 flex items-center justify-center gap-3 mx-auto"
          >
            <Phone className="w-6 h-6" />
            {showPhone ? '+91 93907 54255' : 'Contact Us Today'}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center text-white text-lg font-black">
                M
              </div>
              <div className="leading-tight">
                <p className="text-base font-semibold text-white">Microtechnique</p>
                <p className="text-[10px] uppercase tracking-[0.18em] text-violet-300 font-semibold">IT</p>
              </div>
            </div>
            <p className="mb-6 max-w-sm">
              India's all-in-one ERP for retail, wholesale, service, and
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
              <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
              <li><Link to="/login" className="hover:text-white transition-colors">Login to ERP</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6">Contact Info</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <Phone className="w-5 h-5 mt-0.5 text-[#420662]" />
                <span>+91 93907 54255</span>
              </li>
              <li>support@mavidyagroup.in</li>
              <li>New Delhi, India</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-8 border-t border-slate-800 text-sm text-center md:text-left flex flex-col md:flex-row justify-between items-center">
          <p>&copy; {new Date().getFullYear()} Microtechnique IT. All rights reserved.</p>
          <div className="flex gap-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-white">Privacy Policy</a>
            <a href="#" className="hover:text-white">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
