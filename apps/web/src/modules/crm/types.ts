export type PipelineStage = 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

export interface Deal {
  id: string;
  name: string;
  company: string;
  stage: PipelineStage;
  value: number;
  ownerName: string;
  /** ISO 8601. */
  updatedAt: string;
}

export interface CrmData {
  deals: Deal[];
}
