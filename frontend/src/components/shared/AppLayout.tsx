import { useState, useEffect, Suspense, useRef, type Dispatch, type SetStateAction } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RouteErrorBoundary } from '@/components/shared/RouteErrorBoundary';
import NavbarQuickAdd from '@/components/shared/NavbarQuickAdd';
import TrialBanner from '@/components/shared/TrialBanner';
import { useAuthStore } from '@/store/authStore';
import {
  Home, ShoppingBag, FileText, Receipt,
  Warehouse, BarChart3, Cloud, UserCheck, Barcode, Camera,
  Settings, LogOut, Menu, X, Search, Bell, ClipboardList, Package, Mic,
  Wrench, Users, ArrowDownLeft, RotateCcw, Truck, ArrowUpRight, Landmark,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, MessageCircle,
  FolderTree, Ruler, Megaphone, Heart, RefreshCw, Building2, Check, Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
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

/**
 * Sidebar menu hierarchy, mapped onto this app's REAL existing
 * routes (no backend or routing changes — purely a sidebar relabel /
 * regroup). Where a requested menu entry names a screen this app doesn't
 * have a dedicated page for (e.g. "Sync, Share & Backup"), the item
 * points to the closest real, working destination rather than a dead link.
 */
const navGroups = [
  {
     label: 'HOME',
     items: [ { to: '/dashboard', icon: Home, label: 'Home' } ]
  },
  {
     label: 'PARTIES',
     items: [
        { to: '/parties', icon: Users, label: 'Party Details' },
        { to: '/parties/whatsapp-connect', icon: MessageCircle, label: 'WhatsApp Connect' },
     ]
  },
  {
     label: 'ITEMS',
     items: [
        { to: '/items', icon: Package, label: 'Item List' },
        { to: '/inventory', icon: Warehouse, label: 'Stock & Godowns' },
        { to: '/items/categories', icon: FolderTree, label: 'Categories' },
        { to: '/items/units', icon: Ruler, label: 'Units' },
        { to: '/barcode/generate', icon: Barcode, label: 'Barcode Labels' },
        { to: '/barcode/scan', icon: Camera, label: 'Scan & Update Stock' },
     ]
  },
  {
     label: 'SALE',
     items: [
        { to: '/sales-hub/invoices',   icon: FileText,      label: 'Sale Invoice' },
        { to: '/sales-hub/quotations', icon: ClipboardList, label: 'Estimate / Quotation' },
        { to: '/sales-hub/orders',     icon: ShoppingBag,   label: 'Sale Order' },
        { to: '/sales-hub/challans',   icon: Truck,         label: 'Delivery Challan' },
        { to: '/sales-hub/payment-in', icon: ArrowUpRight,  label: 'Payment In' },
        { to: '/sales-hub/returns',    icon: RotateCcw,     label: 'Sale Return' },
        { to: '/billing',             icon: Receipt,        label: 'POS Billing' },
     ]
  },
  {
     label: 'PURCHASE & EXPENSE',
     items: [
        { to: '/purchase-expense/bills', icon: FileText, label: 'Purchase Bill' },
        { to: '/purchase-expense/orders', icon: ClipboardList, label: 'Purchase Order' },
        { to: '/purchase-expense/payment-out', icon: ArrowDownLeft, label: 'Payment Out' },
        { to: '/purchase-expense/returns', icon: RotateCcw, label: 'Purchase Return' },
        { to: '/purchase-expense/expenses', icon: Receipt, label: 'Expenses' },
     ]
  },
  {
     label: 'GROW YOUR BUSINESS',
     items: [
        { to: '/parties/whatsapp-connect', icon: Megaphone, label: 'WhatsApp Campaigns' },
        { to: '/parties', icon: Heart, label: 'Customer Follow-ups' },
        { to: '/settings/integrations', icon: Link2, label: 'Integrations' },
        { to: '/settings/sync-backup', icon: RefreshCw, label: 'Sync & Backup' },
     ]
  },
  {
     label: 'CASH & BANK',
     items: [ { to: '/cash-bank', icon: Landmark, label: 'Cash & Bank' } ]
  },
  {
     label: 'ACCOUNTING',
     items: [
        { to: '/accounting', icon: Receipt, label: 'Journal & Ledger' },
        { to: '/gst-filing', icon: Cloud, label: 'GST Returns' },
     ]
  },
  {
     label: 'REPORTS',
     items: [ { to: '/reports', icon: BarChart3, label: 'Business Reports' } ]
  },
  {
     label: 'JOB WORK',
     items: [
        { to: '/job-work', icon: Wrench, label: 'Job Work Challans' },
     ]
  },
  {
     label: 'PEOPLE',
     items: [
        { to: '/attendance', icon: UserCheck, label: 'Attendance & HR' },
     ]
  },
  {
     label: 'SYNC, SHARE & BACKUP',
     items: [ { to: '/reports', icon: RefreshCw, label: 'Tally Export / Import' } ]
  },
  {
     label: 'UTILITIES',
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
    <div className="sidebar-scrollbar flex-1 overflow-y-auto overflow-x-hidden py-4 custom-scrollbar">
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
    if (actualRole === 'manager') return group.label !== 'UTILITIES';
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
  const [switchingLicenseId, setSwitchingLicenseId] = useState<string | null>(null);

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

  // Real recent activity for the header notification bell — same /notifications/logs
  // endpoint the WhatsApp Connect page uses for its activity feed.
  const { data: notifLogs } = useQuery({
    queryKey: ['header-notification-logs'],
    queryFn: () => api.get('/notifications/logs').then((r) => r.data?.data ?? []),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const recentNotifs: any[] = Array.isArray(notifLogs) ? notifLogs.slice(0, 8) : [];
  const [searchQ, setSearchQ] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHits, setSearchHits] = useState<{
    invoices: { id: string; invoice_number: string; invoice_date?: string }[];
    parties: { id: string; name: string; gstin?: string | null }[];
    items: { id: string; name: string; sku?: string }[];
  } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice Search — real Web Speech API, not a stub. Hinglish isn't a
  // distinct recognition language on any browser; in practice Hindi
  // recognition mode already transcribes common English loanwords
  // reasonably, and since the result just becomes ordinary search
  // text, code-switched speech still searches fine either way.
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'hi-IN' | 'en-IN'>('en-IN');
  const voiceRecognitionRef = useRef<any>(null);
  const voiceSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const toggleVoiceSearch = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    if (voiceListening) {
      voiceRecognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = voiceLang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as any)
        .map((r: any) => r[0]?.transcript || '')
        .join(' ');
      setSearchQ(transcript);
    };
    recognition.onerror = () => setVoiceListening(false);
    recognition.onend = () => setVoiceListening(false);

    voiceRecognitionRef.current = recognition;
    setVoiceListening(true);
    recognition.start();
  };

  useEffect(() => {
    return () => { voiceRecognitionRef.current?.stop?.(); };
  }, []);

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
                  <div className="flex items-center border-b px-4 py-3 gap-2">
                     <Search className="w-5 h-5 text-slate-400" />
                     <Command.Input
                       value={searchQ}
                       onValueChange={setSearchQ}
                       placeholder={voiceListening ? 'Listening…' : 'Type 2+ characters to search invoices, parties, items…'}
                       className="flex-1 bg-transparent border-none outline-none text-lg placeholder:text-slate-400"
                     />
                     {voiceSupported && (
                       <>
                         <button
                           type="button"
                           title={`Voice search (${voiceLang === 'hi-IN' ? 'Hindi' : 'English'}) — click to switch language`}
                           onClick={(e) => { e.stopPropagation(); setVoiceLang((l) => l === 'hi-IN' ? 'en-IN' : 'hi-IN'); }}
                           className="text-[10px] font-bold text-slate-400 hover:text-slate-600 border rounded px-1.5 py-0.5"
                         >
                           {voiceLang === 'hi-IN' ? 'हिं' : 'EN'}
                         </button>
                         <button
                           type="button"
                           title="Voice search"
                           onClick={(e) => { e.stopPropagation(); toggleVoiceSearch(); }}
                           className={`rounded-full p-1.5 transition-colors ${voiceListening ? 'bg-red-100 text-red-600 animate-pulse' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`}
                         >
                           <Mic className="w-4 h-4" />
                         </button>
                       </>
                     )}
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
          'hidden md:flex flex-col flex-shrink-0 bg-navy-900 shadow-xl z-20 overflow-hidden border-r border-black/30 transition-[width] duration-200 ease-out',
          sidebarCollapsed ? 'w-[72px]' : 'w-[260px]',
        )}
      >
        <div
          className={cn(
            'flex flex-col justify-center border-b border-white/10 shrink-0 select-none min-h-[4.5rem] py-3',
            sidebarCollapsed ? 'items-center px-2' : 'px-4',
          )}
        >
           <div className={cn('flex gap-2.5', sidebarCollapsed ? 'flex-col items-center gap-1' : 'items-start')}>
             <img src="/logo-microtechnique.svg" alt="Microtechnique" className="w-12 h-12 shrink-0 drop-shadow" />
             {!sidebarCollapsed && (
               <div className="min-w-0 flex-1 leading-tight">
                 <p className="text-[12px] font-semibold text-white">
                   <span className="block">Microtechnique</span>
                   <span className="block">Accounts</span>
                 </p>
                 {currentOwnedCompany?.company_name && (
                   <p className="text-[11px] text-white/70 truncate mt-1">{currentOwnedCompany.company_name}</p>
                 )}
                 {user && (
                   <span className="mt-1 block text-[10px] text-white/40 tracking-wide uppercase truncate">
                     G{(user as any)?.godown_id || 1} • {user.role}
                   </span>
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
            <div className="w-[260px] bg-navy-900 h-full shadow-2xl relative flex flex-col pt-4">
               <Button variant="ghost" className="absolute top-2 right-2 text-white/60" onClick={() => setMobileOpen(false)}><X className="w-5 h-5"/></Button>
               <div className="px-6 mb-4 flex items-start gap-2.5">
                 <img src="/logo-microtechnique.svg" alt="Microtechnique" className="w-16 h-16 shrink-0 drop-shadow" />
               <div className="leading-tight min-w-0">
                 <p className="text-sm font-semibold text-white">
                   <span className="block">Microtechnique</span>
                   <span className="block">Accounts</span>
                  </p>
                   {currentOwnedCompany?.company_name && (
                     <p className="text-[11px] text-white/70 mt-1 truncate">{currentOwnedCompany.company_name}</p>
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

        <header className="h-[60px] bg-white border-b flex items-center justify-between px-4 sm:px-5 sticky top-0 z-10 shrink-0 gap-3">
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
                className="hidden md:flex items-center text-sm text-slate-400 bg-slate-100 hover:bg-slate-200 transition-colors w-72 min-w-0 max-w-[min(18rem,100%)] h-9 px-3 rounded-lg border border-slate-200 cursor-pointer shadow-sm"
             >
                <Search className="w-4 h-4 mr-2" /> Search invoices, parties, items…
                <kbd className="ml-auto flex items-center gap-1 font-mono text-[10px] bg-white px-1.5 py-0.5 rounded border">⌘ K</kbd>
             </div>

             {/* Company switcher — surfaced here so it's reachable from any screen */}
             <DropdownMenu>
               <DropdownMenuTrigger asChild>
                 <button
                   type="button"
                   className="hidden lg:flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-sm text-slate-700 max-w-[200px]"
                   title="Switch company"
                 >
                   <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                   <span className="truncate font-medium">
                     {switchingLicenseId ? 'Switching…' : currentOwnedCompany?.company_name || 'Workspace'}
                   </span>
                   <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                 </button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="start" className="w-64">
                 <DropdownMenuLabel>Your companies</DropdownMenuLabel>
                 <DropdownMenuSeparator />
                 {ownedCompanies.length === 0 && (
                   <div className="px-2 py-3 text-xs text-muted-foreground">No other companies linked to this account.</div>
                 )}
                 {ownedCompanies.map((entry) => {
                   const isCurrent = entry.company_id === user?.companyId;
                   return (
                     <DropdownMenuItem
                       key={entry.id}
                       disabled={switchingLicenseId === entry.id || isCurrent}
                       onClick={() => !isCurrent && handleCompanySwitch(entry.id)}
                       className="flex items-center justify-between gap-2"
                     >
                       <span className="min-w-0">
                         <span className="block truncate text-sm">{entry.company_name}</span>
                         <span className="block truncate text-[11px] text-muted-foreground">{entry.tier_display_name}</span>
                       </span>
                       {isCurrent && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                     </DropdownMenuItem>
                   );
                 })}
               </DropdownMenuContent>
             </DropdownMenu>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
             <NavbarQuickAdd />

             {/* Notification bell — backed by the real /notifications/logs endpoint */}
             <DropdownMenu>
               <DropdownMenuTrigger asChild>
                 <Button variant="ghost" size="icon" className="relative text-slate-500 shrink-0">
                    <Bell className="w-5 h-5" />
                    {recentNotifs.length > 0 && (
                      <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white"></span>
                    )}
                 </Button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="w-80 p-0">
                 <div className="px-3 py-2.5 border-b">
                   <p className="text-sm font-semibold text-slate-800">Notifications</p>
                   <p className="text-[11px] text-muted-foreground">Recent WhatsApp, SMS &amp; system activity</p>
                 </div>
                 <div className="max-h-80 overflow-y-auto">
                   {recentNotifs.length === 0 && (
                     <div className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing yet — you're all caught up.</div>
                   )}
                   {recentNotifs.map((n: any) => (
                     <div key={n.id} className="px-3 py-2.5 border-b last:border-0 hover:bg-slate-50 text-sm">
                       <div className="flex items-center justify-between gap-2">
                         <span className="font-medium text-slate-700 capitalize">{n.channel || 'system'}</span>
                         <span className="text-[10px] text-muted-foreground shrink-0">
                           {n.created_at ? new Date(n.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                         </span>
                       </div>
                       <p className="text-xs text-muted-foreground truncate mt-0.5">{n.recipient || n.template_type || '—'}</p>
                     </div>
                   ))}
                 </div>
               </DropdownMenuContent>
             </DropdownMenu>

             <DropdownMenu>
               <DropdownMenuTrigger asChild>
                 <button type="button" className="shrink-0" aria-label="Open profile menu">
                   <Avatar className="h-9 w-9 ring-2 ring-transparent hover:ring-slate-200 transition-shadow">
                     {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                     <AvatarFallback className="bg-indigo-600 text-white">{getInitials(user?.name || '?')}</AvatarFallback>
                   </Avatar>
                 </button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="w-56">
                 <DropdownMenuLabel>
                   <p className="text-sm font-semibold text-slate-800 truncate">{user?.name}</p>
                   <p className="text-[11px] text-muted-foreground truncate font-normal">{user?.email}</p>
                 </DropdownMenuLabel>
                 <DropdownMenuSeparator />
                 <DropdownMenuItem onClick={() => navigate('/profile')}>My profile</DropdownMenuItem>
                 <DropdownMenuItem onClick={() => navigate('/settings')}>Settings</DropdownMenuItem>
                 <DropdownMenuSeparator />
                 <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600 focus:bg-red-50">
                   <LogOut className="w-4 h-4 mr-2" /> Log out
                 </DropdownMenuItem>
               </DropdownMenuContent>
             </DropdownMenu>
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
