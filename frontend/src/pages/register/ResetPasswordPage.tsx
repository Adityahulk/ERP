import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import registrantApi from '@/lib/registrantApi';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error('Reset link is invalid.');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const { data: res } = await registrantApi.post('/register/reset-password', { token, password });
      if (res.success) {
        setDone(true);
        toast.success('Password reset. Redirecting to sign in…');
        setTimeout(() => navigate('/register/login', { replace: true }), 1500);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Reset failed. The link may have expired.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 p-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-white mb-3">Reset link is invalid</h1>
          <p className="text-purple-300 mb-6">
            This page can only be opened from the link in your reset-password email.
          </p>
          <Link
            to="/register/forgot-password"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-lg"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

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
            {done ? <CheckCircle2 className="w-8 h-8 text-emerald-300" /> : <KeyRound className="w-8 h-8 text-purple-300" />}
          </div>
          <h1 className="text-2xl font-bold text-white">
            {done ? 'Password reset' : 'Choose a new password'}
          </h1>
          <p className="text-purple-300 mt-2 text-sm">
            {done
              ? 'You can now sign in with your new password.'
              : 'Pick a strong password — at least 8 characters.'}
          </p>
        </div>

        {!done ? (
          <form
            onSubmit={handleSubmit}
            className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 space-y-5"
          >
            <div>
              <label className="text-sm font-medium text-purple-200">New password</label>
              <div className="relative mt-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
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
              <label className="text-sm font-medium text-purple-200">Confirm new password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                placeholder="Repeat password"
                className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-lg shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        ) : (
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 text-center">
            <Link
              to="/register/login"
              className="inline-block text-purple-300 hover:text-purple-200 text-sm font-medium"
            >
              Continue to sign in →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
