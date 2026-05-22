import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useItem, useDeleteItem } from '@/hooks/useItems';
import { formatMoney, formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Edit2, Trash2, Printer, Barcode, AlertTriangle, Loader2 } from 'lucide-react';
import ItemForm from './ItemForm';
import PrintLabels from '@/components/shared/PrintLabels';
import { openItemBarcodeInNewTab } from '@/lib/itemBarcode';

import toast from 'react-hot-toast';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useItem(id!);
  const deleteMutation = useDeleteItem();
  const [showEdit, setShowEdit] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [printLabelsOpen, setPrintLabelsOpen] = useState(false);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const item: any = data?.data;
  if (!item) return <div className="text-center py-20 text-muted-foreground">Item not found</div>;

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(id!);
      toast.success('Item deleted');
      setDeleteOpen(false);
      navigate('/items');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const stock: any[] = item.stock || [];
  const movements: any[] = item.recent_movements || [];
  const activity: any[] = item.activity_timeline || [];
  const activitySummary: Record<string, unknown> = item.activity_summary || {};
  const totalStock = item.total_stock || 0;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/items')}><ArrowLeft className="w-5 h-5" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{item.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              {item.sku && <Badge variant="outline" className="font-mono">{item.sku}</Badge>}
              {item.hsn_code && <Badge variant="secondary">{item.item_type === 'service' ? 'SAC' : 'HSN'}: {item.hsn_code}</Badge>}
              <Badge variant={item.is_active ? 'success' : 'destructive'}>{item.is_active ? 'Active' : 'Inactive'}</Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" type="button" onClick={() => setPrintLabelsOpen(true)}>
            <Printer className="w-4 h-4 mr-1" />
            Print Label
          </Button>
          <Button variant="outline" size="sm" onClick={() => id && openItemBarcodeInNewTab(id)}><Barcode className="w-4 h-4 mr-1" />Barcode</Button>
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}><Edit2 className="w-4 h-4 mr-1" />Edit</Button>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Purchase Price</p><p className="text-xl font-bold tabular-nums mt-1">{formatMoney(item.purchase_price, (item as any).price_currency_code)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Selling Price</p><p className="text-xl font-bold tabular-nums mt-1">{formatMoney(item.selling_price, (item as any).price_currency_code)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Stock</p><p className="text-xl font-bold tabular-nums mt-1">{totalStock} {item.unit_abbr || ''}</p>
          {item.track_inventory && totalStock <= (item.reorder_point || 0) && totalStock > 0 && <div className="flex items-center gap-1 mt-1 text-amber-600 text-xs"><AlertTriangle className="w-3 h-3" />Low stock</div>}
        </CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Stock Value</p><p className="text-xl font-bold tabular-nums mt-1">{formatMoney(item.total_stock_value || 0)}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Purchased Qty</p><p className="text-xl font-bold tabular-nums mt-1">{Number(activitySummary.purchased_quantity || 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Sold Qty</p><p className="text-xl font-bold tabular-nums mt-1">{Number(activitySummary.sold_quantity || 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Last Purchase</p><p className="text-sm font-semibold mt-2">{activitySummary.last_purchase_date ? formatDate(String(activitySummary.last_purchase_date)) : '—'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Last Sale</p><p className="text-sm font-semibold mt-2">{activitySummary.last_sale_date ? formatDate(String(activitySummary.last_sale_date)) : '—'}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="stock">Stock by Godown</TabsTrigger>
          <TabsTrigger value="movements">Recent Movements</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card><CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-8 text-sm">
              <div><span className="text-muted-foreground">Category</span><p className="font-medium mt-0.5">{item.category_name || '—'}</p></div>
              <div><span className="text-muted-foreground">Unit</span><p className="font-medium mt-0.5">{item.unit_name || '—'}</p></div>
              <div><span className="text-muted-foreground">Brand</span><p className="font-medium mt-0.5">{item.brand || '—'}</p></div>
              <div><span className="text-muted-foreground">Type</span><p className="font-medium mt-0.5 capitalize">{item.item_type?.replace('_', ' ')}</p></div>
              <div><span className="text-muted-foreground">GST Rate</span><p className="font-medium mt-0.5">{item.gst_rate}% ({item.tax_preference})</p></div>
              <div><span className="text-muted-foreground">Reorder Point</span><p className="font-medium mt-0.5">{item.reorder_point || '—'}</p></div>
              <div><span className="text-muted-foreground">Track Inventory</span><p className="font-medium mt-0.5">{item.track_inventory ? 'Yes' : 'No'}</p></div>
              <div><span className="text-muted-foreground">Serialized</span><p className="font-medium mt-0.5">{item.is_serialized ? 'Yes' : 'No'}</p></div>
              <div><span className="text-muted-foreground">Created</span><p className="font-medium mt-0.5">{item.created_at ? formatDate(item.created_at) : '—'}</p></div>
            </div>
            {item.description && <div className="mt-4 pt-4 border-t"><span className="text-muted-foreground text-sm">Description</span><p className="mt-1 text-sm">{item.description}</p></div>}
            {item.custom_fields && Object.keys(item.custom_fields).length > 0 && (
              <div className="mt-4 pt-4 border-t"><span className="text-muted-foreground text-sm">Custom Fields</span>
                <div className="grid grid-cols-2 gap-y-2 gap-x-8 mt-2 text-sm">
                  {Object.entries(item.custom_fields).map(([k, v]) => (
                    <div key={k}><span className="text-muted-foreground">{k}</span><p className="font-medium">{String(v)}</p></div>
                  ))}
                </div>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="stock">
          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40"><th className="p-3 text-left">Godown</th><th className="p-3 text-right">Quantity</th><th className="p-3 text-right">Available</th><th className="p-3 text-right">Avg Cost</th><th className="p-3 text-right">Value</th></tr></thead>
              <tbody>
                {stock.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No stock records</td></tr>}
                {stock.map((s: any) => (
                  <tr key={s.godown_id} className="border-b"><td className="p-3 font-medium">{s.godown_name}</td>
                    <td className="p-3 text-right tabular-nums">{s.quantity}</td>
                    <td className="p-3 text-right tabular-nums">{s.available_quantity}</td>
                    <td className="p-3 text-right tabular-nums">{formatMoney(s.avg_cost_price)}</td>
                    <td className="p-3 text-right tabular-nums font-medium">{formatMoney(s.quantity * s.avg_cost_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40"><th className="p-3 text-left">Date</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Godown</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Balance</th><th className="p-3 text-left">By</th></tr></thead>
              <tbody>
                {movements.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No movements</td></tr>}
                {movements.map((m: any) => (
                  <tr key={m.id} className="border-b"><td className="p-3">{m.created_at ? formatDate(m.created_at) : '—'}</td>
                    <td className="p-3"><Badge variant={m.quantity > 0 ? 'success' : 'destructive'} className="text-[10px]">{m.movement_type?.replace('_', ' ')}</Badge></td>
                    <td className="p-3">{m.godown_name}</td>
                    <td className={`p-3 text-right tabular-nums font-medium ${m.quantity > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                    <td className="p-3 text-right tabular-nums">{m.balance_after}</td>
                    <td className="p-3 text-muted-foreground">{m.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card><CardContent className="p-4 space-y-3">
            {activity.length === 0 && <div className="p-8 text-center text-muted-foreground">No transaction history for this item yet.</div>}
            {activity.map((row: any, index: number) => (
              <div key={`${row.activity_type}-${row.reference_id}-${index}`} className="rounded-lg border p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={['purchase', 'opening_stock', 'transfer_in'].includes(row.activity_type) ? 'success' : ['sale', 'transfer_out'].includes(row.activity_type) ? 'destructive' : 'warning'}>
                        {String(row.activity_type || '').replace(/_/g, ' ')}
                      </Badge>
                      <span className="font-medium">{row.reference_number || 'Reference'}</span>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {row.counterparty_name || '—'}{row.godown_name ? ` • ${row.godown_name}` : ''}
                    </div>
                  </div>
                  <div className="text-left md:text-right">
                    <div className={`font-semibold tabular-nums ${Number(row.quantity) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {Number(row.quantity) > 0 ? '+' : ''}{Number(row.quantity || 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">{row.activity_at ? formatDate(String(row.activity_at)) : '—'}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Unit price</span><p className="tabular-nums">{formatMoney(Number(row.unit_price || 0))}</p></div>
                  <div><span className="text-muted-foreground">Taxable</span><p className="tabular-nums">{formatMoney(Number(row.taxable_amount || 0))}</p></div>
                  <div><span className="text-muted-foreground">Tax</span><p className="tabular-nums">{formatMoney(Number(row.tax_amount || 0))}</p></div>
                  <div><span className="text-muted-foreground">Total</span><p className="tabular-nums">{formatMoney(Number(row.gross_amount || 0))}</p></div>
                </div>
                {row.notes ? <p className="mt-2 text-xs text-muted-foreground">{row.notes}</p> : null}
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <ItemForm open={showEdit} onOpenChange={setShowEdit} item={item} />

      {printLabelsOpen && id && (
        <PrintLabels
          selectedItems={[
            {
              item_id: id,
              sku: item.sku || '',
              name: item.name,
              quantity: 1,
            },
          ]}
          onClose={() => setPrintLabelsOpen(false)}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete item?"
        description={`This will remove “${item.name}” from the catalog. Linked stock history may be retained depending on company policy.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
