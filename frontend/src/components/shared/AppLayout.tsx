import { useState, useEffect, Suspense, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { RouteErrorBoundary } from '@/components/shared/RouteErrorBoundary';
import NavbarQuickAdd from '@/components/shared/NavbarQuickAdd';
import { useAuthStore } from '@/store/authStore';
import {
  LayoutDashboard, ShoppingBag, FileText, Receipt,
  Warehouse, BarChart3, Cloud, UserCheck,
  Settings, LogOut, Menu, X, Search, Bell, ClipboardList, Package,
  Factory, Truck, Tag, Wrench
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command } from 'cmdk';
import { getInitials, cn } from '@/lib/utils';
import api from '@/lib/api';

const navGroups = [
  {
     label: 'OVERVIEW',
     items: [ { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' } ]
  },
  {
     label: 'PRODUCTION',
     items: [
        { to: '/items', icon: Package, label: 'Items & Materials' },
        { to: '/production', icon: Factory, label: 'Raw Materials & Production' },
        { to: '/inventory', icon: Warehouse, label: 'Inventory & Stock' },
     ]
  },
  {
     label: 'WHOLESALE',
     items: [
        { to: '/wholesale', icon: Truck, label: 'Wholesale Orders' },
        { to: '/wholesale/pricing', icon: Tag, label: 'Pricing Tiers' },
     ]
  },
  {
     label: 'JOB WORK',
     items: [
        { to: '/job-work', icon: Wrench, label: 'Job Work Challans' },
     ]
  },
  {
     label: 'SALES & PURCHASE',
     items: [
        { to: '/sales', icon: FileText, label: 'Sales & Invoices' },
        { to: '/quotations', icon: ClipboardList, label: 'Quotations' },
        { to: '/purchases', icon: ShoppingBag, label: 'Purchase & GRN' },
        { to: '/billing', icon: ShoppingBag, label: 'POS Billing' },
     ]
  },
  {
     label: 'FINANCE',
     items: [
        { to: '/expenses', icon: Receipt, label: 'Expenses' },
        { to: '/reports', icon: BarChart3, label: 'Business Reports' },
     ]
  },
  {
     label: 'COMPLIANCE',
     items: [ { to: '/gst-filing', icon: Cloud, label: 'GST Returns' } ]
  },
  {
     label: 'PEOPLE',
     items: [ { to: '/attendance', icon: UserCheck, label: 'Attendance & HR' } ]
  },
  {
     label: 'SYSTEM',
     items: [ { to: '/settings', icon: Settings, label: 'Settings' } ]
  }
];

export default function AppLayout() {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHits, setSearchHits] = useState<{
    invoices: { id: string; invoice_number: string; invoice_date?: string }[];
    parties: { id: string; name: string; party_type?: string }[];
    items: { id: string; name: string; sku?: string }[];
  } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const seg = location.pathname.split('/').filter(Boolean)[0] || 'home';
    const label = seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');
    document.title = `${label} — BizFlow`;
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

  const NavigationList = () => (
     <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
        {navGroups.map((group, idx) => (
           <div key={idx} className="mb-6 px-4">
              <h3 className="text-[10px] font-bold text-white/40 tracking-widest uppercase mb-2 ml-2">{group.label}</h3>
              <div className="space-y-1">
                 {group.items.map(item => {
                    const active = location.pathname.startsWith(item.to);
                    return (
                       <Link key={item.to} to={item.to} onClick={() => setMobileOpen(false)}
                          className={cn(
                             "flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200",
                             active ? "bg-white/15 text-white shadow-inner font-medium relative" : "text-white/70 hover:bg-white/10 hover:text-white"
                          )}
                       >
                          {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-white rounded-r-md"></div>}
                          <item.icon className="w-[18px] h-[18px]" />
                          <span className="text-sm">{item.label}</span>
                       </Link>
                    )
                 })}
              </div>
           </div>
        ))}
     </div>
  );

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
                                   navigate('/parties');
                                 }}
                                 className="flex flex-col gap-0.5 p-3 hover:bg-indigo-50 rounded-md cursor-pointer text-slate-700"
                               >
                                 <span className="font-medium">{p.name}</span>
                                 <span className="text-xs text-slate-500 capitalize">{p.party_type || 'party'}</span>
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
      <aside className="hidden md:flex w-[220px] bg-[#1E1B4B] flex-col flex-shrink-0 shadow-xl z-20">
        <div className="h-16 flex flex-col justify-center px-6 border-b border-white/10 shrink-0 select-none">
           <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2"><span className="bg-gradient-to-br from-indigo-400 to-purple-400 w-5 h-5 rounded-sm inline-block"></span> BizFlow</h1>
           {user && <span className="text-[10px] text-white/50 tracking-wider truncate uppercase">G{(user as any)?.godown_id || 1} • {user.role}</span>}
        </div>
        
        <NavigationList />

        <div className="p-4 border-t border-white/10 flex items-center gap-3 shrink-0 bg-black/20">
           <div className="w-9 h-9 rounded-full bg-indigo-500 flex flex-shrink-0 items-center justify-center text-white font-bold shadow-md ring-2 ring-indigo-400">
             {getInitials(user?.name || '?')}
           </div>
           <div className="flex-1 min-w-0">
             <p className="text-sm font-medium text-white truncate">{user?.name}</p>
             <p className="text-[10px] text-white/60 truncate">{user?.email}</p>
           </div>
           <Button variant="ghost" size="icon" className="text-white/60 hover:text-white" onClick={logout}><LogOut className="w-4 h-4"/></Button>
        </div>
      </aside>

      {/* MOBILE DRAWER */}
      {mobileOpen && (
         <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="fixed inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
            <div className="w-[260px] bg-[#1E1B4B] h-full shadow-2xl relative flex flex-col pt-4">
               <Button variant="ghost" className="absolute top-2 right-2 text-white/60" onClick={() => setMobileOpen(false)}><X className="w-5 h-5"/></Button>
               <h1 className="text-2xl font-bold text-white px-6 mb-4">BizFlow</h1>
               <NavigationList />
               <div className="p-4 bg-white/5"><Button className="w-full bg-red-500/20 text-red-100 hover:bg-red-500/40" onClick={logout}>Log Out</Button></div>
            </div>
         </div>
      )}

      {/* MAIN CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[56px] bg-white border-b flex items-center justify-between px-4 sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
             <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}><Menu className="w-5 h-5" /></Button>
             
             <div 
                onClick={() => setCmdOpen(true)}
                className="hidden md:flex ml-2 items-center text-sm text-slate-400 bg-slate-100 hover:bg-slate-200 transition-colors w-64 h-9 px-3 rounded-lg border border-slate-200 cursor-pointer shadow-sm"
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
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-[#F7F7F5] relative">
          <RouteErrorBoundary>
            <Suspense fallback={<div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
