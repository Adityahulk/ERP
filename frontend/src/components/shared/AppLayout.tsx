import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import {
  LayoutDashboard, Package, Warehouse, FileText, Users, Settings, LogOut,
  ChevronLeft, Menu, Receipt, UserCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, getInitials, stringToColor } from '@/lib/utils';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/parties', icon: UserCheck, label: 'Parties' },
  { to: '/items', icon: Package, label: 'Products' },
  { to: '/inventory', icon: Warehouse, label: 'Inventory' },
  { to: '/invoices', icon: FileText, label: 'Invoices' },
  { to: '/expenses', icon: Receipt, label: 'Expenses' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/settings', icon: Settings, label: 'Settings', disabled: true },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { user, company, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('bizflow_access_token')}` } }); } catch {}
    logout();
    navigate('/login');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-border/40 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">B</div>
        {!collapsed && <div className="flex flex-col min-w-0"><span className="font-semibold text-sm truncate">{company?.name || 'BizFlow'}</span><span className="text-[10px] text-muted-foreground truncate">{company?.gstin || ''}</span></div>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200',
              isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              item.disabled && 'opacity-40 pointer-events-none',
              collapsed && 'justify-center px-2'
            )}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-border/40 p-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0" style={{ backgroundColor: stringToColor(user?.name || '') }}>
            {getInitials(user?.name || 'U')}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-[10px] text-muted-foreground truncate capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={handleLogout} className="shrink-0 h-8 w-8">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar — mobile */}
      <aside className={cn('fixed inset-y-0 left-0 z-50 w-64 bg-card border-r transform transition-transform lg:hidden', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <SidebarContent />
      </aside>

      {/* Sidebar — desktop */}
      <aside className={cn('hidden lg:flex flex-col border-r bg-card transition-all duration-300', collapsed ? 'w-16' : 'w-60')}>
        <SidebarContent />
        <button onClick={() => setCollapsed(!collapsed)} className="absolute -right-3 top-20 w-6 h-6 rounded-full border bg-card shadow-sm flex items-center justify-center hover:bg-muted z-10">
          <ChevronLeft className={cn('w-3 h-3 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar — mobile */}
        <header className="flex lg:hidden items-center gap-3 h-14 px-4 border-b bg-card shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}><Menu className="w-5 h-5" /></Button>
          <span className="font-semibold truncate">{company?.name || 'BizFlow'}</span>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
