import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, MailCheck, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import registrantApi from '@/lib/registrantApi';
import { describeApiError } from '@/lib/api';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

interface LocationState {
  verificationToken?: string;
  emailMasked?: string;
  email?: string;
  businessName?: string;
  intent?: 'trial' | 'plan' | '';
  tier?: string;
  devCode?: string;
}

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useRegistrantStore();

  // The verify-email page is reached from /register, /register/login (when account is unverified),
  // or direct link with ?token=… as a fallback. Token comes from router state when possible.
  const initialState = (location.state || {}) as LocationState;
  const queryToken = new URLSearchParams(location.search).get('token') || '';

  const [verificationToken, setVerificationToken] = useState<string>(initialState.verificationToken || queryToken || '');
  const [emailMasked, setEmailMasked] = useState<string>(initialState.emailMasked || '');
  const [email] = useState<string>(initialState.email || '');
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // If we landed via /register or /register/login flow, the dev code may be passed through;
  // pre-fill it so the developer doesn't have to copy from logs.
  useEffect(() => {
    if (initialState.devCode && initialState.devCode.length === CODE_LENGTH) {
      setCode(initialState.devCode.split(''));
    }
    // Focus first empty cell
    const firstEmpty = (initialState.devCode ? CODE_LENGTH : 0);
    inputRefs.current[firstEmpty]?.focus();
  }, []);

  // Hydrate context from the token if we don't have masked email yet.
  useEffect(() => {
    if (!verificationToken || emailMasked) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: res } = await registrantApi.get('/register/verification-status', {
          params: { token: verificationToken },
        });
        if (!cancelled && res?.success && res.data) {
          setEmailMasked(res.data.registrant_email_masked || '');
        }
      } catch {
        // Silent — verify endpoint will give the user a real error if the token is bad.
      }
    })();
    return () => { cancelled = true; };
  }, [verificationToken, emailMasked]);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setInterval(() => setResendTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [resendTimer]);

  const setCodeAt = (idx: number, value: string) => {
    const next = [...code];
    next[idx] = value;
    setCode(next);
  };

  const onCellChange = (idx: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) {
      setCodeAt(idx, '');
      return;
    }
    if (cleaned.length === 1) {
      setCodeAt(idx, cleaned);
      if (idx < CODE_LENGTH - 1) inputRefs.current[idx + 1]?.focus();
    } else {
      // Pasted multi-digit value — distribute across cells.
      const chars = cleaned.slice(0, CODE_LENGTH).split('');
      const next = Array(CODE_LENGTH).fill('');
      for (let i = 0; i < chars.length; i++) next[i] = chars[i];
      setCode(next);
      const focusIdx = Math.min(chars.length, CODE_LENGTH - 1);
      inputRefs.current[focusIdx]?.focus();
    }
  };

  const onCellKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < CODE_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus();
    } else if (e.key === 'Enter') {
      handleVerify();
    }
  };

  const handleVerify = async () => {
    const joined = code.join('');
    if (joined.length !== CODE_LENGTH) {
      toast.error(`Enter the ${CODE_LENGTH}-digit code`);
      return;
    }
    if (!verificationToken) {
      toast.error('Verification session expired. Please sign up again.');
      navigate('/register');
      return;
    }
    setSubmitting(true);
    try {
      const { data: res } = await registrantApi.post('/register/verify', {
        verification_token: verificationToken,
        code: joined,
      });
      if (res.success) {
        login(res.data.registrant, res.data.token);
        const intent = initialState.intent || '';
        if (intent === 'trial') {
          try {
            await registrantApi.post('/licenses/start-trial', {
              business_name: initialState.businessName || undefined,
            });
            toast.success('Email verified and your 15-day trial is active.');
          } catch (trialErr: any) {
            if (trialErr?.response?.status === 409) {
              toast('Email verified. You already have an active trial.');
            } else {
              toast.error(trialErr?.response?.data?.error || 'Email verified, but trial could not be started.');
            }
          }
          navigate('/register/dashboard', { replace: true });
          return;
        }

        toast.success('Email verified — welcome!');
        if (intent === 'plan') {
          const qs = initialState.tier ? `?tier=${encodeURIComponent(initialState.tier)}` : '';
          navigate(`/register/licenses${qs}`, { replace: true });
          return;
        }

        navigate('/register/dashboard', { replace: true });
      }
    } catch (err: any) {
      const msg = describeApiError(err, 'Verification failed');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    try {
      const { data: res } = await registrantApi.post('/register/resend-verification', {
        verification_token: verificationToken || undefined,
        email: email || undefined,
      });
      if (res.success && res.data) {
        if (res.data.verification_token) setVerificationToken(res.data.verification_token);
        if (res.data.email_masked) setEmailMasked(res.data.email_masked);
        if (res.data.dev_code && res.data.dev_code.length === CODE_LENGTH) {
          setCode(res.data.dev_code.split(''));
          toast.success('Code generated (dev mode — pre-filled).');
        } else {
          toast.success('A new code has been sent to your email.');
        }
        setResendTimer(RESEND_COOLDOWN_SECONDS);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429) {
        const msg: string = err?.response?.data?.error || 'Please wait before requesting another code';
        toast.error(msg);
        const m = msg.match(/(\d+)/);
        if (m) setResendTimer(parseInt(m[1], 10));
      } else {
        toast.error(err?.response?.data?.error || 'Could not resend code');
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 p-4">
      <div className="absolute top-8 left-8">
        <Link to="/register" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to sign up
        </Link>
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto bg-gradient-to-br from-purple-500/30 to-purple-700/30 border border-purple-400/40 rounded-2xl flex items-center justify-center mb-4">
            <MailCheck className="w-8 h-8 text-purple-300" />
          </div>
          <h1 className="text-2xl font-bold text-white">Verify your email</h1>
          <p className="text-purple-300 mt-2 text-sm">
            We sent a {CODE_LENGTH}-digit code to{' '}
            <span className="font-semibold text-white">{emailMasked || 'your email'}</span>
          </p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 space-y-5">
          <div className="flex justify-between gap-2">
            {code.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => (inputRefs.current[idx] = el)}
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={CODE_LENGTH}
                value={digit}
                onChange={(e) => onCellChange(idx, e.target.value)}
                onKeyDown={(e) => onCellKeyDown(idx, e)}
                disabled={submitting}
                className="w-12 h-14 text-center rounded-lg bg-white/10 border border-white/20 text-white text-2xl font-bold tabular-nums focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition disabled:opacity-50"
                autoComplete="one-time-code"
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleVerify}
            disabled={submitting || code.join('').length !== CODE_LENGTH}
            className="w-full h-11 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-lg shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting
              ? 'Verifying…'
              : initialState.intent === 'trial'
                ? 'Verify and start trial'
                : initialState.intent === 'plan'
                  ? 'Verify and request plan'
                  : 'Verify and continue'}
          </button>

          <div className="flex items-center justify-between text-sm border-t border-white/10 pt-4">
            <span className="text-slate-400">Didn't get the code?</span>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendTimer > 0}
              className="inline-flex items-center gap-1.5 text-purple-300 hover:text-purple-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend code'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Wrong email?{' '}
          <Link to="/register" className="text-purple-400 hover:text-purple-300">
            Sign up again
          </Link>
        </p>
      </div>
    </div>
  );
}
