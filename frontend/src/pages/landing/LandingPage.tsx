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
  Factory,
  Truck,
  Wrench,
  ArrowRight
} from 'lucide-react';

export default function LandingPage() {
  const [showPhone, setShowPhone] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const features = [
    { icon: FileText, title: 'GST Invoicing & Billing', desc: 'Create professional, GST-compliant invoices in under 60 seconds.' },
    { icon: PackageSearch, title: 'Inventory Management', desc: 'Track stock in real-time, get low-stock alerts, and manage multiple godowns.' },
    { icon: Factory, title: 'Production & BOM', desc: 'Manage Bill of Materials and track production costs seamlessly.' },
    { icon: Truck, title: 'Wholesale Orders', desc: 'Manage order lifecycles and tier-based pricing for distributors.' },
    { icon: Wrench, title: 'Job Work Tracking', desc: 'Track outward/inward materials with GST Section 143 return compliance.' },
    { icon: BarChart3, title: 'Reports & Analytics', desc: 'Generate P&L, balance sheets, and GSTR reports instantly.' },
  ];

  const faqs = [
    { q: 'Is my data secure?', a: 'Yes, we use bank-level encryption and automated backups to ensure your business data is always safe and accessible only by you.' },
    { q: 'Is it GST compliant?', a: 'Absolutely. The software is designed specifically for Indian SMEs, ensuring 100% compliance with current GST laws and HSN/SAC codes.' },
    { q: 'Can multiple users access the system?', a: 'Yes! You can add multiple users like accountants, sales staff, or managers with specific role-based permissions.' },
    { q: 'Do I need accounting knowledge?', a: 'Not at all. The interface is designed for business owners, making it extremely easy to manage finances without a CPA degree.' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-[#420662] selection:text-white">
      {/* Navbar */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled ? 'bg-white shadow-md py-3' : 'bg-transparent py-5'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <img src="/logo-microtechnique.svg" alt="Microtechnique IT" className="h-10 w-auto" />
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">How It Works</a>
            <a href="#faq" className="text-sm font-medium text-slate-700 hover:text-[#420662] transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-[#420662] hover:text-[#2d0444] transition-colors hidden sm:block">Login</Link>
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

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
        {/* Background gradient blobs */}
        <div className="absolute top-0 right-0 -mr-40 -mt-40 w-[600px] h-[600px] rounded-full bg-[#420662]/10 blur-3xl opacity-60 pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-40 -mb-40 w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-3xl opacity-60 pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#420662]/10 text-[#420662] text-xs font-semibold mb-6 border border-[#420662]/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#420662] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#420662]"></span>
              </span>
              India's Best Manufacturing ERP
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold text-slate-900 tracking-tight leading-tight mb-6">
              Simplify Your Manufacturing <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#420662] to-indigo-600">Business Management</span>
            </h1>
            <p className="text-lg md:text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
              The all-in-one GST-compliant billing, inventory, production, and accounting software designed exclusively for Indian MSMEs.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/login" className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-[#420662] to-indigo-600 hover:from-[#2d0444] hover:to-indigo-700 text-white rounded-xl font-bold text-lg transition-all shadow-xl shadow-[#420662]/30 flex items-center justify-center gap-2 group">
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
            <p className="mt-4 text-sm text-slate-500">No credit card required • Free onboarding support</p>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-10 bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-semibold text-slate-500 uppercase tracking-wider mb-6">Trusted by fast-growing manufacturers</p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-16 text-slate-400">
            <div className="flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-[#420662]" /><span className="font-bold text-slate-700">100% Secure</span></div>
            <div className="flex items-center gap-2"><Users className="w-6 h-6 text-[#420662]" /><span className="font-bold text-slate-700">10,000+ Users</span></div>
            <div className="flex items-center gap-2"><CheckCircle2 className="w-6 h-6 text-[#420662]" /><span className="font-bold text-slate-700">GST Compliant</span></div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Everything You Need to Grow</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">Powerful features tailored for manufacturing and wholesale businesses.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <div key={i} className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 hover:shadow-xl hover:border-[#420662]/30 transition-all group">
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

      {/* How it Works */}
      <section id="how-it-works" className="py-24 bg-[#420662]/5 border-y border-[#420662]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Start in 3 Easy Steps</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">Get your business running efficiently in minutes, not days.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-12 relative">
            {/* Connecting line for desktop */}
            <div className="hidden md:block absolute top-12 left-1/6 right-1/6 h-0.5 bg-gradient-to-r from-[#420662]/20 via-[#420662]/50 to-[#420662]/20 z-0" />
            
            {[
              { step: '1', title: 'Setup Account', desc: 'Enter your GSTIN and let us auto-fetch your company details securely.' },
              { step: '2', title: 'Add Inventory', desc: 'Import items via Excel or add them manually to set up your stock.' },
              { step: '3', title: 'Start Billing', desc: 'Create professional invoices, manage production, and track payments instantly.' }
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

      {/* FAQ */}
      <section id="faq" className="py-24 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Frequently Asked Questions</h2>
          </div>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="border border-slate-200 rounded-xl overflow-hidden transition-all duration-200 hover:border-[#420662]/50">
                <button 
                  className="w-full px-6 py-5 text-left flex justify-between items-center bg-white hover:bg-slate-50"
                  onClick={() => setActiveFaq(activeFaq === i ? null : i)}
                >
                  <span className="font-bold text-slate-800 text-lg">{faq.q}</span>
                  <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform duration-300 ${activeFaq === i ? 'rotate-180' : ''}`} />
                </button>
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${activeFaq === i ? 'max-h-48 border-t border-slate-100' : 'max-h-0'}`}>
                  <div className="px-6 py-5 text-slate-600 leading-relaxed bg-slate-50/50">
                    {faq.a}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 relative overflow-hidden bg-[#420662]">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay"></div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight">Ready to streamline your manufacturing operations?</h2>
          <p className="text-xl text-blue-200 mb-10">Join thousands of SMEs who manage their business efficiently with Microtechnique IT.</p>
          <button 
            onClick={() => setShowPhone(true)} 
            className="px-10 py-5 bg-white text-[#420662] hover:bg-blue-50 rounded-xl font-extrabold text-xl transition-all shadow-2xl hover:shadow-white/20 hover:scale-105 flex items-center justify-center gap-3 mx-auto"
          >
            <Phone className="w-6 h-6" />
            {showPhone ? '+91 93907 54255' : 'Contact Us Today'}
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <img src="/logo-microtechnique.svg" alt="Microtechnique IT" className="h-10 mb-6 brightness-0 invert" />
            <p className="mb-6 max-w-sm">India's leading ERP software for manufacturing, wholesale, and retail businesses. Simplify operations and scale faster.</p>
            <div className="flex gap-4">
              {/* Social placeholders */}
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-[#420662] transition-colors cursor-pointer text-white">X</div>
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-[#420662] transition-colors cursor-pointer text-white">in</div>
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-[#420662] transition-colors cursor-pointer text-white">f</div>
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
              <li>support@microtechnique.in</li>
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
