import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useItemCategories, useCreateItemCategory, useUpdateItemCategory, useDeleteItemCategory,
} from '@/hooks/useItems';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, FolderTree, Plus, Pencil, Trash2, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

export default function ItemCategoriesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useItemCategories();
  const categories: any[] = data?.data?.flat || [];

  const createMutation = useCreateItemCategory();
  const updateMutation = useUpdateItemCategory();
  const deleteMutation = useDeleteItemCategory();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<{ name: string; parent_id: string; description: string }>({ name: '', parent_id: '', description: '' });
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const openNew = () => { setEditing(null); setForm({ name: '', parent_id: '', description: '' }); setSheetOpen(true); };
  const openEdit = (cat: any) => {
    setEditing(cat);
    setForm({ name: cat.name, parent_id: cat.parent_id || '', description: cat.description || '' });
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Category name is required'); return; }
    try {
      const payload = { name: form.name.trim(), parent_id: form.parent_id || null, description: form.description || undefined };
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, data: payload });
        toast.success('Category updated');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Category created');
      }
      setSheetOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save category');
    }
  };

  const runDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      toast.success('Category deleted');
      setPendingDelete(null);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to delete — it may still have items assigned');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/items')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2"><FolderTree className="w-6 h-6 text-indigo-600" /> Categories</h1>
          <p className="text-sm text-muted-foreground">Group items so the Item List, filters, and reports can organize by category.</p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Add category</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
          {!isLoading && categories.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              <FolderTree className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No categories yet</p>
              <p className="text-xs mt-1">Create your first category to start organizing items.</p>
            </div>
          )}
          {!isLoading && categories.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50/60">
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Parent</th>
                  <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Items</th>
                  <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{cat.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{cat.parent_name || '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Package className="w-3.5 h-3.5" />{cat.item_count}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(cat)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete({ id: cat.id, name: cat.name })}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right">
          <SheetHeader className="mb-5"><SheetTitle>{editing ? 'Edit category' : 'New category'}</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input className="mt-1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            </div>
            <div>
              <Label>Parent category (optional)</Label>
              <select className="mt-1 w-full h-9 rounded-md border bg-transparent px-3 text-sm" value={form.parent_id} onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}>
                <option value="">None — top level</option>
                {categories.filter((c) => c.id !== editing?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <textarea rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-transparent resize-none" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-4 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setSheetOpen(false)}>Cancel</Button>
              <Button className="flex-1" loading={createMutation.isPending || updateMutation.isPending} onClick={handleSave}>Save</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete category?"
        description={pendingDelete ? `Remove "${pendingDelete.name}". Items already in this category will keep their data but lose the category tag.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={runDelete}
      />
    </div>
  );
}
