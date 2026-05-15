import { useState, useEffect, Suspense, useRef, type Dispatch, type SetStateAction } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { RouteErrorBoundary } from '@/components/shared/RouteErrorBoundary';
import NavbarQuickAdd from '@/components/shared/NavbarQuickAdd';
import TrialBanner from '@/components/shared/TrialBanner';
import { useAuthStore } from '@/store/authStore';
import {
  LayoutDashboard, ShoppingBag, FileText, Receipt,
  Warehouse, BarChart3, Cloud, UserCheck, Barcode,
  Settings, LogOut, Menu, X, Search, Bell, ClipboardList, Package,
  Wrench, Users, ArrowDownLeft, RotateCcw, Truck, ArrowUpRight,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command } from 'cmdk';
import { getInitials, cn } from '@/lib/utils';
import axios from 'axios';
import api, { getApiBaseURL } from '@/lib/api';
import { launchRegistrantCompany } from '@/lib/registrantCompanyLaunch';
import { normalizeRole } from '@/lib/roles';
import toast from 'react-hot-toast';

const SIDEBAR_COLLAPSED_KEY = 'erp_sidebar_collapsed';
const NAV_GROUP_VISIBLE_COUNT = 2;

type OwnedCompanyLicense = {
  id: string;
  company_id: string | null;
  company_name: string | null;
  tier_display_name: string;
  status: 'pending' | 'active' | 'trial' | 'expired' | 'revoked';
};

const navGroups = [
  {
     label: 'OVERVIEW',
     items: [ { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' } ]
  },
  {
     label: 'INVENTORY',
     items: [
        { to: '/items', icon: Package, label: 'Items & Materials' },
        { to: '/inventory', icon: Warehouse, label: 'Stock & Godowns' },
     ]
  },
  {
     label: 'BARCODE',
     items: [
        { to: '/barcode/generate', icon: Barcode, label: 'Generate Barcode' },
     ]
  },
  {
     label: 'JOB WORK',
     items: [
        { to: '/job-work', icon: Wrench, label: 'Job Work Challans' },
     ]
  },
  {
     label: 'PARTIES',
     items: [
        { to: '/parties', icon: Users, label: 'Parties' },
     ]
  },
  {
     label: 'SALES',
     items: [
        { to: '/sales-hub/invoices',   icon: FileText,      label: 'Sale Invoices' },
        { to: '/sales-hub/quotations', icon: ClipboardList, label: 'Estimate / Quotation' },
        { to: '/sales-hub/orders',     icon: ShoppingBag,   label: 'Sale Orders' },
        { to: '/sales-hub/challans',   icon: Truck,         label: 'Delivery Challan' },
        { to: '/sales-hub/payment-in', icon: ArrowUpRight,  label: 'Payment-In' },
        { to: '/sales-hub/returns',    icon: RotateCcw,     label: 'Sale Return' },
        { to: '/billing',             icon: Receipt,        label: 'POS Billing' },
     ]
  },
  {
     label: 'PURCHASE & EXPENSE',
     items: [
        { to: '/purchase-expense/bills', icon: FileText, label: 'Purchase Bills' },
        { to: '/purchase-expense/orders', icon: ClipboardList, label: 'Purchase Orders' },
        { to: '/purchase-expense/payment-out', icon: ArrowDownLeft, label: 'Payment-Out' },
        { to: '/purchase-expense/expenses', icon: Receipt, label: 'Expenses' },
        { to: '/purchase-expense/returns', icon: RotateCcw, label: 'Purchase Return' },
     ]
  },
  {
     label: 'FINANCE',
     items: [
        { to: '/accounting', icon: Receipt, label: 'Cash & Bank' },
        { to: '/reports', icon: BarChart3, label: 'Business Reports' },
     ]
  },
  {
     label: 'COMPLIANCE',
     items: [ { to: '/gst-filing', icon: Cloud, label: 'GST Returns' } ]
  },
  {
     label: 'PEOPLE',
     items: [
        { to: '/attendance', icon: UserCheck, label: 'Attendance & HR' },
     ]
  },
  {
     label: 'SYSTEM',
     items: [ { to: '/settings', icon: Settings, label: 'Settings' } ]
  }
];

type SidebarNavProps = {
  collapsed: boolean;
  pathname: string;
  groups: typeof navGroups;
  navGroupExpanded: Record<string, boolean>;
  setNavGroupExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  onNavLinkClick: () => void;
};

/** Module-level component so React keeps the same type between renders — preserves scroll in the nav list. */
function SidebarNavigation({
  collapsed,
  pathname,
  groups,
  navGroupExpanded,
  setNavGroupExpanded,
  onNavLinkClick,
}: SidebarNavProps) {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 custom-scrollbar">
      {groups.map((group, idx) => {
        const groupKey = group.label;
        const needsMoreToggle = group.items.length > NAV_GROUP_VISIBLE_COUNT;
        const overflowHasActive =
          needsMoreToggle &&
          group.items.slice(NAV_GROUP_VISIBLE_COUNT).some((item) => pathname.startsWith(item.to));
        const userExpanded = navGroupExpanded[groupKey] === true;
        const showAllItems = !needsMoreToggle || userExpanded || overflowHasActive;
        const itemsToRender = showAllItems ? group.items : group.items.slice(0, NAV_GROUP_VISIBLE_COUNT);
        const overflowCount = group.items.length - NAV_GROUP_VISIBLE_COUNT;

        return (
          <div
            key={idx}
            className={cn(
              'mb-6',
              collapsed ? 'px-2' : 'px-4',
              collapsed && idx > 0 && 'pt-4 mt-1 border-t border-white/10',
            )}
          >
            {!collapsed && (
              <h3 className="text-[10px] font-bold text-white/40 tracking-widest uppercase mb-2 ml-2">{group.label}</h3>
            )}
            <div className="space-y-1">
              {itemsToRender.map((item) => {
                const active = pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onNavLinkClick}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-3 py-2 rounded-md transition-all duration-200 relative overflow-hidden',
                      collapsed ? 'justify-center px-2' : 'px-3',
                      active
                        ? 'bg-white/15 text-white shadow-inner font-medium'
                        : 'text-white/70 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    {active && (
                      <span
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 w-1 rounded-r-md bg-white',
                          collapsed ? 'left-1 h-6' : 'left-0 h-5',
                        )}
                        aria-hidden
                      />
                    )}
                    <item.icon className={cn('w-[18px] h-[18px] shrink-0', collapsed && 'mx-auto')} />
                    {!collapsed && <span className="text-sm truncate">{item.label}</span>}
                  </Link>
                );
              })}

              {needsMoreToggle && !showAllItems && (
                <button
                  type="button"
                  onClick={() => setNavGroupExpanded((prev) => ({ ...prev, [groupKey]: true }))}
                  className={cn(
                    'flex w-full items-center gap-2 py-2 rounded-md text-left transition-colors relative overflow-hidden',
                    'text-violet-200/90 hover:text-white hover:bg-white/10',
                    collapsed ? 'justify-center px-2' : 'px-3',
                  )}
                  title={collapsed ? `${overflowCount} more in ${group.label}` : undefined}
                  aria-expanded={false}
                >
                  <ChevronDown className="w-[18px] h-[18px] shrink-0 opacity-90" aria-hidden />
                  {!collapsed && (
                    <span className="text-xs font-medium truncate">
                      {overflowCount} more in {group.label}
                    </span>
                  )}
                </button>
              )}

              {needsMoreToggle && showAllItems && !overflowHasActive && (
                <button
                  type="button"
                  onClick={() =>
                    setNavGroupExpanded((prev) => {
                      const next = { ...prev };
                      delete next[groupKey];
                      return next;
                    })
                  }
                  className={cn(
                    'flex w-full items-center gap-2 py-2 rounded-md text-left transition-colors',
                    'text-violet-200/80 hover:text-white hover:bg-white/10',
                    collapsed ? 'justify-center px-2' : 'px-3',
                  )}
                  title={collapsed ? 'Show fewer links' : undefined}
                  aria-expanded
                >
                  <ChevronUp className="w-[18px] h-[18px] shrink-0 opacity-90" aria-hidden />
                  {!collapsed && <span className="text-xs font-medium">Show less</span>}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AppLayout() {
  const { user, logout, license, setLicense } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const actualRole = normalizeRole(user?.role);
  const visibleNavGroups = navGroups.filter((group) => {
    if (actualRole === 'super_admin') return true;
    if (actualRole === 'staff') return group.label === 'PEOPLE';
    if (actualRole === 'manager') return group.label !== 'SYSTEM' && group.label !== 'COMPLIANCE';
    return true;
  });

  // Fetch license info from /auth/me once on mount and populate store
  useEffect(() => {
    api.get('/auth/me').then((res) => {
      const data = res.data?.data ?? res.data;
      if (data?.license !== undefined) {
        setLicense(data.license);
      }
    }).catch(() => { /* non-blocking — license info is supplemental */ });
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [ownedCompanies, setOwnedCompanies] = useState<OwnedCompanyLicense[]>([]);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [switchingLicenseId, setSwitchingLicenseId] = useState<string | null>(null);
  const companyMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') {
        setSidebarCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const registrantToken = localStorage.getItem('bizflow_registrant_token');
    if (!registrantToken) {
      setOwnedCompanies([]);
      return;
    }

    let active = true;
    axios.get(`${getApiBaseURL()}/register/me`, {
      headers: {
        Authorization: `Bearer ${registrantToken}`,
      },
    })
      .then((res) => {
        if (!active) return;
        const licenses = Array.isArray(res.data?.data?.licenses) ? res.data.data.licenses : [];
        setOwnedCompanies(
          licenses.filter((entry: OwnedCompanyLicense) => entry.company_id && (entry.status === 'active' || entry.status === 'trial'))
        );
      })
      .catch(() => {
        if (active) setOwnedCompanies([]);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!companyMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (companyMenuRef.current && !companyMenuRef.current.contains(event.target as Node)) {
        setCompanyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [companyMenuOpen]);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  };

  const currentOwnedCompany = ownedCompanies.find((entry) => entry.company_id === user?.companyId);

  const handleCompanySwitch = async (licenseId: string) => {
    try {
      setSwitchingLicenseId(licenseId);
      setCompanyMenuOpen(false);
      await launchRegistrantCompany(licenseId);
      window.location.assign('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Unable to switch company');
      setSwitchingLicenseId(null);
    }
  };
  /** Sidebar nav: groups with more than NAV_GROUP_VISIBLE_COUNT links start collapsed until expanded (or active route is in overflow). */
  const [navGroupExpanded, setNavGroupExpanded] = useState<Record<string, boolean>>({});
  const [cmdOpen, setCmdOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHits, setSearchHits] = useState<{
    invoices: { id: string; invoice_number: string; invoice_date?: string }[];
    parties: { id: string; name: string; gstin?: string | null }[];
    items: { id: string; name: string; sku?: string }[];
  } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const seg = location.pathname.split('/').filter(Boolean)[0] || 'home';
    const label = seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');
    document.title = `${label} — Microtechnique Accounts`;
  }, [location.pathname]);

  // Command palette toggle hook
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((open) => !open);
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  useEffect(() => {
    if (!cmdOpen) {
      setSearchQ('');
      setSearchHits(null);
      return;
    }
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchHits(null);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await api.get('/search', { params: { q, limit: 8 } });
        const d = res.data?.data ?? res.data;
        setSearchHits({
          invoices: d?.invoices ?? [],
          parties: d?.parties ?? [],
          items: d?.items ?? [],
        });
      } catch {
        setSearchHits({ invoices: [], parties: [], items: [] });
      } finally {
        setSearchLoading(false);
      }
    }, 280);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQ, cmdOpen]);

  return (
    <div className="flex h-screen bg-[#F7F7F5]">
      {/* CMD+K Palette Modal Overlay */}
      {cmdOpen && (
         <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[10vh] animate-in fade-in duration-200 p-4" onClick={() => setCmdOpen(false)}>
            <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
               <Command shouldFilter={false} loop className="w-full">
                  <div className="flex items-center border-b px-4 py-3">
                     <Search className="w-5 h-5 text-slate-400 mr-2" />
                     <Command.Input
                       value={searchQ}
                       onValueChange={setSearchQ}
                       placeholder="Type 2+ characters to search invoices, parties, items…"
                       className="flex-1 bg-transparent border-none outline-none text-lg placeholder:text-slate-400"
                     />
                  </div>
                  <Command.List className="max-h-[350px] overflow-y-auto p-2">
                     {searchQ.trim().length > 0 && searchQ.trim().length < 2 && (
                       <div className="p-4 text-center text-slate-500 text-sm">Type at least two characters to search.</div>
                     )}
                     {searchQ.trim().length >= 2 && !searchLoading && searchHits && !searchHits.invoices.length && !searchHits.parties.length && !searchHits.items.length && (
                       <div className="p-4 text-center text-slate-500 text-sm">No matches.</div>
                     )}
                     {searchLoading && <div className="p-4 text-center text-slate-500 text-sm">Searching…</div>}

                     {searchHits && (searchHits.invoices.length > 0 || searchHits.parties.length > 0 || searchHits.items.length > 0) && (
                       <>
                         {searchHits.invoices.length > 0 && (
                           <Command.Group heading={<div className="text-xs font-semibold text-slate-400 px-2 my-2 uppercase tracking-tight">Invoices</div>}>
                             {searchHits.invoices.map((inv) => (
                               <Command.Item
                                 key={inv.id}
                                 value={`inv-${inv.id}`}
                                 onSelect={() => {
                                   setCmdOpen(false);
                                   navigate(`/sales/${inv.id}`);
                                 }}
                                 className="flex flex-col gap-0.5 p-3 hover:bg-indigo-50 rounded-md cursor-pointer text-slate-700"
                               >
                                 <span className="font-medium">{inv.invoice_number}</span>
                                 <span className="text-xs text-slate-500">{inv.invoice_date}</span>
                               </Command.Item>
                             ))}
                           </Command.Group>
                         )}
                         {searchHits.parties.length > 0 && (
                           <Command.Group heading={<div className="text-xs font-semibold text-slate-400 px-2 my-2 uppercase tracking-tight">Parties</div>}>
                             {searchHits.parties.map((p) => (
                               <Command.Item
                                 key={p.id}
                                 value={`party-${p.id}`}
                                 onSelect={() => {
                                   setCmdOpen(false);
                                   navigate(`/parties/${p.id}`);
                                 }}
                                 className="flex flex-col gap-0.5 p-3 hover:bg-indigo-50 rounded-md cursor-pointer text-slate-700"
                               >
                                 <span className="font-medium">{p.name}</span>
                                 {p.gstin ? <span className="text-xs font-mono text-slate-500">{p.gstin}</span> : null}
                               </Command.Item>
                             ))}
                           </Command.Group>
                         )}
                         {searchHits.items.length > 0 && (
                           <Command.Group heading={<div className="text-xs font-semibold text-slate-400 px-2 my-2 uppercase tracking-tight">Items</div>}>
                             {searchHits.items.map((it) => (
                               <Command.Item
                                 key={it.id}
                                 value={`item-${it.id}`}
                                 onSelect={() => {
                                   setCmdOpen(false);
                                   navigate(`/items/${it.id}`);
                                 }}
                                 className="flex flex-col gap-0.5 p-3 hover:bg-indigo-50 rounded-md cursor-pointer text-slate-700"
                               >
                                 <span className="font-medium">{it.name}</span>
                                 {it.sku ? <span className="text-xs text-slate-500">{it.sku}</span> : null}
                               </Command.Item>
                             ))}
                           </Command.Group>
                         )}
                       </>
                     )}

                     <Command.Group heading={<div className="text-xs font-semibold text-slate-400 px-2 my-2 uppercase tracking-tight">Quick Actions</div>}>
                        <Command.Item onSelect={() => {setCmdOpen(false); navigate('/billing')}} className="flex items-center gap-2 p-3 hover:bg-indigo-50 hover:text-indigo-700 rounded-md cursor-pointer text-slate-700">
                           <ShoppingBag className="w-4 h-4"/> New POS Bill
                        </Command.Item>
                        <Command.Item onSelect={() => {setCmdOpen(false); navigate('/sales/new')}} className="flex items-center gap-2 p-3 hover:bg-indigo-50 hover:text-indigo-700 rounded-md cursor-pointer text-slate-700">
                           <FileText className="w-4 h-4"/> Create B2B Invoice
                        </Command.Item>
                        <Command.Item onSelect={() => {setCmdOpen(false); navigate('/quotations/new')}} className="flex items-center gap-2 p-3 hover:bg-indigo-50 hover:text-indigo-700 rounded-md cursor-pointer text-slate-700">
                           <ClipboardList className="w-4 h-4"/> New quotation
                        </Command.Item>
                        <Command.Item onSelect={() => {setCmdOpen(false); navigate('/items')}} className="flex items-center gap-2 p-3 hover:bg-indigo-50 hover:text-indigo-700 rounded-md cursor-pointer text-slate-700">
                           <Package className="w-4 h-4"/> Open Item Center
                        </Command.Item>
                        <Command.Item onSelect={() => {setCmdOpen(false); navigate('/attendance')}} className="flex items-center gap-2 p-3 hover:bg-indigo-50 hover:text-indigo-700 rounded-md cursor-pointer text-slate-700">
                           <UserCheck className="w-4 h-4"/> Log Attendance Punch
                        </Command.Item>
                     </Command.Group>
                  </Command.List>
               </Command>
               <div className="bg-slate-50 border-t p-3 text-xs text-slate-400 flex items-center justify-between">
                  <span>Use <kbd className="bg-white border rounded px-1.5 shadow-sm text-slate-600">↑↓</kbd> to navigate</span>
                  <span><kbd className="bg-white border rounded px-1.5 shadow-sm text-slate-600">esc</kbd> to close</span>
               </div>
            </div>
         </div>
      )}

      {/* SIDEBAR (Desktop) */}
      <aside
        id="app-sidebar"
        className={cn(
          'hidden md:flex flex-col flex-shrink-0 bg-[#1E1B4B] shadow-xl z-20 overflow-hidden border-r border-black/20 transition-[width] duration-200 ease-out',
          sidebarCollapsed ? 'w-[72px]' : 'w-[248px]',
        )}
      >
        <div
          className={cn(
            'flex flex-col justify-center border-b border-white/10 shrink-0 select-none min-h-[4.5rem] py-3',
            sidebarCollapsed ? 'items-center px-2' : 'px-4',
          )}
        >
           <div className={cn('flex gap-2.5', sidebarCollapsed ? 'flex-col items-center gap-1' : 'items-start')}>
             <img src="/logo-microtechnique.svg" alt="Microtechnique" className="w-16 h-16 shrink-0 drop-shadow" />
             {!sidebarCollapsed && (
               <div className="min-w-0 flex-1 leading-tight">
                 <p className="text-[12px] font-semibold text-white">
                   <span className="block">Microtechnique</span>
                   <span className="block">Accounts</span>
                 </p>
                 <p className="text-[11px] text-violet-200/95 mt-1 truncate">
                   {currentOwnedCompany?.company_name || user?.companyId ? 'Current company' : 'Workspace'}
                 </p>
                 {currentOwnedCompany?.company_name && (
                   <p className="text-[11px] text-white/85 truncate mt-0.5">{currentOwnedCompany.company_name}</p>
                 )}
                 {user && (
                   <span className="mt-1.5 block text-[10px] text-white/50 tracking-wide uppercase truncate">
                     G{(user as any)?.godown_id || 1} • {user.role}
                   </span>
                 )}
                 {ownedCompanies.length > 1 && (
                   <div ref={companyMenuRef} className="relative mt-2">
                     <button
                       type="button"
                       onClick={() => setCompanyMenuOpen((open) => !open)}
                       className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-left text-[11px] text-white/90 hover:bg-white/10 transition-colors"
                     >
                       <span className="truncate">
                         {switchingLicenseId ? 'Switching company…' : `${ownedCompanies.length} companies`}
                       </span>
                       <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', companyMenuOpen && 'rotate-180')} />
                     </button>
                     {companyMenuOpen && (
                       <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-lg border border-white/10 bg-[#24195a] p-1.5 shadow-2xl backdrop-blur-xl">
                         {ownedCompanies.map((entry) => {
                           const isCurrent = entry.company_id === user?.companyId;
                           return (
                             <button
                               key={entry.id}
                               type="button"
                               onClick={() => !isCurrent && handleCompanySwitch(entry.id)}
                               disabled={switchingLicenseId === entry.id || isCurrent}
                               className={cn(
                                 'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors',
                                 isCurrent ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white',
                                 switchingLicenseId === entry.id && 'opacity-60 cursor-not-allowed'
                               )}
                             >
                               <span className="min-w-0">
                                 <span className="block truncate text-[11px] font-medium">{entry.company_name}</span>
                                 <span className="block truncate text-[10px] text-white/45">{entry.tier_display_name}</span>
                               </span>
                               <span className="shrink-0 text-[10px] uppercase tracking-wide text-violet-200/80">
                                 {isCurrent ? 'Current' : 'Open'}
                               </span>
                             </button>
                           );
                         })}
                       </div>
                     )}
                   </div>
                 )}
               </div>
             )}
           </div>
        </div>

        <SidebarNavigation
          collapsed={sidebarCollapsed}
          pathname={location.pathname}
          groups={visibleNavGroups}
          navGroupExpanded={navGroupExpanded}
          setNavGroupExpanded={setNavGroupExpanded}
          onNavLinkClick={() => setMobileOpen(false)}
        />

        {/* License / Trial badge */}
        {license && (
          <div
            title={
              sidebarCollapsed
                ? `${license.status === 'trial' ? 'Free trial' : license.tier_display_name} — ${license.used_users}/${license.max_users} users`
                : undefined
            }
            className={cn(
              'mb-2 rounded-lg border shrink-0',
              sidebarCollapsed ? 'mx-2 px-2 py-2 flex flex-col items-center gap-1' : 'mx-3 px-3 py-2',
              license.status === 'trial' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-white/5 border-white/10',
            )}
          >
            {!sidebarCollapsed ? (
              <>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${license.status === 'trial' ? 'text-amber-300' : 'text-violet-300'}`}>
                    {license.status === 'trial' ? 'Free Trial' : `${license.tier_display_name} Plan`}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      license.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : license.status === 'trial'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-red-500/20 text-red-300'
                    }`}
                  >
                    {license.status === 'trial' ? `${license.trial_days_remaining ?? 0}d left` : license.status}
                  </span>
                </div>
                <div className="mt-1.5">
                  <div className="flex justify-between text-[10px] text-white/40 mb-1">
                    <span>Users</span>
                    <span>
                      {license.used_users}/{license.max_users}
                    </span>
                  </div>
                  <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${license.status === 'trial' ? 'bg-amber-400' : 'bg-violet-400'}`}
                      style={{ width: `${Math.min((license.used_users / license.max_users) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div
                className={cn(
                  'w-2.5 h-2.5 rounded-full',
                  license.status === 'trial' ? 'bg-amber-400' : license.status === 'active' ? 'bg-emerald-400' : 'bg-red-400',
                )}
                aria-hidden
              />
            )}
          </div>
        )}

        <div
          className={cn(
            'border-t border-white/10 flex shrink-0 bg-black/20',
            sidebarCollapsed ? 'flex-col items-center gap-2 py-3 px-2' : 'p-4 flex-row items-center gap-3',
          )}
        >
           <button
             type="button"
             onClick={() => navigate('/profile')}
             className="w-9 h-9 rounded-full bg-indigo-500 flex flex-shrink-0 items-center justify-center text-white font-bold shadow-md ring-2 ring-indigo-400 overflow-hidden"
             aria-label="Open profile"
             title={sidebarCollapsed ? user?.name : undefined}
           >
             {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : getInitials(user?.name || '?')}
           </button>
           {!sidebarCollapsed && (
             <div className="flex-1 min-w-0">
               <p className="text-sm font-medium text-white truncate">{user?.name}</p>
               <p className="text-[10px] text-white/60 truncate">{user?.email}</p>
             </div>
           )}
           <Button
             variant="ghost"
             size="icon"
             className="text-white/60 hover:text-white shrink-0"
             onClick={logout}
             title="Log out"
           >
             <LogOut className="w-4 h-4" />
           </Button>
        </div>
      </aside>

      {/* MOBILE DRAWER */}
      {mobileOpen && (
         <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="fixed inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
            <div className="w-[260px] bg-[#1E1B4B] h-full shadow-2xl relative flex flex-col pt-4">
               <Button variant="ghost" className="absolute top-2 right-2 text-white/60" onClick={() => setMobileOpen(false)}><X className="w-5 h-5"/></Button>
               <div className="px-6 mb-4 flex items-start gap-2.5">
                 <img src="/logo-microtechnique.svg" alt="Microtechnique" className="w-16 h-16 shrink-0 drop-shadow" />
               <div className="leading-tight min-w-0">
                 <p className="text-sm font-semibold text-white">
                   <span className="block">Microtechnique</span>
                   <span className="block">Accounts</span>
                  </p>
                   {currentOwnedCompany?.company_name && (
                     <p className="text-[11px] text-violet-200/95 mt-1 truncate">{currentOwnedCompany.company_name}</p>
                   )}
                 </div>
               </div>
               <SidebarNavigation
                 collapsed={false}
                 pathname={location.pathname}
                 groups={visibleNavGroups}
                 navGroupExpanded={navGroupExpanded}
                 setNavGroupExpanded={setNavGroupExpanded}
                 onNavLinkClick={() => setMobileOpen(false)}
               />
               <div className="p-4 bg-white/5"><Button className="w-full bg-red-500/20 text-red-100 hover:bg-red-500/40" onClick={logout}>Log Out</Button></div>
            </div>
         </div>
      )}

      {/* MAIN CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Trial period banner — sticks above the header */}
        <TrialBanner />

        <header className="h-[56px] bg-white border-b flex items-center justify-between px-4 sm:px-5 sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
             <Button variant="ghost" size="icon" className="md:hidden shrink-0" onClick={() => setMobileOpen(true)}><Menu className="w-5 h-5" /></Button>
             <Button
               type="button"
               variant="ghost"
               size="icon"
               className="hidden md:flex shrink-0 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
               onClick={toggleSidebarCollapsed}
               aria-expanded={!sidebarCollapsed}
               aria-controls="app-sidebar"
               title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
             >
               {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
             </Button>
             <div
                onClick={() => setCmdOpen(true)}
                className="hidden md:flex items-center text-sm text-slate-400 bg-slate-100 hover:bg-slate-200 transition-colors w-64 min-w-0 max-w-[min(16rem,100%)] h-9 px-3 rounded-lg border border-slate-200 cursor-pointer shadow-sm"
             >
                <Search className="w-4 h-4 mr-2" /> Quick Search...
                <kbd className="ml-auto flex items-center gap-1 font-mono text-[10px] bg-white px-1.5 py-0.5 rounded border">⌘ K</kbd>
             </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
             <NavbarQuickAdd />
             <Button variant="ghost" size="icon" className="relative text-slate-500 shrink-0">
                <Bell className="w-5 h-5" />
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white"></span>
             </Button>
             <button
               type="button"
               onClick={() => navigate('/profile')}
               className="h-9 w-9 rounded-full bg-indigo-600 text-white text-sm font-semibold overflow-hidden"
               aria-label="Open profile"
             >
               {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : getInitials(user?.name || '?')}
             </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto overflow-x-hidden bg-[#F7F7F5] relative px-4 sm:px-6 lg:px-8">
          {license?.status === 'trial' && (license.trial_days_remaining ?? 1) <= 0 ? (
            <div className="flex flex-col items-center justify-center min-h-full p-8 text-center">
              <div className="w-20 h-20 rounded-2xl bg-red-100 flex items-center justify-center mb-6">
                <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Your free trial has ended</h2>
              <p className="text-slate-500 max-w-md mb-8">
                Your 15-day trial period is over. Purchase a license to continue using Microtechnique Accounts and keep access to all your data.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="tel:+916355997080"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-semibold transition-colors"
                >
                  Call to Purchase — +91 6355 997 080
                </a>
                <a
                  href="mailto:support@microtechnique.in"
                  className="inline-flex items-center gap-2 px-6 py-3 border-2 border-violet-200 hover:border-violet-400 text-violet-700 rounded-xl font-semibold transition-colors"
                >
                  Email Sales
                </a>
              </div>
              <p className="text-xs text-slate-400 mt-6">
                Silver — ₹9,999/yr &nbsp;·&nbsp; Gold — ₹18,999/yr &nbsp;·&nbsp; Diamond — ₹30,999/yr
              </p>
            </div>
          ) : (
            <RouteErrorBoundary>
              <Suspense fallback={<div className="px-6 py-12 text-center text-muted-foreground text-sm">Loading…</div>}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          )}
        </main>
      </div>
    </div>
  );
}
