// Identity resolution. Indexes by email, phone last 10, and normalized
// name, in that priority. Records the match method and flags ambiguity
// when a key maps to multiple identities.

export interface IdentityRecord {
  id: string;
  emailNorm: string | null;
  phoneLast10: string | null;
  nameNorm: string | null;
}

export interface IdentityHints {
  clientId?: string | null;
  email?: string | null;
  phoneLast10?: string | null;
  nameNorm?: string | null;
}

export interface ClientBridgeRecord {
  clientId: string;
  emailNorm: string | null;
  phoneLast10: string | null;
  nameNorm: string | null;
}

export type MatchMethod = 'client_id' | 'email' | 'phone' | 'name' | 'none';

export interface MatchResult {
  contactId: string | null;
  method: MatchMethod;
  ambiguous: boolean;
}

export interface IdentityIndex {
  byEmail: Map<string, string[]>;
  byPhone: Map<string, string[]>;
  byName: Map<string, string[]>;
}

export function buildIdentityIndex(records: IdentityRecord[]): IdentityIndex {
  const byEmail = new Map<string, string[]>();
  const byPhone = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string | null, id: string) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  for (const r of records) {
    add(byEmail, r.emailNorm, r.id);
    add(byPhone, r.phoneLast10, r.id);
    add(byName, r.nameNorm, r.id);
  }
  return { byEmail, byPhone, byName };
}

// Resolution priority: client id bridge first (it expands to identity
// keys), then email, then phone, then normalized name. A key hitting
// multiple contacts resolves to the first but flags ambiguity.
export function resolveIdentity(
  hints: IdentityHints,
  index: IdentityIndex,
  bridge?: Map<string, ClientBridgeRecord>
): MatchResult {
  let email = hints.email ?? null;
  let phone = hints.phoneLast10 ?? null;
  let name = hints.nameNorm ?? null;
  let viaClientId = false;

  if (hints.clientId && bridge) {
    const record = bridge.get(hints.clientId);
    if (record) {
      email = email ?? record.emailNorm;
      phone = phone ?? record.phoneLast10;
      name = name ?? record.nameNorm;
      viaClientId = true;
    }
  }

  const tryKey = (map: Map<string, string[]>, key: string | null): { id: string; ambiguous: boolean } | null => {
    if (!key) return null;
    const ids = map.get(key);
    if (!ids || ids.length === 0) return null;
    return { id: ids[0]!, ambiguous: ids.length > 1 };
  };

  const emailHit = tryKey(index.byEmail, email);
  if (emailHit) {
    return { contactId: emailHit.id, method: viaClientId ? 'client_id' : 'email', ambiguous: emailHit.ambiguous };
  }
  const phoneHit = tryKey(index.byPhone, phone);
  if (phoneHit) {
    return { contactId: phoneHit.id, method: viaClientId ? 'client_id' : 'phone', ambiguous: phoneHit.ambiguous };
  }
  const nameHit = tryKey(index.byName, name);
  if (nameHit) {
    return { contactId: nameHit.id, method: viaClientId ? 'client_id' : 'name', ambiguous: nameHit.ambiguous };
  }
  return { contactId: null, method: 'none', ambiguous: false };
}
