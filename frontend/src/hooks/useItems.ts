import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ItemFilters } from '@/types';

export function useItems(filters: ItemFilters) {
  return useQuery({
    queryKey: ['items', filters],
    queryFn: () => api.get('/items', { params: filters }).then(r => r.data),
  });
}

export function useItem(id: string) {
  return useQuery({
    queryKey: ['items', id],
    queryFn: () => api.get(`/items/${id}`).then(r => r.data),
    enabled: !!id,
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/items', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.patch(`/items/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/items/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });
}

export function useItemCategories() {
  return useQuery({
    queryKey: ['item-categories'],
    queryFn: () => api.get('/item-categories').then(r => r.data),
  });
}

export function useItemUnits() {
  return useQuery({
    queryKey: ['item-units'],
    queryFn: () => api.get('/item-units').then(r => r.data),
  });
}

export function useCreateItemCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/item-categories', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-categories'] }),
  });
}

export function useCreateItemUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/item-units', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-units'] }),
  });
}

export function useScanBarcode() {
  return useMutation({
    mutationFn: (barcode: string) => api.post('/items/scan', { barcode }).then(r => r.data),
  });
}
