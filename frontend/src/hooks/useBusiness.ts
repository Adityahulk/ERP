import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export function useParties(filters: any) {
  return useQuery({
    queryKey: ['parties', filters],
    queryFn: () => api.get('/parties', { params: filters }).then(r => r.data),
  });
}

export function useParty(id: string) {
  return useQuery({
    queryKey: ['parties', id],
    queryFn: () => api.get(`/parties/${id}`).then(r => r.data),
    enabled: !!id,
  });
}

export function useCreateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/parties', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
  });
}

export function useUpdateParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.patch(`/parties/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
  });
}

export function useDeleteParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/parties/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parties'] }),
  });
}

export function useSearchParties(q: string) {
  return useQuery({
    queryKey: ['parties', 'search', q],
    queryFn: () => api.get('/parties/search', { params: { q } }).then((r) => r.data),
    enabled: q.length >= 2,
  });
}

export function useInvoices(filters: any) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: () => api.get('/invoices', { params: filters }).then(r => r.data),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: () => api.get(`/invoices/${id}`).then(r => r.data),
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/invoices', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCancelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/invoices/${id}/cancel`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });
}

export function usePayments(filters: any) {
  return useQuery({
    queryKey: ['payments', filters],
    queryFn: () => api.get('/payments', { params: filters }).then(r => r.data),
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/payments', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useExpenses(filters: any) {
  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: () => api.get('/expenses', { params: filters }).then(r => r.data),
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/expenses', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/reports/dashboard').then(r => r.data),
    refetchInterval: 60000, // Refresh every 60s
  });
}

export function useProfitLoss(from?: string, to?: string) {
  return useQuery({
    queryKey: ['reports', 'profit-loss', from, to],
    queryFn: () => api.get('/reports/profit-loss', { params: { from_date: from, to_date: to } }).then(r => r.data),
  });
}

export function useGSTReport(from?: string, to?: string) {
  return useQuery({
    queryKey: ['reports', 'gst', from, to],
    queryFn: () => api.get('/reports/gst', { params: { from_date: from, to_date: to } }).then(r => r.data),
  });
}

export function useCompany() {
  return useQuery({
    queryKey: ['company'],
    queryFn: () => api.get('/company').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch('/company', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company'] }),
  });
}

export function useGenerateEinvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => api.post(`/invoices/${invoiceId}/einvoice/generate`).then((r) => r.data),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useCancelEinvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; reason_code: number; reason_description: string }) =>
      api.post(`/invoices/${args.id}/einvoice/cancel`, {
        reason_code: args.reason_code,
        reason_description: args.reason_description,
      }).then((r) => r.data),
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ['invoice', args.id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}
