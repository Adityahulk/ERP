import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Clock, LogIn, LogOut, FileText, CheckCircle2 } from 'lucide-react';

export default function AttendancePage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const [tab, setTab] = useState(isManager ? 'godown_today' : 'my_attendance');

  // Basic fetching
  const { data: myToday } = useQuery({ queryKey: ['myToday'], queryFn: async () => (await api.get('/attendance/today')).data?.data, enabled: !isManager || tab === 'my_attendance' });
  const { data: matrix } = useQuery({ queryKey: ['godownToday'], queryFn: async () => (await api.get(`/attendance/godown/${(user as any)?.godown_id || 1}/today`)).data?.data, enabled: isManager && tab === 'godown_today' });
  const { data: balances } = useQuery({ queryKey: ['leaveBalances'], queryFn: async () => (await api.get(`/leaves/balance/${user?.id}`)).data?.data, enabled: tab === 'my_leaves' });

  const mutClockIn = useMutation({
     mutationFn: async () => await api.post('/attendance/clock-in'),
     onSuccess: () => { toast.success('Clocked In!'); queryClient.invalidateQueries({ queryKey: ['myToday']}); }
  });

  const mutClockOut = useMutation({
     mutationFn: async () => await api.post('/attendance/clock-out'),
     onSuccess: () => { toast.success('Clocked Out!'); queryClient.invalidateQueries({ queryKey: ['myToday']}); }
  });

  const [leaveForm, setLeaveForm] = useState({ type: 1, from: '', to: '', reason: '', half: false });
  const mutLeave = useMutation({
     mutationFn: async () => await api.post('/leaves/apply', { leave_type_id: leaveForm.type, from_date: leaveForm.from, to_date: leaveForm.to, reason: leaveForm.reason, half_day: leaveForm.half }),
     onSuccess: () => { toast.success('Leave Applied! Sent to Manager.'); queryClient.invalidateQueries({ queryKey: ['leaveBalances']}); }
  });

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      <div className="flex justify-between items-center bg-white p-4 rounded border">
         <h1 className="text-2xl font-bold tracking-tight text-slate-800">HR & Attendance</h1>
      </div>

      <div className="flex space-x-2 border-b border-slate-200">
        {isManager && (
           <>
             <button onClick={() => setTab('godown_today')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'godown_today' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>Today (Godown)</button>
             <button onClick={() => setTab('approvals')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'approvals' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>Leave Approvals</button>
           </>
        )}
        <button onClick={() => setTab('my_attendance')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'my_attendance' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>My Attendance</button>
        <button onClick={() => setTab('my_leaves')} className={`py-2 px-4 border-b-2 font-medium ${tab === 'my_leaves' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>My Leaves</button>
      </div>

      {tab === 'godown_today' && isManager && (
         <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {matrix?.map((a:any) => (
                <Card key={a.id} className="border-l-4 border-l-emerald-500">
                   <CardContent className="p-4">
                      <h3 className="font-bold text-slate-800">{a.user_name}</h3>
                      <p className="text-sm text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> Present</p>
                      <p className="text-xs text-slate-500 mt-2 flex items-center gap-1"><Clock className="w-3 h-3"/> {new Date(a.clock_in).toLocaleTimeString()} - {a.clock_out ? new Date(a.clock_out).toLocaleTimeString() : 'Active'}</p>
                   </CardContent>
                </Card>
            ))}
            {(!matrix || matrix.length === 0) && <div className="text-slate-500 p-4 col-span-4">No staff clocked in today yet.</div>}
         </div>
      )}

      {tab === 'my_attendance' && (
         <div className="max-w-md mx-auto mt-10">
            <Card className="text-center shadow-lg border-2">
               <CardContent className="p-10 flex flex-col items-center">
                  <h2 className="text-xl font-bold mb-6 text-slate-700">Digital Punch Clock</h2>
                  
                  {myToday ? (
                     <div className="space-y-6 w-full">
                        <div className="bg-emerald-50 text-emerald-700 p-4 rounded-lg font-medium text-lg">
                           You're clocked in today!
                           <span className="block text-sm opacity-70 mt-1">Since {new Date(myToday.clock_in).toLocaleTimeString()}</span>
                        </div>
                        {myToday.clock_out ? (
                           <div className="bg-slate-100 text-slate-600 p-3 rounded">Shift Ended at {new Date(myToday.clock_out).toLocaleTimeString()}</div>
                        ) : (
                           <Button onClick={() => mutClockOut.mutate()} disabled={mutClockOut.isPending} className="w-full bg-red-600 hover:bg-red-700 h-14 text-lg"><LogOut className="mr-2"/> Punch OUT</Button>
                        )}
                     </div>
                  ) : (
                     <Button onClick={() => mutClockIn.mutate()} disabled={mutClockIn.isPending} className="w-full bg-indigo-600 hover:bg-indigo-700 h-14 text-lg"><LogIn className="mr-2"/> Punch IN (Start Day)</Button>
                  )}
               </CardContent>
            </Card>
         </div>
      )}

      {tab === 'my_leaves' && (
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
                     <label className="text-xs font-semibold uppercase text-slate-500 mb-1 block">Reason for absence</label>
                     <Input placeholder="Enter reason..." value={leaveForm.reason} onChange={e => setLeaveForm({...leaveForm, reason: e.target.value})} />
                  </div>
                  <Button onClick={() => mutLeave.mutate()} disabled={mutLeave.isPending || !leaveForm.from || !leaveForm.to} className="w-full">Submit Application</Button>
               </CardContent>
            </Card>
         </div>
      )}
    </div>
  );
}
