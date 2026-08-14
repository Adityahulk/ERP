import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Clock, LogIn, LogOut, FileText, CheckCircle2, User } from 'lucide-react';
import { normalizeRole } from '@/lib/roles';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validUuid = (id?: string | null) => !!id && id !== 'null' && id !== 'undefined' && UUID_RE.test(id);

export default function AttendancePage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = normalizeRole(user?.role);
  const rawRole = String(user?.role || '').trim();
  const canManage = ['manager', 'admin', 'super_admin'].includes(role);
  const isAdmin = ['admin', 'company_admin', 'super_admin'].includes(rawRole);
  const canPunch = !isAdmin;
  const [tab, setTab] = useState(canManage ? 'team_today' : 'my_attendance');

  useEffect(() => {
    if (isAdmin && tab === 'my_leaves') {
      setTab(canManage ? 'team_today' : 'my_attendance');
    }
  }, [isAdmin, tab, canManage]);

  // Basic fetching
  const { data: myToday } = useQuery({
    queryKey: ['attendance', 'myToday'],
    queryFn: async () => (await api.get('/attendance/today')).data?.data,
    enabled: canPunch && tab === 'my_attendance',
  });
  const { data: matrix } = useQuery({
    queryKey: ['attendance', 'teamToday'],
    queryFn: async () => (await api.get('/attendance/company/today')).data?.data,
    enabled: canManage && tab === 'team_today',
  });
  const { data: balances } = useQuery({
    queryKey: ['leaves', 'balance', user?.id],
    queryFn: async () => (await api.get(`/leaves/balance/${user?.id}`)).data?.data,
    enabled: tab === 'my_leaves' && !!user?.id && !isAdmin,
  });
  const { data: leaveTypes } = useQuery({
    queryKey: ['leaves', 'types'],
    queryFn: async () => (await api.get('/leaves/types')).data?.data,
    enabled: tab === 'my_leaves' && !isAdmin,
  });
  const { data: approvals } = useQuery({
    queryKey: ['leaves', 'applications', 'pending'],
    queryFn: async () => (await api.get('/leaves/applications', { params: { status: 'pending' } })).data?.data,
    enabled: canManage && tab === 'approvals',
  });

  const mutClockIn = useMutation({
     mutationFn: async () => await api.post('/attendance/clock-in'),
     onSuccess: () => { toast.success('Clocked In!'); queryClient.invalidateQueries({ queryKey: ['attendance', 'myToday']}); queryClient.invalidateQueries({ queryKey: ['attendance', 'teamToday']}); },
     onError: (e: any) => toast.error(e.response?.data?.error || 'Clock-in failed'),
  });

  const mutClockOut = useMutation({
     mutationFn: async () => await api.post('/attendance/clock-out'),
     onSuccess: () => { toast.success('Clocked Out!'); queryClient.invalidateQueries({ queryKey: ['attendance', 'myToday']}); queryClient.invalidateQueries({ queryKey: ['attendance', 'teamToday']}); },
     onError: (e: any) => toast.error(e.response?.data?.error || 'Clock-out failed'),
  });

  const [leaveForm, setLeaveForm] = useState({ type: '', from: '', to: '', reason: '', half: false });
  const mutLeave = useMutation({
     mutationFn: async () => await api.post('/leaves/apply', { leave_type_id: leaveForm.type, from_date: leaveForm.from, to_date: leaveForm.to, reason: leaveForm.reason, half_day: leaveForm.half }),
     onSuccess: () => { toast.success('Leave applied and sent for approval.'); queryClient.invalidateQueries({ queryKey: ['leaves', 'balance', user?.id]}); queryClient.invalidateQueries({ queryKey: ['leaves', 'applications', 'pending']}); }
  });
  const mutReviewLeave = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) =>
      api.patch(`/leaves/${id}/review`, { status }),
    onSuccess: () => {
      toast.success('Leave request updated');
      queryClient.invalidateQueries({ queryKey: ['leaves', 'applications', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['leaves', 'balance'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to update leave'),
  });

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      <div className="flex justify-between items-center bg-white p-4 rounded border">
         <h1 className="text-2xl font-bold tracking-tight text-slate-800">HR & Attendance</h1>
      </div>

      <div className="flex space-x-2 border-b border-slate-200">
        {canManage && (
           <>
             <button onClick={() => setTab('team_today')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'team_today' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>Team Attendance</button>
             <button onClick={() => setTab('approvals')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'approvals' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>Leave Approvals</button>
           </>
        )}
        <button onClick={() => setTab('my_attendance')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'my_attendance' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>My Attendance</button>
        {!isAdmin && (
          <button
            type="button"
            onClick={() => setTab('my_leaves')}
            className={`py-2 px-4 border-b-2 font-medium ${tab === 'my_leaves' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}
          >
            My Leaves
          </button>
        )}
      </div>

      {tab === 'team_today' && canManage && (
         <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {matrix?.map((a:any) => (
                <Card key={a.user_id || a.id} className={`border-l-4 ${a.clock_in ? 'border-l-emerald-500' : 'border-l-slate-300'}`}>
                   <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-slate-800 text-sm leading-tight">{a.user_name}</h3>
                        {validUuid(a.user_id || a.id) && (
                          <button
                            type="button"
                            onClick={() => navigate(`/hr/employees/${a.user_id || a.id}`)}
                            className="shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
                            title="View profile"
                          >
                            <User className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <p className={`text-sm mt-1 flex items-center gap-1 ${a.clock_in ? 'text-emerald-600' : 'text-slate-500'}`}>
                        <CheckCircle2 className="w-4 h-4"/> {a.clock_in ? 'Present' : 'Not punched'}
                      </p>
                      <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                        <Clock className="w-3 h-3"/>
                        {a.clock_in ? `${new Date(a.clock_in).toLocaleTimeString()} - ${a.clock_out ? new Date(a.clock_out).toLocaleTimeString() : 'Active'}` : '—'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{a.user_role} {a.godown_name ? `• ${a.godown_name}` : ''}</p>
                      {validUuid(a.user_id || a.id) && (
                        <button
                          type="button"
                          onClick={() => navigate(`/hr/employees/${a.user_id || a.id}`)}
                          className="mt-3 w-full text-xs text-indigo-600 hover:text-indigo-800 font-medium border border-indigo-100 hover:border-indigo-300 rounded-md py-1 transition-colors"
                        >
                          Manage Profile
                        </button>
                      )}
                   </CardContent>
                </Card>
            ))}
            {(!matrix || matrix.length === 0) && <div className="text-slate-500 p-4 col-span-4">No employees found.</div>}
         </div>
      )}

      {tab === 'my_attendance' && (
         <div className="max-w-md mx-auto mt-10">
            <Card className="text-center shadow-lg border-2">
               <CardContent className="p-10 flex flex-col items-center">
                  <h2 className="text-xl font-bold mb-6 text-slate-700">Digital Punch Clock</h2>
                  {!canPunch ? (
                    <div className="bg-slate-100 text-slate-700 p-4 rounded-lg w-full">
                      Admin users are exempt from punch in/out. Use Team Attendance and Leave Approvals tabs to manage employees.
                    </div>
                  ) : myToday ? (
                     <div className="space-y-6 w-full">
                        <div className="bg-emerald-50 text-emerald-700 p-4 rounded-lg font-medium text-lg">
                           You're clocked in today!
                           <span className="block text-sm opacity-70 mt-1">Since {new Date(myToday.clock_in).toLocaleTimeString()}</span>
                        </div>
                        {myToday.clock_out ? (
                           <div className="bg-slate-100 text-slate-600 p-3 rounded">Shift Ended at {new Date(myToday.clock_out).toLocaleTimeString()}</div>
                        ) : (
                           <Button onClick={() => mutClockOut.mutate()} loading={mutClockOut.isPending} className="w-full bg-red-600 hover:bg-red-700 h-14 text-lg"><LogOut className="mr-2"/> Punch OUT</Button>
                        )}
                     </div>
                  ) : (
                     <Button onClick={() => mutClockIn.mutate()} loading={mutClockIn.isPending} className="w-full bg-indigo-600 hover:bg-indigo-700 h-14 text-lg"><LogIn className="mr-2"/> Punch IN (Start Day)</Button>
                  )}
               </CardContent>
            </Card>
         </div>
      )}

      {tab === 'my_leaves' && !isAdmin && (
         <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
               {balances?.map((b:any) => (
                  <Card key={b.id} className="bg-slate-50">
                     <CardContent className="p-4 text-center">
                        <h4 className="text-sm font-semibold uppercase text-slate-500 mb-1">{b.name}</h4>
                        <div className="text-3xl font-bold text-indigo-700">{b.available} <span className="text-lg text-slate-400 font-normal">/ {b.allocated}</span></div>
                     </CardContent>
                  </Card>
               ))}
            </div>

            <Card className="max-w-2xl">
               <div className="p-4 border-b font-semibold flex items-center gap-2"><FileText className="w-5 h-5"/> Apply New Leave</div>
               <CardContent className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="text-xs font-semibold uppercase text-slate-500 mb-1 block">From</label>
                        <Input type="date" value={leaveForm.from} onChange={e => setLeaveForm({...leaveForm, from: e.target.value})} />
                     </div>
                     <div>
                        <label className="text-xs font-semibold uppercase text-slate-500 mb-1 block">To</label>
                        <Input type="date" value={leaveForm.to} onChange={e => setLeaveForm({...leaveForm, to: e.target.value})} />
                     </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase text-slate-500 mb-1 block">Leave Type</label>
                    <select
                      className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                      value={leaveForm.type}
                      onChange={e => setLeaveForm({ ...leaveForm, type: e.target.value })}
                    >
                      <option value="">Select leave type</option>
                      {leaveTypes?.map((lt: any) => (
                        <option key={lt.id} value={lt.id}>{lt.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                     <label className="text-xs font-semibold uppercase text-slate-500 mb-1 block">Reason for absence</label>
                     <Input placeholder="Enter reason..." value={leaveForm.reason} onChange={e => setLeaveForm({...leaveForm, reason: e.target.value})} />
                  </div>
                  <label className="text-sm flex items-center gap-2">
                    <input type="checkbox" checked={leaveForm.half} onChange={e => setLeaveForm({ ...leaveForm, half: e.target.checked })} />
                    Half day
                  </label>
                  <Button
                    onClick={() => mutLeave.mutate()}
                    loading={mutLeave.isPending}
                    disabled={!leaveForm.type || !leaveForm.from || !leaveForm.to || !leaveForm.reason.trim()}
                    className="w-full"
                  >
                    Submit Application
                  </Button>
               </CardContent>
            </Card>
         </div>
      )}

      {tab === 'approvals' && canManage && (
        <Card>
          <div className="p-4 border-b font-semibold">Pending Leave Approvals</div>
          <CardContent className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {approvals?.map((lv: any) => (
                  <tr key={lv.id}>
                    <td className="px-4 py-3">{lv.user_name}</td>
                    <td className="px-4 py-3">{lv.leave_type_name || '—'}</td>
                    <td className="px-4 py-3">{new Date(lv.from_date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{new Date(lv.to_date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{lv.total_days}</td>
                    <td className="px-4 py-3 max-w-[260px] truncate" title={lv.reason}>{lv.reason}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={
                          mutReviewLeave.isPending &&
                          mutReviewLeave.variables?.id === lv.id &&
                          mutReviewLeave.variables?.status === 'rejected'
                        }
                        onClick={() => mutReviewLeave.mutate({ id: lv.id, status: 'rejected' })}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        loading={
                          mutReviewLeave.isPending &&
                          mutReviewLeave.variables?.id === lv.id &&
                          mutReviewLeave.variables?.status === 'approved'
                        }
                        onClick={() => mutReviewLeave.mutate({ id: lv.id, status: 'approved' })}
                      >
                        Approve
                      </Button>
                    </td>
                  </tr>
                ))}
                {(!approvals || approvals.length === 0) && (
                  <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={7}>No pending leave requests.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
