import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import registrantApi from '@/lib/registrantApi';
import { useAuthStore } from '@/store/authStore';
import { useRegistrantStore } from '@/store/registrantStore';

function PasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input id="account-password" type={visible ? 'text' : 'password'} value={value}
        onChange={(event) => onChange(event.target.value)} required autoComplete="current-password"
        className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
      <button type="button" onClick={() => setVisible((current) => !current)}
        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label={visible ? 'Hide password' : 'Show password'} title={visible ? 'Hide password' : 'Show password'}>
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function softwareSession(response: any) {
  const company = response.data.company;
  return {
    user: {
      id: response.data.user.id, companyId: company?.id ?? null, name: response.data.user.name,
      email: response.data.user.email, role: response.data.user.role,
    },
    company: company ? {
      id: company.id, name: company.name, gstin: company.gstin,
      itemTerminology: company.item_terminology || 'Product',
      itemTerminologyPlural: company.item_terminology_plural || 'Products',
    } : null,
    accessToken: response.data.accessToken,
    refreshToken: response.data.refreshToken,
  };
}

export default function UnifiedLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const loginSoftware = useAuthStore((state) => state.login);
  const loginRegistrant = useRegistrantStore((state) => state.login);
  const [email, setEmail] = useState(import.meta.env.VITE_PREFILL_DEMO_LOGIN === 'true' ? 'admin@demo.com' : '');
  const [password, setPassword] = useState(import.meta.env.VITE_PREFILL_DEMO_LOGIN === 'true' ? 'Demo@1234' : '');
  const [loading, setLoading] = useState(false);
  const [sessionMessage] = useState(() => {
    const message = sessionStorage.getItem('session_replaced_msg');
    if (message) sessionStorage.removeItem('session_replaced_msg');
    return message;
  });

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const credentials = { email: email.trim().toLowerCase(), password };
      const [softwareResult, registrantResult] = await Promise.allSettled([
        api.post('/auth/login', credentials),
        registrantApi.post('/register/login', credentials),
      ]);
      const softwareResponse = softwareResult.status === 'fulfilled' && softwareResult.value.data?.success
        ? softwareResult.value.data : null;
      const registrantResponse = registrantResult.status === 'fulfilled' && registrantResult.value.data?.success
        ? registrantResult.value.data : null;

      if (registrantResponse) loginRegistrant(registrantResponse.data.registrant, registrantResponse.data.token);
      if (softwareResponse) {
        const session = softwareSession(softwareResponse);
        loginSoftware(session.user, session.company, session.accessToken, session.refreshToken);
        toast.success(`Welcome back, ${session.user.name}!`);
        navigate(session.user.role === 'super_admin' ? '/superadmin' : '/dashboard', { replace: true });
        return;
      }
      if (registrantResponse) {
        toast.success(`Welcome back, ${registrantResponse.data.registrant.name}!`);
        const next = new URLSearchParams(location.search).get('next');
        navigate(next?.startsWith('/register') ? next : '/register/dashboard', { replace: true });
        return;
      }

      const registrantError = registrantResult.status === 'rejected' ? registrantResult.reason?.response : null;
      if (registrantError?.status === 403 && registrantError?.data?.code === 'EMAIL_NOT_VERIFIED') {
        const data = registrantError.data?.data || {};
        toast('Please verify your email to continue.');
        navigate('/register/verify', { state: {
          verificationToken: data.verification_token, emailMasked: data.email_masked,
          email: credentials.email, devCode: data.dev_code,
        } });
        return;
      }
      const softwareError = softwareResult.status === 'rejected' ? softwareResult.reason?.response?.data?.error : null;
      toast.error(softwareError || registrantError?.data?.error || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col">
        <header className="mb-5 flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <div className="flex items-center gap-3 text-right">
            <div><p className="text-sm font-semibold text-slate-900">Microtechnique Accounts</p><p className="text-xs text-slate-500">Billing, inventory and accounting</p></div>
            <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-11 w-auto" />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center">
          <div className="grid w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[1.15fr_0.85fr]">
            <section className="border-b border-slate-200 bg-slate-950 px-7 py-10 text-white sm:px-10 lg:border-b-0 lg:border-r">
              <div className="flex h-full max-w-xl flex-col justify-between gap-12">
                <div>
                  <img src="/logo-microtechnique.svg" alt="" className="mb-8 h-14 w-auto brightness-0 invert" />
                  <h1 className="max-w-lg text-3xl font-bold leading-tight sm:text-4xl">One account for your entire business.</h1>
                  <p className="mt-4 max-w-lg text-sm leading-6 text-slate-300">Sign in once. We will automatically open your business software or license workspace based on the account linked to this email.</p>
                </div>
                <div className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <div className="rounded-md border border-white/15 bg-white/5 p-4"><p className="font-semibold text-white">Business workspace</p><p className="mt-1 text-xs leading-5 text-slate-400">Billing, POS, inventory, accounting and reports.</p></div>
                  <div className="rounded-md border border-white/15 bg-white/5 p-4"><p className="font-semibold text-white">Account & licenses</p><p className="mt-1 text-xs leading-5 text-slate-400">Trials, plans, renewals and linked companies.</p></div>
                </div>
              </div>
            </section>
            <section className="flex items-center p-7 sm:p-10">
              <div className="w-full">
                <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-md bg-blue-50 text-blue-700"><LockKeyhole className="h-5 w-5" /></span>
                <h2 className="text-2xl font-bold text-slate-950">Sign in</h2>
                <p className="mt-1 text-sm text-slate-600">Use your registered email and password.</p>
                {sessionMessage && <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{sessionMessage}</p>}
                <form onSubmit={handleLogin} className="mt-7 space-y-4">
                  <div>
                    <label htmlFor="account-email" className="mb-1 block text-sm font-medium text-slate-700">Email address</label>
                    <input id="account-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" autoFocus
                      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-3"><label htmlFor="account-password" className="text-sm font-medium text-slate-700">Password</label><Link to="/register/forgot-password" className="text-xs font-medium text-blue-700 hover:text-blue-900">Forgot password?</Link></div>
                    <PasswordField value={password} onChange={setPassword} />
                  </div>
                  <button type="submit" disabled={loading} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}{loading ? 'Signing in…' : 'Continue'}
                  </button>
                </form>
                <div className="mt-5 flex items-start gap-2 border-t border-slate-200 pt-4 text-sm text-slate-600"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" /><span>License owners, business users and platform administrators all use this login.</span></div>
                <p className="mt-5 text-sm text-slate-600">New to Microtechnique? <Link to="/register" className="font-semibold text-blue-700 hover:text-blue-900">Create an account</Link></p>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
