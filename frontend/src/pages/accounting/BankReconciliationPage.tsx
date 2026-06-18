import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Link2, Sparkles, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatMoney } from '@/lib/formatters';

type SessionSummary = {
  session: Record<string, unknown>;
  statement_lines: Record<string, unknown>[];
  book_entries: Record<string, unknown>[];
  summary: Record<string, number>;
};

export default function BankReconciliationPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [selectedLineId, setSelectedLineId] = useState('');

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['company', 'bank-accounts'],
    queryFn: async () => (await api.get('/company/bank-accounts')).data?.data || [],
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['bank-recon', 'sessions', bankAccountId],
    queryFn: async () => {
      const params = bankAccountId ? { company_bank_account_id: bankAccountId } : {};
      return (await api.get('/bank-reconciliation', { params })).data?.data || [];
    },
  });

  const { data: sessionDetail, isLoading: sessionLoading } = useQuery<SessionSummary>({
    queryKey: ['bank-recon', 'session', sessionId],
    enabled: !!sessionId,
    queryFn: async () => (await api.get(`/bank-reconciliation/${sessionId}`)).data?.data,
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, string>) => api.post('/bank-reconciliation', payload),
    onSuccess: (res) => {
      const id = res.data?.data?.id;
      if (id) setSessionId(id);
      toast.success('Reconciliation session created');
      qc.invalidateQueries({ queryKey: ['bank-recon'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not create session'),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/bank-reconciliation/${sessionId}/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      toast.success(`Imported ${res.data?.data?.inserted || 0} statement lines`);
      qc.invalidateQueries({ queryKey: ['bank-recon', 'session', sessionId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Upload failed'),
  });

  const autoMatchMutation = useMutation({
    mutationFn: () => api.post(`/bank-reconciliation/${sessionId}/auto-match`),
    onSuccess: (res) => {
      toast.success(`Auto-matched ${res.data?.data?.matched || 0} lines`);
      qc.invalidateQueries({ queryKey: ['bank-recon', 'session', sessionId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Auto-match failed'),
  });

  const matchMutation = useMutation({
    mutationFn: ({ statement_line_id, payment_id }: { statement_line_id: string; payment_id: string }) =>
      api.post(`/bank-reconciliation/${sessionId}/match`, { statement_line_id, payment_id }),
    onSuccess: () => {
      toast.success('Matched');
      setSelectedLineId('');
      qc.invalidateQueries({ queryKey: ['bank-recon', 'session', sessionId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Match failed'),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.patch(`/bank-reconciliation/${sessionId}/complete`),
    onSuccess: () => {
      toast.success('Session marked reconciled');
      qc.invalidateQueries({ queryKey: ['bank-recon'] });
      qc.invalidateQueries({ queryKey: ['bank-recon', 'session', sessionId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not complete'),
  });

  const unmatchedBook = useMemo(
    () => (sessionDetail?.book_entries || []).filter((b) => b.match_status === 'unmatched'),
    [sessionDetail?.book_entries],
  );

  const startSession = () => {
    if (!bankAccountId || !statementFrom || !statementTo) {
      toast.error('Select bank account and statement date range');
      return;
    }
    createMutation.mutate({
      company_bank_account_id: bankAccountId,
      statement_from: statementFrom,
      statement_to: statementTo,
    });
  };

  return (
    <div className="h-full bg-slate-50">
      <div className="border-b bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
              <Link to="/cash-bank"><ArrowLeft className="mr-2 h-4 w-4" /> Cash & Bank</Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight">Bank Reconciliation</h1>
            <p className="text-sm text-slate-500">Upload bank CSV, match statement lines to book payments, and close the session.</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <Card>
          <CardHeader><CardTitle className="text-base">New or resume session</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-4 gap-4 items-end">
            <div>
              <Label>Bank account</Label>
              <select
                className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">Select account</option>
                {(bankAccounts as any[]).map((b) => (
                  <option key={b.id} value={b.id}>{b.bank_name || b.account_name} — {b.account_number || '—'}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Statement from</Label>
              <Input type="date" value={statementFrom} onChange={(e) => setStatementFrom(e.target.value)} />
            </div>
            <div>
              <Label>Statement to</Label>
              <Input type="date" value={statementTo} onChange={(e) => setStatementTo(e.target.value)} />
            </div>
            <Button onClick={startSession} disabled={createMutation.isPending}>Start session</Button>
          </CardContent>
        </Card>

        {(sessions as any[]).length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Recent sessions</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(sessions as any[]).map((s) => (
                <Button
                  key={s.id}
                  variant={sessionId === s.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSessionId(s.id)}
                >
                  {s.account_name} · {formatDate(s.statement_from)} – {formatDate(s.statement_to)}
                  {s.status === 'reconciled' && <CheckCircle2 className="ml-2 h-3.5 w-3.5" />}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        {sessionId && (
          <>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadMutation.mutate(f);
                  e.target.value = '';
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
                <Upload className="mr-2 h-4 w-4" /> Upload CSV
              </Button>
              <Button variant="outline" onClick={() => autoMatchMutation.mutate()} disabled={autoMatchMutation.isPending}>
                <Sparkles className="mr-2 h-4 w-4" /> Auto-match
              </Button>
              <Button onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Mark reconciled
              </Button>
            </div>

            {sessionDetail?.session && (
              <div className="grid sm:grid-cols-3 gap-4 text-sm">
                <Card><CardContent className="p-4">Book balance: <strong>{formatMoney(Number(sessionDetail.session.book_balance_paise))}</strong></CardContent></Card>
                <Card><CardContent className="p-4">Statement balance: <strong>{formatMoney(Number(sessionDetail.session.statement_balance_paise))}</strong></CardContent></Card>
                <Card><CardContent className="p-4">Status: <Badge>{String(sessionDetail.session.status)}</Badge></CardContent></Card>
              </div>
            )}

            {sessionLoading ? (
              <p className="text-sm text-muted-foreground">Loading session…</p>
            ) : (
              <div className="grid lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader><CardTitle className="text-base">Bank statement lines</CardTitle></CardHeader>
                  <CardContent className="space-y-2 max-h-[32rem] overflow-y-auto">
                    {(sessionDetail?.statement_lines || []).map((line) => {
                      const amount = Number(line.credit_paise || 0) - Number(line.debit_paise || 0);
                      const isSelected = selectedLineId === String(line.id);
                      return (
                        <div
                          key={String(line.id)}
                          className={`rounded-md border p-3 text-sm cursor-pointer ${isSelected ? 'border-primary bg-primary/5' : ''}`}
                          onClick={() => setSelectedLineId(isSelected ? '' : String(line.id))}
                        >
                          <div className="flex justify-between gap-2">
                            <span className="font-medium">{formatDate(String(line.txn_date))}</span>
                            <span className={`tabular-nums font-semibold ${amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {formatMoney(Math.abs(amount))}
                            </span>
                          </div>
                          <p className="text-muted-foreground truncate">{String(line.description || '—')}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={line.match_status === 'matched' ? 'default' : 'secondary'}>{String(line.match_status)}</Badge>
                            {line.reference ? <span className="text-xs text-muted-foreground">{String(line.reference)}</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      {selectedLineId ? 'Select book entry to match' : 'Book entries (payments)'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 max-h-[32rem] overflow-y-auto">
                    {(selectedLineId ? unmatchedBook : sessionDetail?.book_entries || []).map((p) => (
                      <div key={String(p.id)} className="rounded-md border p-3 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{formatDate(String(p.payment_date))}</span>
                          <span className="tabular-nums font-semibold">{formatMoney(Math.abs(Number(p.signed_amount_paise || p.amount)))}</span>
                        </div>
                        <p className="text-muted-foreground">{String(p.party_name_snapshot || p.payment_type || 'Payment')}</p>
                        <div className="flex items-center justify-between mt-2">
                          <Badge variant={p.match_status === 'matched' ? 'default' : 'secondary'}>{String(p.match_status)}</Badge>
                          {selectedLineId && p.match_status === 'unmatched' && (
                            <Button
                              size="sm"
                              onClick={() => matchMutation.mutate({ statement_line_id: selectedLineId, payment_id: String(p.id) })}
                              disabled={matchMutation.isPending}
                            >
                              Match
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {selectedLineId && !unmatchedBook.length && (
                      <p className="text-sm text-muted-foreground">No unmatched book entries in this period.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
