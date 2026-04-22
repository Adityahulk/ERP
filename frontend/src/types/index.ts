// ═══════════════════════════════════════════════════════════════
// SHARED TYPES FOR BIZFLOW FRONTEND
// ═══════════════════════════════════════════════════════════════

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
  gst_rate: number;
  tax_preference: string;
  reorder_point: number;
  total_stock?: number;
  total_stock_value?: number;
  is_active: boolean;
  image_url?: string;
  custom_fields?: Record<string, any>;
  opening_stock?: number;
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
