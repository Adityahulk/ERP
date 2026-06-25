import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useItemUnits, useCreateItemUnit, useUpdateItemUnit } from '@/hooks/useItems';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Ruler, Plus, Pencil, Star } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ItemUnitsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useItemUnits();
  const units: any[] = data?.data || [];

  const createMutation = useCreateItemUnit();
  const updateMutation = useUpdateItemUnit();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<{ name: string; abbreviation: string; is_default: boolean }>({ name: '', abbreviation: '', is_default: false });

  const openNew = () => { setEditing(null); setForm({ name: '', abbreviation: '', is_default: false }); setSheetOpen(true); };
  const openEdit = (unit: any) => {
    setEditing(unit);
    setForm({ name: unit.name, abbreviation: unit.abbreviation || '', is_default: !!unit.is_default });
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Unit name is required'); return; }
    try {
      const payload = { name: form.name.trim(), abbreviation: form.abbreviation.trim() || undefined, is_default: form.is_default };
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, data: payload });
        toast.success('Unit updated');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Unit created');
      }
      setSheetOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save unit');
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/items')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Ruler className="w-6 h-6 text-indigo-600" /> Units</h1>
          <p className="text-sm text-muted-foreground">Units of measure for stock — pieces, kilograms, boxes, and conversions between them.</p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Add unit</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
          {!isLoading && units.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              <Ruler className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No units yet</p>
            </div>
          )}
          {!isLoading && units.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50/60">
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Abbreviation</th>
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Conversions</th>
                  <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {units.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium flex items-center gap-1.5">
                      {u.name}
                      {u.is_default && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" titleAccess="Default unit" />}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono">{u.abbreviation || '—'}</td>
                    <td className="px-4 py-2.5">
                      {(u.conversions || []).length === 0 ? (
                        <span className="text-muted-foreground text-xs">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.conversions.map((c: any) => (
                            <Badge key={c.id} variant="outline" className="text-[10px]">1 {u.abbreviation || u.name} = {c.factor} {c.secondary_unit_abbreviation || c.secondary_unit_name}</Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}><Pencil className="w-3.5 h-3.5" /></Button>
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
          <SheetHeader className="mb-5"><SheetTitle>{editing ? 'Edit unit' : 'New unit'}</SheetTitle></SheetHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input className="mt-1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Kilogram" autoFocus />
            </div>
            <div>
              <Label>Abbreviation</Label>
              <Input className="mt-1" value={form.abbreviation} onChange={(e) => setForm((f) => ({ ...f, abbreviation: e.target.value }))} placeholder="kg" />
            </div>
            <div className="flex items-center justify-between border-t pt-4">
              <div>
                <p className="text-sm font-medium">Set as default unit</p>
                <p className="text-xs text-muted-foreground">New items will use this unit unless changed.</p>
              </div>
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm((f) => ({ ...f, is_default: v }))} />
            </div>
            <div className="flex gap-3 pt-4 border-t">
              <Button variant="outline" className="flex-1" onClick={() => setSheetOpen(false)}>Cancel</Button>
              <Button className="flex-1" loading={createMutation.isPending || updateMutation.isPending} onClick={handleSave}>Save</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
