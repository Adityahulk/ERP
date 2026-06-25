// ═══════════════════════════════════════════════════════════════
// SHARED TYPES FOR BIZFLOW FRONTEND
// ═══════════════════════════════════════════════════════════════

export type { LabelConfig } from './labelConfig';
export { defaultLabelConfig, printModeToApiParams, PRINT_MODE_LABELS } from './labelConfig';
export * from './label';

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
  pagination?: Pagination;
  error?: string;
  errors?: Array<{ field: string; message: string }>;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  avatar_url?: string;
  is_active?: boolean;
  last_login_at?: string;
  created_at?: string;
}

export interface Company {
  id: string;
  name: string;
  legal_name?: string;
  gstin?: string;
  pan?: string;
  logo_url?: string;
  item_terminology: string;
  item_terminology_plural: string;
  plan_type?: string;
  onboarding_completed?: boolean;
}

export interface Godown {
  id: string;
  name: string;
  code?: string;
  address?: string;
  city?: string;
  state?: string;
  is_default: boolean;
  is_active: boolean;
  manager_name?: string;
  item_count?: number;
  stock_value?: number;
}

export interface ItemCategory {
  id: string;
  name: string;
  parent_id?: string;
  parent_name?: string;
  item_count?: number;
  children?: ItemCategory[];
}

export interface ItemUnit {
  id: string;
  name: string;
  abbreviation?: string;
  is_default: boolean;
}

export interface Item {
  id: string;
  name: string;
  description?: string;
  sku?: string;
  hsn_code?: string;
  barcode?: string;
  brand?: string;
  category_id?: string;
  category_name?: string;
  unit_id?: string;
  unit_name?: string;
  unit_abbr?: string;
  item_type: 'product' | 'service' | 'raw_material' | 'finished_good' | 'consumable';
  track_inventory: boolean;
  is_serialized: boolean;
  purchase_price: number;
  selling_price: number;
  price_currency_code?: 'INR' | 'USD';
  selling_price_includes_tax?: boolean;
  purchase_price_includes_tax?: boolean;
  gst_rate: number;
  tax_preference: string;
  reorder_point: number;
  total_stock?: number;
  total_stock_value?: number;
  is_active: boolean;
  image_url?: string;
  custom_fields?: Record<string, any>;
  opening_stock?: number;
  opening_stock_value?: number;
  stock?: ItemStock[];
  created_at?: string;
}

export interface ItemStock {
  item_id: string;
  godown_id: string;
  godown_name: string;
  godown_code?: string;
  quantity: number;
  available_quantity: number;
  reserved_quantity: number;
  avg_cost_price: number;
}

export interface StockMovement {
  id: string;
  item_id: string;
  item_name?: string;
  sku?: string;
  godown_id: string;
  godown_name?: string;
  movement_type: string;
  reference_type?: string;
  reference_id?: string;
  quantity: number;
  unit_cost: number;
  balance_after: number;
  notes?: string;
  created_by_name?: string;
  created_at: string;
}

export interface StockTransfer {
  id: string;
  transfer_number: string;
  from_godown_id: string;
  to_godown_id: string;
  status: 'draft' | 'in_transit' | 'received' | 'cancelled';
  transfer_date: string;
  created_by: string;
  items?: StockTransferItem[];
}

export interface StockTransferItem {
  item_id: string;
  item_name?: string;
  quantity_sent: number;
  quantity_received?: number;
}

export interface StockListItem {
  id: string;
  name: string;
  sku?: string;
  category_name?: string;
  unit_name?: string;
  unit_abbr?: string;
  quantity: number;
  available_quantity: number;
  avg_cost_price: number;
  godown_id?: string;
  godown_name?: string;
  reorder_point: number;
  purchase_price: number;
  selling_price: number;
}

export interface ItemFilters {
  search?: string;
  category_id?: string;
  item_type?: string;
  is_active?: string;
  low_stock?: string;
  out_of_stock?: string;
  godown_id?: string;
  page?: number;
  limit?: number;
}


// ═══════════════════════════════════════════════════════════════
// MANUFACTURING — BOM, WHOLESALE, JOB WORK
// ═══════════════════════════════════════════════════════════════

export interface BOM {
  id: string;
  company_id: string;
  finished_item_id: string;
  finished_item_name?: string;
  finished_item_sku?: string;
  bom_name?: string;
  bom_number?: string;
  version: number;
  labour_cost: number;
  overhead_cost: number;
  total_cost: number;
  notes?: string;
  is_default: boolean;
  is_active: boolean;
  items?: BOMItem[];
  created_at?: string;
}

export interface BOMItem {
  id: string;
  bom_id: string;
  item_id: string;
  item_name?: string;
  item_sku?: string;
  unit?: string;
  unit_abbr?: string;
  quantity: number;
  wastage_percent: number;
  unit_cost: number;
  notes?: string;
  sort_order: number;
}

export interface ProductionLog {
  id: string;
  bom_id: string;
  bom_name?: string;
  finished_item_name?: string;
  production_number?: string;
  production_date: string;
  godown_id?: string;
  godown_name?: string;
  quantity_produced: number;
  labour_cost: number;
  overhead_cost: number;
  total_cost: number;
  notes?: string;
  status: string;
  created_by_name?: string;
  created_at?: string;
}

export interface WholesalePriceTier {
  id: string;
  item_id: string;
  item_name?: string;
  item_sku?: string;
  min_quantity: number;
  price: number;
  tier_name?: string;
  is_active: boolean;
}

export interface WholesaleOrder {
  id: string;
  order_number: string;
  order_date: string;
  expected_delivery?: string;
  party_id?: string;
  party_name?: string;
  party_name_snapshot?: string;
  party_gstin_snapshot?: string;
  godown_id?: string;
  godown_name?: string;
  is_interstate: boolean;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_status: 'unpaid' | 'partial' | 'paid';
  status: 'draft' | 'confirmed' | 'dispatched' | 'delivered' | 'cancelled';
  dispatch_date?: string;
  transport_details?: string;
  lr_number?: string;
  eway_bill_number?: string;
  vehicle_number?: string;
  notes?: string;
  items?: WholesaleOrderItem[];
  created_at?: string;
}

export interface WholesaleOrderItem {
  id: string;
  order_id: string;
  item_id?: string;
  item_name: string;
  hsn_code?: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  taxable_amount: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
  tier_applied?: string;
}

export interface JobWorkChallan {
  id: string;
  challan_number: string;
  challan_type: 'outward' | 'inward';
  challan_date: string;
  party_id: string;
  party_name?: string;
  party_name_snapshot?: string;
  party_gstin_snapshot?: string;
  godown_id?: string;
  godown_name?: string;
  related_challan_id?: string;
  related_challan_number?: string;
  return_due_date?: string;
  is_capital_goods: boolean;
  is_returned: boolean;
  labour_charges: number;
  other_charges: number;
  gst_on_charges: number;
  total_charges: number;
  total_material_value: number;
  status: 'draft' | 'sent' | 'partial_return' | 'returned' | 'overdue' | 'cancelled';
  transport_details?: string;
  vehicle_number?: string;
  eway_bill_number?: string;
  notes?: string;
  items?: JobWorkChallanItem[];
  created_at?: string;
}

export interface JobWorkChallanItem {
  id: string;
  challan_id: string;
  item_id?: string;
  item_name?: string;
  hsn_code?: string;
  unit?: string;
  quantity_sent: number;
  quantity_received: number;
  quantity_rejected: number;
  wastage: number;
  unit_price: number;
  total_value: number;
  notes?: string;
}
