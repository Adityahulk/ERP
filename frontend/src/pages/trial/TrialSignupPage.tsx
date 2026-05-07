import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle2, Copy, Check, Eye, EyeOff, Zap, Shield, Clock } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface SuccessData {
  email: string;
  company_name: string;
  trial_expires_at: string;
  trial_days_remaining: number;
}

export default function TrialSignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);

  const [form, setForm] = useState({
    business_name: '',
    name: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.business_name.trim()) e.business_name = 'Business name is required';
    if (!form.name.trim()) e.name = 'Your name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 8) e.password = 'Password must be at least 8 characters';
    if (form.password !== form.confirm_password) e.confirm_password = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const { data: res } = await api.post('/auth/trial-signup', {
        business_name: form.business_name,
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
      });
      if (res.success) {
        setSuccessData(res.data);
        setStep('success');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const copyCredentials = () => {
    if (!successData) return;
    const text = `Microtechnique Accounts — Trial Access\nBusiness: ${successData.company_name}\nEmail: ${successData.email}\nPassword: ${form.password}\nTrial ends: ${new Date(successData.trial_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}\nLogin: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (step === 'success' && successData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-9 h-9 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Trial Active!</h1>
            <p className="text-purple-300 mb-6">
              Your 15-day free trial for <strong className="text-white">{successData.company_name}</strong> is ready.
            </p>

            {/* Credential box */}
            <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4 text-left mb-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Login Credentials</span>
                <button
                  onClick={copyCredentials}
                  className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy All'}
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Login URL</span>
                  <span className="text-white font-mono">{window.location.origin}/login</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Email</span>
                  <span className="text-white font-mono">{successData.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Password</span>
                  <span className="text-white font-mono">{form.password}</span>
                </div>
              </div>
            </div>

            {/* Trial badge */}
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-6">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-sm text-amber-300 text-left">
                Trial expires on{' '}
                <strong>
                  {new Date(successData.trial_expires_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </strong>
                . Full Diamond plan features are unlocked during your trial.
              </p>
            </div>

            <button
              onClick={() => navigate('/login')}
              className="w-full h-11 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-xl transition-all"
            >
              Go to Login →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 p-4">
      <div className="absolute top-8 left-8">
        <Link to="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </div>

      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-24 mx-auto mb-4 drop-shadow-lg" />
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 mb-3">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-300 text-sm font-semibold">15-Day Free Trial</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Start your free trial</h1>
          <p className="text-purple-300 mt-1 text-sm">Full Diamond plan features. No credit card required.</p>
        </div>

        {/* Feature bullets */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { icon: Shield, text: 'All features unlocked' },
            { icon: Clock, text: '15 days free' },
            { icon: Zap, text: 'Instant access' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex flex-col items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl p-3 text-center">
              <Icon className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-slate-300">{text}</span>
            </div>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Business Name */}
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-purple-200">Business / Company Name *</label>
              <input
                type="text"
                value={form.business_name}
                onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
                placeholder="Sharma Traders Pvt Ltd"
                className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
              />
              {errors.business_name && <p className="text-red-400 text-xs mt-1">{errors.business_name}</p>}
            </div>

            {/* Full Name */}
            <div>
              <label className="text-sm font-medium text-purple-200">Your Full Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Rahul Sharma"
                className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            {/* Phone */}
            <div>
              <label className="text-sm font-medium text-purple-200">Phone <span className="text-slate-500">(optional)</span></label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="6355997080"
                className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
              />
            </div>

            {/* Email */}
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-purple-200">Work Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="you@yourbusiness.com"
                className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
              />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
            </div>

            {/* Password */}
            <div>
              <label className="text-sm font-medium text-purple-200">Password *</label>
              <div className="relative mt-1">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Min 8 characters"
                  className="w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 pr-11 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
                />
                <button type="button" onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="text-sm font-medium text-purple-200">Confirm Password *</label>
              <div className="relative mt-1">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={form.confirm_password}
                  onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))}
                  placeholder="Repeat password"
                  className="w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 pr-11 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
                />
                <button type="button" onClick={() => setShowConfirm(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.confirm_password && <p className="text-red-400 text-xs mt-1">{errors.confirm_password}</p>}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 mt-2 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? 'Setting up your trial…' : 'Start Free Trial'}
          </button>

          <p className="text-center text-xs text-slate-500 mt-2">
            By signing up you agree to our terms. No credit card required.
          </p>
        </form>

        <div className="text-center mt-4 space-y-1">
          <p className="text-sm text-slate-400">
            Already have an account?{' '}
            <Link to="/login" className="text-purple-400 hover:text-purple-300 font-medium">Sign In</Link>
          </p>
          <p className="text-sm text-slate-500">
            Want to buy a license?{' '}
            <Link to="/register" className="text-purple-400 hover:text-purple-300 font-medium">Register here</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
