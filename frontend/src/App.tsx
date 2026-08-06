import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useRegistrantStore } from '@/store/registrantStore';
import { LEGACY_STORAGE_KEYS, readStorageWithLegacy, STORAGE_KEYS } from '@/lib/storageKeys';
import AppLayout from '@/components/shared/AppLayout';
import RegisterPage from '@/pages/register/RegisterPage';
import UnifiedLoginPage from '@/pages/auth/UnifiedLoginPage';
import RegisterDashboard from '@/pages/register/RegisterDashboard';
import LicenseTiersPage from '@/pages/register/LicenseTiersPage';
import LicenseDetailPage from '@/pages/register/LicenseDetailPage';
import VerifyEmailPage from '@/pages/register/VerifyEmailPage';
import ForgotPasswordPage from '@/pages/register/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/register/ResetPasswordPage';
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
import MobileScannerScreen from '@/pages/billing/MobileScannerScreen';
import ReportsHome from '@/pages/reports/ReportsHome';
import AccountingDashboard from '@/pages/accounting/AccountingDashboard';
import CashBankPage from '@/pages/accounting/CashBankPage';
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
import SuperAdminRegistrants from '@/pages/superadmin/SuperAdminRegistrants';
import { useEffect } from 'react';
import { canAccessRole, normalizeRole, type NormalizedRole } from '@/lib/roles';

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
  }, []);

  return (
    <Routes>
      <Route path="/" element={<AuthHomeRedirect />} />
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
      <Route path="/register/login" element={<Navigate to="/login?mode=licenses" replace />} />
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
  );
}
