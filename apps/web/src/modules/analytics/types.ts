export interface AnalyticsData {
  /** ISO 8601 day keys, oldest first. */
  series: Array<{ day: string; sessions: number; conversions: number; revenue: number }>;
  sources: Array<{ name: string; sessions: number; conversions: number }>;
}
