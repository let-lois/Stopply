// Whose brand this page is wearing.
//
// One answer, derived once, because the alternative is every header, sidebar,
// title and favicon deciding for itself and three of them being right. The
// promise being kept here is specific and easy to break by accident: a client
// must never see the word Stopply or the Stopply mark inside their own
// workspace.
//
// The rule has two parts, and both matter.
//
// 1. Inside a workspace route, the brand is that workspace's. This is what a
//    LetLois admin sees when they open a client: the client's mark, because
//    they are looking at the client's product, not at ours.
//
// 2. A client-scoped user is never shown ours, anywhere. Their session is
//    pinned to one workspace, so even the pages that are not under /c/:id are
//    still their product: the team page lists their people and the activity
//    page is their trail. An agency user, whose session is pinned to nothing,
//    sees Stopply on those same pages, because for them that is what they are.
//
// The distinction is `clientId === null`, which is what the server issues for
// a platform-wide account and refuses to issue for any other kind.

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { usePlatform } from '@/lib/state/PlatformProvider';
import type { Client } from '@/types';

export interface Brand {
  /** What to call it. Never "Stopply" for a client-scoped viewer. */
  name: string;
  /** The line under the name, or null where there is nothing worth saying. */
  tagline: string | null;
  /** An uploaded mark, or null to draw the monogram. */
  logo: string | null;
  /** Drives the monogram's colour, and nothing else. */
  key: string;
  /**
   * Whether this is the agency's own brand.
   *
   * The one flag the shell reads to decide whether Stopply may appear at all.
   * Named for what it is rather than for what it hides, so a call site reading
   * `if (brand.isAgency)` says what it means.
   */
  isAgency: boolean;
}

export const AGENCY_BRAND: Brand = {
  name: 'Stopply',
  tagline: 'Operations platform',
  logo: '/icon-192.png',
  key: 'stopply',
  isAgency: true,
};

export function brandForClient(client: Client): Brand {
  return {
    name: client.name,
    // Deliberately nothing. "Operations platform" is our description of our
    // product; putting it under a client's name tells them they are looking at
    // somebody else's software, which is the whole thing being avoided.
    tagline: null,
    logo: client.logo,
    key: client.id,
    isAgency: false,
  };
}

/**
 * The brand for the page being rendered.
 *
 * Returns the agency brand while the session is still loading rather than
 * flashing a client's mark and replacing it, or the reverse. A client-scoped
 * user has no session yet at that point and so is not on a page.
 */
export function useBrand(): Brand {
  const { clientId } = useParams<{ clientId: string }>();
  const { clients, currentUser } = usePlatform();

  return useMemo(() => {
    // A client-scoped user, wherever they are. Their own workspace first,
    // falling back to the route, so a page outside /c/:id still wears their
    // brand rather than reverting to ours.
    const ownId = currentUser?.clientId ?? null;
    const target = ownId ?? clientId ?? null;
    if (!target) return AGENCY_BRAND;

    const client = clients.find((c) => c.id === target);
    // No matching client and a pinned session means the roster has not
    // arrived. Falling back to the agency brand would show Stopply to somebody
    // who must never see it, so this falls back to their name and no mark.
    if (!client) {
      return ownId
        ? { name: '', tagline: null, logo: null, key: ownId, isAgency: false }
        : AGENCY_BRAND;
    }
    return brandForClient(client);
  }, [clientId, clients, currentUser]);
}
