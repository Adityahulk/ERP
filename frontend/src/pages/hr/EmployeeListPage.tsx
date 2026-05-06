import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Users, UserPlus } from 'lucide-react';
import { normalizeRole, roleLabel } from '@/lib/roles';

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin: 'bg-indigo-100 text-indigo-700',
  manager: 'bg-blue-100 text-blue-700',
  staff: 'bg-slate-100 text-slate-600',
};

export default function EmployeeListPage() {
  const navigate = useNavigate();
  const { user: me } = useAuthStore();
  const [search, setSearch] = useState('');

  const actualRole = normalizeRole(me?.role);
  const isAdmin = ['admin', 'super_admin'].includes(actualRole);
  const canManage = ['manager', 'admin', 'super_admin'].includes(actualRole);

  if (!canManage) {
    navigate(`/hr/employees/${me?.id}`, { replace: true });
    return null;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees').then((r) => r.data?.data ?? []),
  });

  const employees: any[] = data ?? [];
  const filtered = employees.filter((e) =>
    !search || e.name?.toLowerCase().includes(search.toLowerCase()) ||
    e.email?.toLowerCase().includes(search.toLowerCase()) ||
    e.employee_code?.toLowerCase().includes(search.toLowerCase()) ||
    e.designation?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-sm text-muted-foreground">{employees.length} team member{employees.length !== 1 ? 's' : ''}</p>
        </div>
        {isAdmin && (
          <Button size="sm" className="gap-1.5" onClick={() => navigate('/settings')}>
            <UserPlus className="w-4 h-4" /> Add Employee
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search employees…" className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading && (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No employees found.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {filtered.map((emp) => {
          const initials = (emp.name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
          return (
            <Card
              key={emp.user_id || emp.id}
              className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group"
              onClick={() => navigate(`/hr/employees/${emp.user_id || emp.id}`)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-11 h-11 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{emp.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{emp.designation || emp.email}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${ROLE_COLORS[normalizeRole(emp.role)] || 'bg-slate-100 text-slate-600'}`}>
                      {roleLabel(emp.role)}
                    </span>
                    {emp.user_active === false && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Inactive</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
