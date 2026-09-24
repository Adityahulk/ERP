import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useRegistrantStore } from '@/store/registrantStore';
import { LEGACY_STORAGE_KEYS, readStorageWithLegacy, STORAGE_KEYS } from '@/lib/storageKeys';
import ModuleGate from '@/components/shared/ModuleGate';
import { canAccessRole, normalizeRole, type NormalizedRole } from '@/lib/roles';
import PrivateRouteSeo from '@/components/seo/PrivateRouteSeo';

// Route-level splitting keeps the first screen small. Large features such as
// reports, settings, PDF preview, and barcode tooling load only when opened.
const AppLayout = lazy(() => import('@/components/shared/AppLayout'));
const RegisterPage = lazy(() => import('@/pages/register/RegisterPage'));
const UnifiedLoginPage = lazy(() => import('@/pages/auth/UnifiedLoginPage'));
const RegisterDashboard = lazy(() => import('@/pages/register/RegisterDashboard'));
const LicenseTiersPage = lazy(() => import('@/pages/register/LicenseTiersPage'));
const LicenseDetailPage = lazy(() => import('@/pages/register/LicenseDetailPage'));
const VerifyEmailPage = lazy(() => import('@/pages/register/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/register/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/register/ResetPasswordPage'));
const ItemList = lazy(() => import('@/pages/items/ItemList'));
const ItemDetail = lazy(() => import('@/pages/items/ItemDetail'));
const BarcodeGeneratePage = lazy(() => import('@/pages/barcode/BarcodeGeneratePage'));
const StockList = lazy(() => import('@/pages/inventory/StockList'));
const StockTransfer = lazy(() => import('@/pages/inventory/StockTransfer'));
const StockAdjustment = lazy(() => import('@/pages/inventory/StockAdjustment'));
const InvoiceCreate = lazy(() => import('@/pages/invoices/InvoiceCreate'));
const InvoiceDetail = lazy(() => import('@/pages/sales/InvoiceDetail'));
const GRNScreen = lazy(() => import('@/pages/purchases/GRNScreen'));
const QuotationForm = lazy(() => import('@/pages/quotations/QuotationForm'));
const QuotationDetail = lazy(() => import('@/pages/quotations/QuotationDetail'));
const GSTDashboard = lazy(() => import('@/pages/reports/GSTDashboard'));
const AttendancePage = lazy(() => import('@/pages/hr/AttendancePage'));
const ProfilePage = lazy(() => import('@/pages/hr/ProfilePage'));
const Dashboard = lazy(() => import('@/pages/dashboard/Dashboard'));
const Onboarding = lazy(() => import('@/pages/onboarding/Onboarding'));
const BillingScreen = lazy(() => import('@/pages/billing/BillingScreen'));
const MobileScannerScreen = lazy(() => import('@/pages/billing/MobileScannerScreen'));
const ReportsHome = lazy(() => import('@/pages/reports/ReportsHome'));
const AccountingDashboard = lazy(() => import('@/pages/accounting/AccountingDashboard'));
const CashBankPage = lazy(() => import('@/pages/accounting/CashBankPage'));
const Settings = lazy(() => import('@/pages/settings/Settings'));
const LandingPage = lazy(() => import('@/pages/landing/LandingPage'));
const PartyList = lazy(() => import('@/pages/parties/PartyList'));
const PartyDetail = lazy(() => import('@/pages/parties/PartyDetail'));
const PurchaseExpenseHub = lazy(() => import('@/pages/purchase-expense/PurchaseExpenseHub'));
const EmployeeListPage = lazy(() => import('@/pages/hr/EmployeeListPage'));
const EmployeeDetailPage = lazy(() => import('@/pages/hr/EmployeeDetailPage'));
const SalesHub = lazy(() => import('@/pages/sales-hub/SalesHub'));
const JobWorkChallanList = lazy(() => import('@/pages/jobwork/JobWorkChallanList'));
const JobWorkChallanForm = lazy(() => import('@/pages/jobwork/JobWorkChallanForm'));
const JobWorkChallanDetail = lazy(() => import('@/pages/jobwork/JobWorkChallanDetail'));
const SuperAdminLayout = lazy(() => import('@/components/superadmin/SuperAdminLayout'));
const SuperAdminDashboard = lazy(() => import('@/pages/superadmin/SuperAdminDashboard'));
const SuperAdminLicenses = lazy(() => import('@/pages/superadmin/SuperAdminLicenses'));
const SuperAdminLicenseDetail = lazy(() => import('@/pages/superadmin/SuperAdminLicenseDetail'));
const SuperAdminCompanies = lazy(() => import('@/pages/superadmin/SuperAdminCompanies'));
const SuperAdminCompanyDetail = lazy(() => import('@/pages/superadmin/SuperAdminCompanyDetail'));
const SuperAdminRegistrants = lazy(() => import('@/pages/superadmin/SuperAdminRegistrants'));
const ProductSeoPage = lazy(() => import('@/pages/seo/ProductSeoPage'));

function RouteLoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" aria-hidden />
        Loading workspace...
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
  return <UnifiedLoginPage />;
}

function OnboardingEntry() {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === 'super_admin') return <Navigate to="/superadmin" replace />;
  return <Onboarding />;
}

function RoleGate({ allowed, children }: { allowed: NormalizedRole[]; children: React.ReactNode }) {
  const { user } = useAuthStore();
  const actualRole = normalizeRole(user?.role);
  if (actualRole === 'super_admin') return <>{children}</>;
  if (canAccessRole(user?.role, allowed)) return <>{children}</>;
  return <Navigate to={actualRole === 'staff' ? '/attendance' : '/dashboard'} replace />;
}

// ── Registrant Protected Route ────────────────────────────────
function RegistrantRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, token } = useRegistrantStore();
  const hasToken = !!(token || readStorageWithLegacy(STORAGE_KEYS.registrantToken, LEGACY_STORAGE_KEYS.registrantToken));
  return isAuthenticated && hasToken ? <>{children}</> : <Navigate to="/register/login" replace />;
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, logout } = useAuthStore();

  // If Zustand persist restored isAuthenticated=true but the actual tokens are gone from
  // localStorage (e.g. cleared externally, or tokens expired before next visit), force
  // a clean logout so the user is sent to /login instead of hitting 401s on every request.
  useEffect(() => {
    if (isAuthenticated && !readStorageWithLegacy(STORAGE_KEYS.accessToken, LEGACY_STORAGE_KEYS.accessToken)) {
      logout();
    }
  }, [isAuthenticated, logout]);

  return (
    <Suspense fallback={<RouteLoadingState />}>
    <PrivateRouteSeo />
    <Routes>
      <Route path="/" element={<AuthHomeRedirect />} />
      <Route path="/:slug" element={<ProductSeoPage />} />
      <Route path="/login" element={<LoginEntry />} />

      <Route path="/superadmin" element={<SuperAdminShell />}>
        <Route index element={<SuperAdminDashboard />} />
        <Route path="registrants" element={<SuperAdminRegistrants />} />
        <Route path="licenses" element={<SuperAdminLicenses />} />
        <Route path="licenses/:id" element={<SuperAdminLicenseDetail />} />
        <Route path="companies" element={<SuperAdminCompanies />} />
        <Route path="companies/:id" element={<SuperAdminCompanyDetail />} />
      </Route>

      <Route element={<ProtectedRoute><TenantGate><AppLayout /></TenantGate></ProtectedRoute>}>
        {/* Items */}
        <Route path="/items" element={<RoleGate allowed={['admin', 'manager']}><ItemList /></RoleGate>} />
        <Route path="/items/:id" element={<RoleGate allowed={['admin', 'manager']}><ItemDetail /></RoleGate>} />
        <Route path="/barcode/generate" element={<RoleGate allowed={['admin', 'manager']}><BarcodeGeneratePage /></RoleGate>} />

        {/* Inventory */}
        <Route path="/inventory" element={<RoleGate allowed={['admin', 'manager']}><StockList /></RoleGate>} />
        <Route path="/inventory/transfer" element={<RoleGate allowed={['admin', 'manager']}><StockTransfer /></RoleGate>} />
        <Route path="/inventory/adjust" element={<RoleGate allowed={['admin', 'manager']}><StockAdjustment /></RoleGate>} />


        {/* Parties */}
        <Route path="/parties" element={<RoleGate allowed={['admin', 'manager']}><PartyList /></RoleGate>} />
        <Route path="/parties/:id" element={<RoleGate allowed={['admin', 'manager']}><PartyDetail /></RoleGate>} />

        {/* Dashboard Core */}
        <Route path="/dashboard" element={<RoleGate allowed={['admin', 'manager']}><Dashboard /></RoleGate>} />

        {/* Sales Hub */}
        <Route path="/sales-hub" element={<Navigate to="/sales-hub/invoices" replace />} />
        <Route path="/sales-hub/:tab" element={<SalesHub />} />

        {/* Legacy redirects */}
        <Route path="/sales" element={<Navigate to="/sales-hub/invoices" replace />} />
        <Route path="/quotations" element={<Navigate to="/sales-hub/quotations" replace />} />

        {/* Keep detail + create pages accessible */}
        <Route path="/billing" element={<RoleGate allowed={['admin', 'manager', 'staff']}><BillingScreen /></RoleGate>} />
        <Route path="/sales/new" element={<RoleGate allowed={['admin', 'manager']}><InvoiceCreate /></RoleGate>} />
        <Route path="/sales/:id/edit" element={<RoleGate allowed={['admin', 'manager']}><InvoiceCreate /></RoleGate>} />
        <Route path="/sales/:id" element={<RoleGate allowed={['admin', 'manager']}><InvoiceDetail /></RoleGate>} />
        <Route path="/quotations/new" element={<RoleGate allowed={['admin', 'manager']}><QuotationForm /></RoleGate>} />
        <Route path="/quotations/:id" element={<RoleGate allowed={['admin', 'manager']}><QuotationDetail /></RoleGate>} />
        <Route path="/proforma-invoices" element={<Navigate to="/sales-hub/proforma" replace />} />
        <Route path="/proforma-invoices/new" element={<RoleGate allowed={['admin', 'manager']}><QuotationForm documentType="proforma" /></RoleGate>} />
        <Route path="/proforma-invoices/:id" element={<RoleGate allowed={['admin', 'manager']}><QuotationDetail /></RoleGate>} />

        {/* Purchase & Expense Hub */}
        <Route path="/purchase-expense" element={<Navigate to="/purchase-expense/bills" replace />} />
        <Route path="/purchase-expense/:tab" element={<PurchaseExpenseHub />} />

        {/* Legacy redirects */}
        <Route path="/purchases" element={<Navigate to="/purchase-expense/orders" replace />} />
        <Route path="/purchases/new" element={<Navigate to="/purchase-expense/orders" replace />} />
        <Route path="/purchases/:id/receive" element={<RoleGate allowed={['admin', 'manager']}><GRNScreen /></RoleGate>} />
        <Route path="/expenses" element={<Navigate to="/purchase-expense/expenses" replace />} />
        {/* Reports & Accounting */}
        <Route path="/reports" element={<RoleGate allowed={['admin', 'manager']}><ModuleGate featureKey="basic_reports" featureLabel="Business Reports"><ReportsHome /></ModuleGate></RoleGate>} />
        <Route path="/accounting" element={<RoleGate allowed={['admin', 'manager']}><AccountingDashboard /></RoleGate>} />
        <Route path="/cash-bank" element={<RoleGate allowed={['admin', 'manager']}><CashBankPage /></RoleGate>} />
        <Route path="/gst-filing" element={<RoleGate allowed={['admin']}><ModuleGate featureKey="gst_filing" featureLabel="GST Filing"><GSTDashboard /></ModuleGate></RoleGate>} />

        {/* HR & Attendance */}
        <Route path="/attendance" element={<ModuleGate featureKey="hr" featureLabel="HR & Attendance"><AttendancePage /></ModuleGate>} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/hr/employees" element={<RoleGate allowed={['admin', 'manager']}><ModuleGate featureKey="hr" featureLabel="HR & Employees"><EmployeeListPage /></ModuleGate></RoleGate>} />
        <Route path="/hr/employees/:userId" element={<RoleGate allowed={['admin', 'manager']}><ModuleGate featureKey="hr" featureLabel="HR & Employees"><EmployeeDetailPage /></ModuleGate></RoleGate>} />

        {/* Job Work */}
        <Route path="/job-work" element={<RoleGate allowed={['admin', 'manager']}><ModuleGate featureKey="job_work" featureLabel="Job Work Challans"><JobWorkChallanList /></ModuleGate></RoleGate>} />
        <Route path="/job-work/new" element={<RoleGate allowed={['admin', 'manager']}><ModuleGate featureKey="job_work" featureLabel="Job Work Challans"><JobWorkChallanForm /></ModuleGate></RoleGate>} />
        <Route path="/job-work/:id" element={<RoleGate allowed={['admin', 'manager']}><ModuleGate featureKey="job_work" featureLabel="Job Work Challans"><JobWorkChallanDetail /></ModuleGate></RoleGate>} />

        {/* Global Config */}
        <Route path="/settings" element={<RoleGate allowed={['admin']}><Settings /></RoleGate>} />

      </Route>

      <Route path="/onboarding" element={<OnboardingEntry />} />

      {/* ── Free Trial signup redirects into unified registration ── */}
      <Route path="/trial" element={<Navigate to="/register?intent=trial" replace />} />

      {/* ── Registrant / License routes ─────────────────────── */}
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/login" element={<Navigate to="/login" replace />} />
      <Route path="/register/verify" element={<VerifyEmailPage />} />
      <Route path="/register/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/register/reset-password" element={<ResetPasswordPage />} />
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

      <Route path="/pos-scan" element={<MobileScannerScreen />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
