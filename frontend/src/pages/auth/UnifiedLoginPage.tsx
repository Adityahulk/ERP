import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import registrantApi from '@/lib/registrantApi';
import { useAuthStore } from '@/store/authStore';
import { useRegistrantStore } from '@/store/registrantStore';

type LoginMode = 'licenses' | 'software';

function PasswordField({
  value,
  onChange,
  accent,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  accent: 'teal' | 'blue';
  id: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        autoComplete="current-password"
        className={`h-11 w-full rounded-md border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:ring-2 ${
          accent === 'teal'
            ? 'focus:border-teal-600 focus:ring-teal-100'
            : 'focus:border-blue-600 focus:ring-blue-100'
        }`}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function UnifiedLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const softwareLogin = useAuthStore((state) => state.login);
  const registrantLogin = useRegistrantStore((state) => state.login);
  const preferredMode = useMemo<LoginMode>(
    () => (new URLSearchParams(location.search).get('mode') === 'licenses' ? 'licenses' : 'software'),
    [location.search]
  );
  const [mobileMode, setMobileMode] = useState<LoginMode>(preferredMode);
  const [licenseEmail, setLicenseEmail] = useState('');
  const [licensePassword, setLicensePassword] = useState('');
  const [softwareEmail, setSoftwareEmail] = useState(
    import.meta.env.VITE_PREFILL_DEMO_LOGIN === 'true' ? 'admin@demo.com' : ''
  );
  const [softwarePassword, setSoftwarePassword] = useState(
    import.meta.env.VITE_PREFILL_DEMO_LOGIN === 'true' ? 'Demo@1234' : ''
  );
  const [licenseLoading, setLicenseLoading] = useState(false);
  const [softwareLoading, setSoftwareLoading] = useState(false);
  const [sessionMessage] = useState(() => {
    const message = sessionStorage.getItem('session_replaced_msg');
    if (message) sessionStorage.removeItem('session_replaced_msg');
    return message;
  });

  useEffect(() => {
    setMobileMode(preferredMode);
  }, [preferredMode]);

  const handleLicenseLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLicenseLoading(true);
    try {
      const { data: response } = await registrantApi.post('/register/login', {
        email: licenseEmail,
        password: licensePassword,
      });
      if (response.success) {
        registrantLogin(response.data.registrant, response.data.token);
        toast.success(`Welcome back, ${response.data.registrant.name}!`);
        const next = new URLSearchParams(location.search).get('next');
        navigate(next?.startsWith('/register') ? next : '/register/dashboard', { replace: true });
      }
    } catch (error: any) {
      const status = error?.response?.status;
      const code = error?.response?.data?.code;
      if (status === 403 && code === 'EMAIL_NOT_VERIFIED') {
        const data = error.response.data?.data || {};
        toast('Please verify your email to continue.');
        navigate('/register/verify', {
          state: {
            verificationToken: data.verification_token,
            emailMasked: data.email_masked,
            email: licenseEmail,
            devCode: data.dev_code,
          },
        });
        return;
      }
      toast.error(error?.response?.data?.error || 'License account login failed');
    } finally {
      setLicenseLoading(false);
    }
  };

  const handleSoftwareLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSoftwareLoading(true);
    try {
      const { data: response } = await api.post('/auth/login', {
        email: softwareEmail,
        password: softwarePassword,
      });
      if (response.success) {
        const company = response.data.company;
        const isSuperAdmin = response.data.user.role === 'super_admin';
        softwareLogin(
          {
            id: response.data.user.id,
            companyId: company?.id ?? null,
            name: response.data.user.name,
            email: response.data.user.email,
            role: response.data.user.role,
          },
          company
            ? {
                id: company.id,
                name: company.name,
                gstin: company.gstin,
                itemTerminology: company.item_terminology || 'Product',
                itemTerminologyPlural: company.item_terminology_plural || 'Products',
              }
            : null,
          response.data.accessToken,
          response.data.refreshToken
        );
        toast.success(`Welcome back, ${response.data.user.name}!`);
        navigate(isSuperAdmin ? '/superadmin' : '/dashboard', { replace: true });
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Software login failed');
    } finally {
      setSoftwareLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col">
        <header className="mb-5 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="text-sm font-semibold text-slate-900">Microtechnique Accounts</p>
              <p className="text-xs text-slate-500">Licensing and business software</p>
            </div>
            <img src="/logo-microtechnique.svg" alt="" className="h-11 w-auto" />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center">
          <div className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5 text-center sm:px-8">
              <h1 className="text-2xl font-bold text-slate-950">Choose where you want to sign in</h1>
              <p className="mt-1 text-sm text-slate-600">
                License purchasers and business users have different accounts. Pick the workspace you need.
              </p>
              {sessionMessage && (
                <p className="mx-auto mt-3 max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {sessionMessage}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 border-b border-slate-200 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileMode('licenses')}
                className={`px-3 py-3 text-sm font-semibold ${
                  mobileMode === 'licenses'
                    ? 'border-b-2 border-teal-600 bg-teal-50 text-teal-800'
                    : 'text-slate-500'
                }`}
              >
                License account
              </button>
              <button
                type="button"
                onClick={() => setMobileMode('software')}
                className={`px-3 py-3 text-sm font-semibold ${
                  mobileMode === 'software'
                    ? 'border-b-2 border-blue-600 bg-blue-50 text-blue-800'
                    : 'text-slate-500'
                }`}
              >
                Business software
              </button>
            </div>

            <div className="grid lg:grid-cols-2">
              <section
                className={`${mobileMode === 'licenses' ? 'block' : 'hidden'} border-slate-200 p-6 sm:p-8 lg:block lg:border-r`}
              >
                <div className="mb-6 flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">License account</h2>
                    <p className="mt-1 text-sm leading-5 text-slate-600">
                      View purchased licenses, trials, renewals and linked companies.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleLicenseLogin} className="space-y-4">
                  <div>
                    <label htmlFor="license-email" className="mb-1 block text-sm font-medium text-slate-700">License email</label>
                    <input
                      id="license-email"
                      type="email"
                      value={licenseEmail}
                      onChange={(event) => setLicenseEmail(event.target.value)}
                      required
                      autoComplete="username"
                      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <label htmlFor="license-password" className="text-sm font-medium text-slate-700">Password</label>
                      <Link
                        to="/register/forgot-password"
                        className="text-xs font-medium text-teal-700 hover:text-teal-900"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <PasswordField
                      value={licensePassword}
                      onChange={setLicensePassword}
                      accent="teal"
                      id="license-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={licenseLoading}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {licenseLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Sign in to licenses
                  </button>
                </form>
                <div className="mt-5 border-t border-slate-200 pt-4 text-sm text-slate-600">
                  Need a license?{' '}
                  <Link to="/register" className="font-semibold text-teal-700 hover:text-teal-900">
                    Create a license account
                  </Link>
                </div>
              </section>

              <section
                className={`${mobileMode === 'software' ? 'block' : 'hidden'} p-6 sm:p-8 lg:block`}
              >
                <div className="mb-6 flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Business software</h2>
                    <p className="mt-1 text-sm leading-5 text-slate-600">
                      Open billing, inventory, accounting and reports for your company.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSoftwareLogin} className="space-y-4">
                  <div>
                    <label htmlFor="software-email" className="mb-1 block text-sm font-medium text-slate-700">Software email</label>
                    <input
                      id="software-email"
                      type="email"
                      value={softwareEmail}
                      onChange={(event) => setSoftwareEmail(event.target.value)}
                      required
                      autoComplete="username"
                      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="software-password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
                    <PasswordField
                      value={softwarePassword}
                      onChange={setSoftwarePassword}
                      accent="blue"
                      id="software-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={softwareLoading}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {softwareLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Sign in to software
                  </button>
                </form>
                <div className="mt-5 flex items-start gap-2 border-t border-slate-200 pt-4 text-sm text-slate-600">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                  Platform administrators also sign in here with their admin credentials.
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
