// Permission checks, so the call sites exist before there is anything real
// behind them.
//
// Phase 1 implements this as a pure client-side check against the simulated
// identity, which is advisory by definition: the browser holds the state and
// the user can edit it. Phase 2 changes only this file's implementation, to
// a check against a server-issued session, and every call site is already in
// place.
//
// The prototype had no authorization at all. Its role dropdown changed one
// label and nothing else: a "representative" retained full access to every
// client, the credentials page, and the team page.

import { useCallback } from 'react';
import type { PlatformUser, UserRole } from '@/types';
import { usePlatform } from '@/lib/state/PlatformProvider';

export type Permission =
  | 'client.create'
  | 'client.configure'
  | 'client.viewAll'
  | 'team.invite'
  | 'team.editPermissions'
  | 'credentials.view'
  | 'credentials.manage'
  | 'audit.view'
  | 'field.logVisit';

// What each role may do. Written out per role rather than by inheritance,
// because "manager is like client_admin but less" is the kind of shorthand
// that quietly grants something nobody intended.
const GRANTS: Record<UserRole, ReadonlySet<Permission>> = {
  super_admin: new Set<Permission>([
    'client.create',
    'client.configure',
    'client.viewAll',
    'team.invite',
    'team.editPermissions',
    'credentials.view',
    'credentials.manage',
    'audit.view',
    'field.logVisit',
  ]),
  client_admin: new Set<Permission>([
    'client.configure',
    'team.invite',
    'credentials.view',
    'audit.view',
    'field.logVisit',
  ]),
  manager: new Set<Permission>(['audit.view', 'field.logVisit']),
  representative: new Set<Permission>(['field.logVisit']),
};

export interface CanOptions {
  /** The workspace the action targets, where the permission is client scoped. */
  clientId?: string;
}

export function useCan(): (permission: Permission, options?: CanOptions) => boolean {
  const { currentUser } = usePlatform();

  return useCallback(
    (permission: Permission, options?: CanOptions) => can(currentUser, permission, options),
    [currentUser]
  );
}

/** Pure, so it can be tested without a provider. */
export function can(
  user: PlatformUser | null,
  permission: Permission,
  options?: CanOptions
): boolean {
  // No session, no permissions. This is reachable for the moment between the
  // shell mounting and the session request returning, and answering "yes"
  // there would flash controls the user cannot use.
  if (!user) return false;
  if (!GRANTS[user.role].has(permission)) return false;

  // A client-scoped user may only act on their own workspace. The prototype
  // could produce a client-scoped role with clientId null, which is a user no
  // real backend could issue; this refuses rather than treating it as
  // platform-wide.
  if (options?.clientId && user.clientId !== null && user.clientId !== options.clientId) {
    return false;
  }
  return true;
}
