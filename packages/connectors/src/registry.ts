import type { Connector } from './types';
import { boulevardConnector } from './boulevard';
import { housecallProConnector } from './housecallpro';
import { jobberConnector } from './jobber';
import { metaAdsConnector } from './metaAds';

export const CONNECTORS: Record<string, Connector> = {
  boulevard: boulevardConnector,
  housecallpro: housecallProConnector,
  jobber: jobberConnector,
  'meta-ads': metaAdsConnector,
};
