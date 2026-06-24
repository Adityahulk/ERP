import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Building2, FileKey2, LogOut, Shield, Cpu } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/api';
import toast from 'react-hot-toast';

const nav = [
  { to: '/superadmin', end: true, icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/superadmin/licenses', icon: FileKey2, label: 'Licenses' },
  { to: '/superadmin/companies', icon: Building2, label: 'Companies' },
  { to: '/superadmin/jobs', icon: Cpu, label: 'Background Jobs' },
];

export default function SuperAdminLayout() {
  const { logout, user } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    logout();
    toast.success('Signed out');
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-slate-100">
      <aside className="w-64 shrink-0 bg-slate-900 text-slate-200 flex flex-col border-r border-slate-800">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <img src="/logo-microtechnique.svg" alt="" className="h-20 w-auto drop-shadow" />
          </div>
          <p className="text-xs text-slate-500 mt-2 font-medium tracking-wide">Microtechnique Accounts — Super Admin</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, end, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0 opacity-80" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-600" />
            <span className="text-xs font-semibold uppercase tracking-wider text-violet-700 bg-violet-100 px-2 py-0.5 rounded">
              Super Admin
            </span>
            {user?.email && <span className="text-sm text-slate-500 truncate max-w-[200px]">{user.email}</span>}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-medium"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </header>
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
