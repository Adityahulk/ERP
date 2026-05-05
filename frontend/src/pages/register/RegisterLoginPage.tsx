import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import registrantApi from '@/lib/registrantApi';
import { useRegistrantStore } from '@/store/registrantStore';

export default function RegisterLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useRegistrantStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: res } = await registrantApi.post('/register/login', { email, password });
      if (res.success) {
        login(res.data.registrant, res.data.token);
        toast.success(`Welcome back, ${res.data.registrant.name}!`);
        const next = new URLSearchParams(location.search).get('next');
        navigate(next && next.startsWith('/register') ? next : '/register/dashboard', { replace: true });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 p-4">
      <div className="absolute top-8 left-8">
        <Link to="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-20 mx-auto mb-4 drop-shadow-lg" />
          <h1 className="text-2xl font-bold text-white">Registrant Sign In</h1>
          <p className="text-purple-300 mt-1">Access your license dashboard</p>
        </div>

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
              className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-purple-200">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-lg shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="text-center mt-6 space-y-2">
          <p className="text-sm text-slate-400">
            Don't have an account?{' '}
            <Link to="/register" className="text-purple-400 hover:text-purple-300 font-medium">
              Register now
            </Link>
          </p>
          <p className="text-xs text-slate-500">
            Have login credentials?{' '}
            <Link to="/login" className="text-purple-400 hover:text-purple-300">
              Go to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
