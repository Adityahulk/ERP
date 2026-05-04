import { Routes, Route, Navigate, Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useRegistrantStore } from '@/store/registrantStore';
import AppLayout from '@/components/shared/AppLayout';
import RegisterPage from '@/pages/register/RegisterPage';
import RegisterLoginPage from '@/pages/register/RegisterLoginPage';
import RegisterDashboard from '@/pages/register/RegisterDashboard';
import LicenseTiersPage from '@/pages/register/LicenseTiersPage';
import LicenseDetailPage from '@/pages/register/LicenseDetailPage';
import ModuleGate from '@/components/shared/ModuleGate';

// Pages
import ItemList from '@/pages/items/ItemList';
import ItemDetail from '@/pages/items/ItemDetail';
import BarcodeGeneratePage from '@/pages/barcode/BarcodeGeneratePage';
import StockList from '@/pages/inventory/StockList';
import StockTransfer from '@/pages/inventory/StockTransfer';
import StockAdjustment from '@/pages/inventory/StockAdjustment';
import InvoiceCreate from '@/pages/invoices/InvoiceCreate';
import InvoiceDetail from '@/pages/sales/InvoiceDetail';
import GRNScreen from '@/pages/purchases/GRNScreen';
import QuotationForm from '@/pages/quotations/QuotationForm';
import QuotationDetail from '@/pages/quotations/QuotationDetail';
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
import PurchaseExpenseHub from '@/pages/purchase-expense/PurchaseExpenseHub';
import EmployeeListPage from '@/pages/hr/EmployeeListPage';
import EmployeeDetailPage from '@/pages/hr/EmployeeDetailPage';
import SalesHub from '@/pages/sales-hub/SalesHub';

import JobWorkChallanList from '@/pages/jobwork/JobWorkChallanList';
import JobWorkChallanForm from '@/pages/jobwork/JobWorkChallanForm';
import JobWorkChallanDetail from '@/pages/jobwork/JobWorkChallanDetail';

import SuperAdminLayout from '@/components/superadmin/SuperAdminLayout';
import SuperAdminDashboard from '@/pages/superadmin/SuperAdminDashboard';
import SuperAdminLicenses from '@/pages/superadmin/SuperAdminLicenses';
import SuperAdminLicenseDetail from '@/pages/superadmin/SuperAdminLicenseDetail';
import SuperAdminCompanies from '@/pages/superadmin/SuperAdminCompanies';
import SuperAdminCompanyDetail from '@/pages/superadmin/SuperAdminCompanyDetail';
import TrialSignupPage from '@/pages/trial/TrialSignupPage';

// ── Login Page ────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

function LoginPage() {
  const { login } = useAuthStore();
  const navigate = useNavigate();
  const prefillDemo = import.meta.env.VITE_PREFILL_DEMO_LOGIN === 'true';
  const [email, setEmail] = useState(prefillDemo ? 'admin@demo.com' : '');
  const [password, setPassword] = useState(prefillDemo ? 'Demo@1234' : '');
  const [loading, setLoading] = useState(false);
  const [sessionMsg] = useState(() => {
    const msg = sessionStorage.getItem('session_replaced_msg');
    if (msg) sessionStorage.removeItem('session_replaced_msg');
    return msg;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: res } = await api.post('/auth/login', { email, password });
      if (res.success) {
        const company = res.data.company;
        const isSuper = res.data.user.role === 'super_admin';
        login(
          {
            id: res.data.user.id,
            companyId: company?.id ?? null,
            name: res.data.user.name,
            email: res.data.user.email,
            role: res.data.user.role,
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
          res.data.accessToken,
          res.data.refreshToken
        );
        toast.success(`Welcome back, ${res.data.user.name}!`);
        navigate(isSuper ? '/superadmin' : '/dashboard', { replace: true });
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
          <img src="/logo-microtechnique.svg" alt="Microtechnique Accounts" className="h-16 mx-auto mb-4 brightness-0 invert" />
          <h1 className="text-2xl font-bold text-white uppercase tracking-wider">Microtechnique Accounts</h1>
          <p className="text-purple-300 mt-1">Smart ERP for Indian Manufacturers</p>
        </div>
        {sessionMsg && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm text-center">
            {sessionMsg}
          </div>
        )}
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
        </form>
        <div className="text-center mt-4 space-y-2">
          <p className="text-sm text-slate-400">
            Want to purchase a license?{' '}
            <RouterLink to="/register" className="text-purple-400 hover:text-purple-300 font-medium">
              Register here
            </RouterLink>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Protected Route ───────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function TenantGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role === 'super_admin') {
    return <Navigate to="/superadmin" replace />;
  }
  return <>{children}</>;
}

function SuperAdminShell() {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'super_admin') return <Navigate to="/dashboard" replace />;
  return <SuperAdminLayout />;
}

function AuthHomeRedirect() {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <LandingPage />;
  return <Navigate to={user?.role === 'super_admin' ? '/superadmin' : '/dashboard'} replace />;
}

function LoginEntry() {
  const { isAuthenticated, user } = useAuthStore();
  if (isAuthenticated) {
    return <Navigate to={user?.role === 'super_admin' ? '/superadmin' : '/dashboard'} replace />;
  }
  return <LoginPage />;
}

function OnboardingEntry() {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === 'super_admin') return <Navigate to="/superadmin" replace />;
  return <Onboarding />;
}

// ── Registrant Protected Route ────────────────────────────────
function RegistrantRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useRegistrantStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/register/login" replace />;
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
      <Route path="/" element={<AuthHomeRedirect />} />
      <Route path="/login" element={<LoginEntry />} />

      <Route path="/superadmin" element={<SuperAdminShell />}>
        <Route index element={<SuperAdminDashboard />} />
        <Route path="licenses" element={<SuperAdminLicenses />} />
        <Route path="licenses/:id" element={<SuperAdminLicenseDetail />} />
        <Route path="companies" element={<SuperAdminCompanies />} />
        <Route path="companies/:id" element={<SuperAdminCompanyDetail />} />
      </Route>

      <Route element={<ProtectedRoute><TenantGate><AppLayout /></TenantGate></ProtectedRoute>}>
        {/* Items */}
        <Route path="/items" element={<ItemList />} />
        <Route path="/items/:id" element={<ItemDetail />} />
        <Route path="/barcode/generate" element={<BarcodeGeneratePage />} />

        {/* Inventory */}
        <Route path="/inventory" element={<StockList />} />
        <Route path="/inventory/transfer" element={<StockTransfer />} />
        <Route path="/inventory/adjust" element={<StockAdjustment />} />


        {/* Parties */}
        <Route path="/parties" element={<PartyList />} />
        <Route path="/parties/:id" element={<PartyDetail />} />

        {/* Dashboard Core */}
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Sales Hub */}
        <Route path="/sales-hub" element={<Navigate to="/sales-hub/invoices" replace />} />
        <Route path="/sales-hub/:tab" element={<SalesHub />} />

        {/* Legacy redirects */}
        <Route path="/sales" element={<Navigate to="/sales-hub/invoices" replace />} />
        <Route path="/quotations" element={<Navigate to="/sales-hub/quotations" replace />} />

        {/* Keep detail + create pages accessible */}
        <Route path="/billing" element={<BillingScreen />} />
        <Route path="/sales/new" element={<InvoiceCreate />} />
        <Route path="/sales/:id" element={<InvoiceDetail />} />
        <Route path="/quotations/new" element={<QuotationForm />} />
        <Route path="/quotations/:id" element={<QuotationDetail />} />

        {/* Purchase & Expense Hub */}
        <Route path="/purchase-expense" element={<Navigate to="/purchase-expense/bills" replace />} />
        <Route path="/purchase-expense/:tab" element={<PurchaseExpenseHub />} />

        {/* Legacy redirects */}
        <Route path="/purchases" element={<Navigate to="/purchase-expense/orders" replace />} />
        <Route path="/purchases/new" element={<Navigate to="/purchase-expense/orders" replace />} />
        <Route path="/purchases/:id/receive" element={<GRNScreen />} />
        <Route path="/expenses" element={<Navigate to="/purchase-expense/expenses" replace />} />
        {/* Reports & Accounting */}
        <Route path="/reports" element={<ModuleGate featureKey="basic_reports" featureLabel="Business Reports"><ReportsHome /></ModuleGate>} />
        <Route path="/gst-filing" element={<ModuleGate featureKey="gst_filing" featureLabel="GST Filing"><GSTDashboard /></ModuleGate>} />

        {/* HR & Attendance */}
        <Route path="/attendance" element={<ModuleGate featureKey="hr" featureLabel="HR & Attendance"><AttendancePage /></ModuleGate>} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/hr/employees" element={<ModuleGate featureKey="hr" featureLabel="HR & Employees"><EmployeeListPage /></ModuleGate>} />
        <Route path="/hr/employees/:userId" element={<ModuleGate featureKey="hr" featureLabel="HR & Employees"><EmployeeDetailPage /></ModuleGate>} />

        {/* Job Work */}
        <Route path="/job-work" element={<ModuleGate featureKey="job_work" featureLabel="Job Work Challans"><JobWorkChallanList /></ModuleGate>} />
        <Route path="/job-work/new" element={<ModuleGate featureKey="job_work" featureLabel="Job Work Challans"><JobWorkChallanForm /></ModuleGate>} />
        <Route path="/job-work/:id" element={<ModuleGate featureKey="job_work" featureLabel="Job Work Challans"><JobWorkChallanDetail /></ModuleGate>} />

        {/* Global Config */}
        <Route path="/settings" element={<Settings />} />

      </Route>

      <Route path="/onboarding" element={<OnboardingEntry />} />

      {/* ── Free Trial signup ────────────────────────────────── */}
      <Route path="/trial" element={<TrialSignupPage />} />

      {/* ── Registrant / License routes ─────────────────────── */}
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/login" element={<RegisterLoginPage />} />
      <Route
        path="/register/dashboard"
        element={<RegistrantRoute><RegisterDashboard /></RegistrantRoute>}
      />
      <Route
        path="/register/licenses"
        element={<RegistrantRoute><LicenseTiersPage /></RegistrantRoute>}
      />
      <Route
        path="/register/licenses/:id"
        element={<RegistrantRoute><LicenseDetailPage /></RegistrantRoute>}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
