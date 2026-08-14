export interface Shipment {
  id: string;
  reference: string;
  carrier: string;
  status: 'label_created' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';
  origin: string;
  destination: string;
  /** ISO 8601. */
  dispatchedAt: string;
  /** ISO 8601. */
  expectedAt: string;
}

export interface LogisticsData {
  shipments: Shipment[];
}
