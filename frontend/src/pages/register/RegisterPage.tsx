import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import registrantApi from '@/lib/registrantApi';
import { describeApiError } from '@/lib/api';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const intentParam = searchParams.get('intent');
  const intent = intentParam === 'trial' || intentParam === 'plan' ? intentParam : '';
  const tier = searchParams.get('tier') || '';

  const [form, setForm] = useState({
    business_name: '',
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!form.business_name.trim()) {
      toast.error('Business name is required');
      return;
    }

    setLoading(true);
    try {
      const { data: res } = await registrantApi.post('/register', {
        business_name: form.business_name.trim(),
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
        intent: intent || undefined,
      });

      if (res.success) {
        toast.success(res.data?.message || 'Verification code sent to your email.');
        navigate('/register/verify', {
          replace: true,
          state: {
            verificationToken: res.data.verification_token,
            emailMasked: res.data.email_masked,
            email: form.email,
            businessName: form.business_name.trim(),
            intent,
            tier,
            devCode: res.data.dev_code,
          },
        });
      }
    } catch (err: any) {
      toast.error(describeApiError(err, 'Registration failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const benefits = [
    'GST-compliant invoicing in under 60 seconds',
    'Real-time inventory across multiple locations',
    'Automatic GSTR-1 & GSTR-3B generation',
    'Role-based access for your entire team',
    'HR, attendance & payroll management',
  ];

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900">
      {/* Left — benefits panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center p-16 text-white">
        <div className="mb-8">
          <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-20 drop-shadow-lg mb-6" />
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Start your business software journey today
          </h1>
          <p className="text-purple-300 text-lg">
            Join hundreds of Indian businesses managing their operations smarter.
          </p>
        </div>
        <ul className="space-y-4">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
              <span className="text-slate-300">{b}</span>
            </li>
          ))}
        </ul>
        <div className="mt-12 p-6 bg-white/5 border border-white/10 rounded-2xl">
          <p className="text-purple-300 text-sm font-medium mb-2">Already have an account?</p>
          <Link
            to="/register/login"
            className="text-white font-semibold hover:text-purple-300 transition-colors"
          >
            Sign in to your registrant dashboard →
          </Link>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex flex-col">
        <div className="p-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="text-center mb-8 lg:hidden">
              <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-24 mx-auto mb-4 drop-shadow-lg" />
            </div>

            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white">Create your account</h2>
              <p className="text-slate-400 mt-1">
                {intent === 'trial'
                  ? 'Verify once, then start your 15-day full Diamond trial.'
                  : intent === 'plan'
                    ? 'Verify once, then request your selected plan.'
                    : 'Manage trials, licenses, and companies from one dashboard.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-purple-200 mb-1">Business / Company Name *</label>
                <input
                  type="text"
                  value={form.business_name}
                  onChange={(e) => update('business_name', e.target.value)}
                  required
                  placeholder="Your business name"
                  className="w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-purple-200 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  required
                  placeholder="Your full name"
                  className="w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-purple-200 mb-1">Email Address *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-purple-200 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  placeholder="+91 6355 997 080"
                  className="w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-purple-200 mb-1">Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => update('password', e.target.value)}
                    required
                    placeholder="Min. 8 characters"
                    className="w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 pr-12 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-purple-200 mb-1">Confirm Password *</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={(e) => update('confirmPassword', e.target.value)}
                  required
                  placeholder="Repeat your password"
                  className="w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-lg shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50 mt-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading
                  ? 'Creating account…'
                  : intent === 'trial'
                    ? 'Create Account & Verify'
                    : intent === 'plan'
                      ? 'Create Account & Request Plan'
                      : 'Create Account'}
              </button>
            </form>

            <p className="text-center text-sm text-slate-400 mt-6">
              Already have an account?{' '}
              <Link to="/register/login" className="text-purple-400 hover:text-purple-300 font-medium">
                Sign in
              </Link>
            </p>

            <p className="text-center text-xs text-slate-500 mt-4">
              Have login credentials?{' '}
              <Link to="/login" className="text-purple-400 hover:text-purple-300">
                Go to login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
