import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import AppLayout from '@/components/shared/AppLayout';

// Pages
import DashboardPage from '@/pages/dashboard/DashboardPage';
import ItemList from '@/pages/items/ItemList';
import ItemDetail from '@/pages/items/ItemDetail';
import StockList from '@/pages/inventory/StockList';
import StockTransfer from '@/pages/inventory/StockTransfer';
import StockAdjustment from '@/pages/inventory/StockAdjustment';
import PartyList from '@/pages/parties/PartyList';
import InvoiceList from '@/pages/invoices/InvoiceList';
import InvoiceCreate from '@/pages/invoices/InvoiceCreate';
import InvoiceDetail from '@/pages/invoices/InvoiceDetail';
import ExpenseList from '@/pages/expenses/ExpenseList';

// ── Login Page ────────────────────────────────────────────────
import { useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

function LoginPage() {
  const { login } = useAuthStore();
  const [email, setEmail] = useState('admin@demo.com');
  const [password, setPassword] = useState('Demo@1234');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: res } = await api.post('/auth/login', { email, password });
      if (res.success) {
        login(
          { id: res.data.user.id, companyId: res.data.company.id, name: res.data.user.name, email: res.data.user.email, role: res.data.user.role },
          { id: res.data.company.id, name: res.data.company.name, gstin: res.data.company.gstin, itemTerminology: res.data.company.item_terminology || 'Product', itemTerminologyPlural: res.data.company.item_terminology_plural || 'Products' },
          res.data.accessToken,
          res.data.refreshToken
        );
        toast.success(`Welcome back, ${res.data.user.name}!`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4 shadow-xl shadow-blue-500/25">B</div>
          <h1 className="text-3xl font-bold text-white">BizFlow</h1>
          <p className="text-blue-300 mt-1">Smart ERP for Indian Businesses</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 space-y-5">
          <div>
            <label className="text-sm font-medium text-blue-200">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none transition" />
          </div>
          <div>
            <label className="text-sm font-medium text-blue-200">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none transition" />
          </div>
          <button type="submit" disabled={loading} className="w-full h-11 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <div className="text-center mt-4 text-xs text-blue-300/60">Demo: admin@demo.com / Demo@1234</div>
        </form>
      </div>
    </div>
  );
}

// ── Protected Route ───────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />} />

      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Items */}
        <Route path="/items" element={<ItemList />} />
        <Route path="/items/:id" element={<ItemDetail />} />

        {/* Inventory */}
        <Route path="/inventory" element={<StockList />} />
        <Route path="/inventory/transfer" element={<StockTransfer />} />
        <Route path="/inventory/adjust" element={<StockAdjustment />} />

        {/* Parties */}
        <Route path="/parties" element={<PartyList />} />

        {/* Invoices */}
        <Route path="/invoices" element={<InvoiceList />} />
        <Route path="/invoices/new" element={<InvoiceCreate />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />

        {/* Expenses */}
        <Route path="/expenses" element={<ExpenseList />} />
      </Route>

      <Route path="/" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
