import { Routes, Route, Navigate, Link as RouterLink } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import AppLayout from '@/components/shared/AppLayout';

// Pages
import ItemList from '@/pages/items/ItemList';
import ItemDetail from '@/pages/items/ItemDetail';
import StockList from '@/pages/inventory/StockList';
import StockTransfer from '@/pages/inventory/StockTransfer';
import StockAdjustment from '@/pages/inventory/StockAdjustment';
import InvoiceList from '@/pages/sales/InvoiceList';
import InvoiceCreate from '@/pages/invoices/InvoiceCreate';
import InvoiceDetail from '@/pages/sales/InvoiceDetail';
import PurchaseOrderList from '@/pages/purchases/PurchaseOrderList';
import PurchaseOrderForm from '@/pages/purchases/PurchaseOrderForm';
import GRNScreen from '@/pages/purchases/GRNScreen';
import QuotationList from '@/pages/quotations/QuotationList';
import QuotationForm from '@/pages/quotations/QuotationForm';
import QuotationDetail from '@/pages/quotations/QuotationDetail';
import ExpenseList from '@/pages/expenses/ExpenseList';
import GSTDashboard from '@/pages/reports/GSTDashboard';
import AttendancePage from '@/pages/hr/AttendancePage';
import ProfilePage from '@/pages/hr/ProfilePage';
import Dashboard from '@/pages/dashboard/Dashboard';
import Onboarding from '@/pages/onboarding/Onboarding';
import BillingScreen from '@/pages/billing/BillingScreen';
import ReportsHome from '@/pages/reports/ReportsHome';
import Settings from '@/pages/settings/Settings';
import LandingPage from '@/pages/landing/LandingPage';

import PartyList from '@/pages/parties/PartyList';
import PartyDetail from '@/pages/parties/PartyDetail';

// Manufacturing modules
import BOMList from '@/pages/production/BOMList';
import BOMForm from '@/pages/production/BOMForm';
import WholesaleOrderList from '@/pages/wholesale/WholesaleOrderList';
import WholesaleOrderForm from '@/pages/wholesale/WholesaleOrderForm';
import WholesaleOrderDetail from '@/pages/wholesale/WholesaleOrderDetail';
import WholesalePriceTiers from '@/pages/wholesale/WholesalePriceTiers';
import JobWorkChallanList from '@/pages/jobwork/JobWorkChallanList';
import JobWorkChallanForm from '@/pages/jobwork/JobWorkChallanForm';
import JobWorkChallanDetail from '@/pages/jobwork/JobWorkChallanDetail';

// ── Login Page ────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

function LoginPage() {
  const { login } = useAuthStore();
  const prefillDemo = import.meta.env.VITE_PREFILL_DEMO_LOGIN === 'true';
  const [email, setEmail] = useState(prefillDemo ? 'admin@demo.com' : '');
  const [password, setPassword] = useState(prefillDemo ? 'Demo@1234' : '');
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#2d0444] to-slate-900 p-4">
      <div className="absolute top-8 left-8">
        <RouterLink to="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </RouterLink>
      </div>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo-microtechnique.svg" alt="Microtechnique IT" className="h-16 mx-auto mb-4 brightness-0 invert" />
          <h1 className="text-2xl font-bold text-white uppercase tracking-wider">Microtechnique IT</h1>
          <p className="text-purple-300 mt-1">Smart ERP for Indian Manufacturers</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 space-y-5">
          <div>
            <label className="text-sm font-medium text-purple-200">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition" />
          </div>
          <div>
            <label className="text-sm font-medium text-purple-200">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="mt-1 w-full h-11 rounded-lg bg-white/10 border border-white/20 px-4 text-white placeholder:text-white/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none transition" />
          </div>
          <button type="submit" disabled={loading} className="w-full h-11 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#420662] to-purple-600 hover:from-purple-700 hover:to-[#420662] text-white font-semibold rounded-lg shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <div className="text-center mt-4 text-xs text-purple-300/60">Demo: admin@demo.com / Demo@1234</div>
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
  const { isAuthenticated, logout } = useAuthStore();

  // If Zustand persist restored isAuthenticated=true but the actual tokens are gone from
  // localStorage (e.g. cleared externally, or tokens expired before next visit), force
  // a clean logout so the user is sent to /login instead of hitting 401s on every request.
  useEffect(() => {
    if (isAuthenticated && !localStorage.getItem('bizflow_access_token')) {
      logout();
    }
  }, []);

  return (
    <Routes>
      <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />} />

      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        {/* Items */}
        <Route path="/items" element={<ItemList />} />
        <Route path="/items/:id" element={<ItemDetail />} />

        {/* Inventory */}
        <Route path="/inventory" element={<StockList />} />
        <Route path="/inventory/transfer" element={<StockTransfer />} />
        <Route path="/inventory/adjust" element={<StockAdjustment />} />


        {/* Parties */}
        <Route path="/parties" element={<PartyList />} />
        <Route path="/parties/:id" element={<PartyDetail />} />

        {/* Dashboard Core */}
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Sales & Billing */}
        <Route path="/billing" element={<BillingScreen />} />
        <Route path="/sales" element={<InvoiceList />} />
        <Route path="/sales/new" element={<InvoiceCreate />} />
        <Route path="/sales/:id" element={<InvoiceDetail />} />

        <Route path="/quotations" element={<QuotationList />} />
        <Route path="/quotations/new" element={<QuotationForm />} />
        <Route path="/quotations/:id" element={<QuotationDetail />} />

        {/* Purchases */}
        <Route path="/purchases" element={<PurchaseOrderList />} />
        <Route path="/purchases/new" element={<PurchaseOrderForm />} />
        <Route path="/purchases/:id/receive" element={<GRNScreen />} />

        {/* Expenses */}
        <Route path="/expenses" element={<ExpenseList />} />
        {/* Reports & Accounting */}
        <Route path="/reports" element={<ReportsHome />} />
        <Route path="/gst-filing" element={<GSTDashboard />} />

        {/* HR & Attendance */}
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/profile" element={<ProfilePage />} />

        {/* Production / BOM */}
        <Route path="/production" element={<BOMList />} />
        <Route path="/production/new" element={<BOMForm />} />
        <Route path="/production/:id" element={<BOMForm />} />

        {/* Wholesale */}
        <Route path="/wholesale" element={<WholesaleOrderList />} />
        <Route path="/wholesale/new" element={<WholesaleOrderForm />} />
        <Route path="/wholesale/pricing" element={<WholesalePriceTiers />} />
        <Route path="/wholesale/:id" element={<WholesaleOrderDetail />} />

        {/* Job Work */}
        <Route path="/job-work" element={<JobWorkChallanList />} />
        <Route path="/job-work/new" element={<JobWorkChallanForm />} />
        <Route path="/job-work/:id" element={<JobWorkChallanDetail />} />

        {/* Global Config */}
        <Route path="/settings" element={<Settings />} />

      </Route>

      <Route path="/onboarding" element={isAuthenticated ? <Onboarding /> : <Navigate to="/login" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
