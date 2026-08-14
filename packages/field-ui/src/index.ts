// The door to door field app, as screens rather than as a site.
//
// One copy of this runs in two shells: the /field route on a client's own
// dashboard hostname, and the standalone app a rep installs from the App
// Store or Play Store. Both mount <FieldApp /> and import field.css; what
// differs between them is declared through configureFieldPlatform and
// nothing else. Keeping it that way is the point of this package, because
// the alternative is two copies of a rep's day drifting apart.

export { FieldApp } from './FieldApp';
export { configureFieldPlatform, fieldPlatform, browserFix } from './platform';
export type { FieldPlatform } from './platform';
export { FieldApiError, FieldOfflineError, fieldApi } from './api';
export { getOutbox, pendingCount, flush } from './outbox';
export type { Fix } from './geo';
export type {
  Disposition,
  FieldBootstrap,
  FieldRep,
  FieldStats,
  FieldTotals,
  NearbyAddress,
  OutboxEntry,
  QueuedVisit,
  SavedVisit,
} from './types';
