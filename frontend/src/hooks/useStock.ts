import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export function useStock(filters: any) {
  return useQuery({
    queryKey: ['stock', filters],
    queryFn: () => api.get('/stock', { params: filters }).then(r => r.data),
  });
}

export function useItemStock(itemId: string) {
  return useQuery({
    queryKey: ['stock', 'item', itemId],
    queryFn: () => api.get(`/stock/item/${itemId}`).then(r => r.data),
    enabled: !!itemId,
  });
}

export function useStockValuation() {
  return useQuery({
    queryKey: ['stock', 'valuation'],
    queryFn: () => api.get('/stock/valuation').then(r => r.data),
  });
}

export function useLowStock() {
  return useQuery({
    queryKey: ['stock', 'low-stock'],
    queryFn: () => api.get('/stock/low-stock').then(r => r.data),
  });
}

export function useStockMovements(filters: any) {
  return useQuery({
    queryKey: ['stock', 'movements', filters],
    queryFn: () => api.get('/stock/movements', { params: filters }).then(r => r.data),
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/stock/transfer', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useReceiveTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.post(`/stock/transfer/${id}/receive`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

/** Items with stock in a godown (for transfer picker). */
export function useItemsForTransfer(search: string, godownId: string | undefined) {
  return useQuery({
    queryKey: ['items', 'transfer-picker', godownId, search],
    queryFn: async () => {
      const r = await api.get('/items', {
        params: {
          search: search.trim() || undefined,
          godown_id: godownId,
          limit: 50,
          with_positive_stock_in_godown: true,
          is_active: true,
        },
      });
      const page = r.data?.data as { data?: Record<string, unknown>[] } | undefined;
      return page?.data ?? [];
    },
    enabled: !!godownId && search.trim().length >= 1,
    staleTime: 15_000,
  });
}

export function useCreateAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/stock/adjustment', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  });
}

export function useGodowns() {
  return useQuery({
    queryKey: ['godowns'],
    queryFn: () => api.get('/godowns').then(r => r.data),
  });
}

/** Scan a barcode → find item → reduce stock → log a stock movement. */
export function useScanAndDeduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { barcode: string; godown_id: string; quantity?: number; notes?: string }) =>
      api.post('/barcode/scan-out', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['barcode', 'scan-history'] });
    },
  });
}

/** Audit trail of every barcode-driven stock deduction. */
export function useBarcodeScanHistory(filters: any) {
  return useQuery({
    queryKey: ['barcode', 'scan-history', filters],
    queryFn: () => api.get('/barcode/scan/history', { params: filters }).then(r => r.data),
  });
}
