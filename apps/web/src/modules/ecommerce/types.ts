export interface Order {
  id: string;
  reference: string;
  customerName: string;
  customerEmail: string;
  status: 'pending' | 'fulfilled' | 'refunded' | 'cancelled';
  total: number;
  itemCount: number;
  /** ISO 8601. */
  placedAt: string;
}

export interface EcommerceData {
  orders: Order[];
  revenueSeries: Array<{ day: string; revenue: number; orders: number }>;
}
