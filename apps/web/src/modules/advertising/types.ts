// Owned by this module. Nothing in lib/ or platform/ may import it; the
// registry and the module data map are the only sanctioned exceptions.

export interface Campaign {
  id: string;
  name: string;
  channel: 'meta' | 'google';
  status: 'active' | 'paused' | 'ended';
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  revenue: number;
}

export interface AdLead {
  id: string;
  name: string;
  email: string;
  campaignId: string;
  stage: 'new' | 'contacted' | 'qualified' | 'won' | 'lost';
  /** ISO 8601. */
  createdAt: string;
  value: number;
}

export interface AdvertisingData {
  campaigns: Campaign[];
  leads: AdLead[];
  /** ISO 8601 day keys, oldest first. */
  spendSeries: Array<{ day: string; spend: number; leads: number }>;
}
