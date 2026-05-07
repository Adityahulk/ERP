import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound, Loader2, MailCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import registrantApi from '@/lib/registrantApi';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data: res } = await registrantApi.post('/register/forgot-password', { email });
      if (res.success) {
        setSent(true);
        setDevLink(res.data?.dev_reset_link || null);
        toast.success('If that email exists, a reset link is on its way.');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not send reset link');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 p-4">
      <div className="absolute top-8 left-8">
        <Link to="/register/login" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </Link>
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto bg-gradient-to-br from-purple-500/30 to-purple-700/30 border border-purple-400/40 rounded-2xl flex items-center justify-center mb-4">
            {sent ? <MailCheck className="w-8 h-8 text-emerald-300" /> : <KeyRound className="w-8 h-8 text-purple-300" />}
          </div>
          <h1 className="text-2xl font-bold text-white">
            {sent ? 'Check your inbox' : 'Forgot your password?'}
          </h1>
          <p className="text-purple-300 mt-2 text-sm">
            {sent
              ? 'If an account exists for that address, a reset link has been emailed.'
              : 'Enter your account email and we\'ll send you a link to reset your password.'}
          </p>
        </div>

        {!sent ? (
          <form
            onSubmit={handleSubmit}
            className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 space-y-5"
          >
            <div>
              <label className="text-sm font-medium text-purple-200">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-lg shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        ) : (
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 space-y-4 text-center">
            <p className="text-slate-300 text-sm">
              The link expires in 1 hour. Check your spam folder if you don't see it.
            </p>
            {devLink ? (
              <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-left">
                <p className="text-amber-200 text-xs font-medium mb-1">Dev mode link</p>
                <a
                  href={devLink}
                  className="text-amber-100 text-xs break-all underline hover:no-underline"
                >
                  {devLink}
                </a>
              </div>
            ) : null}
            <Link
              to="/register/login"
              className="inline-block text-purple-300 hover:text-purple-200 text-sm font-medium"
            >
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
