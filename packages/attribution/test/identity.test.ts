import { describe, it, expect } from 'vitest';
import { buildIdentityIndex, resolveIdentity } from '../src/identity';

const contacts = [
  { id: 'c1', emailNorm: 'jane@x.com', phoneLast10: '6025550101', nameNorm: 'doe jane' },
  { id: 'c2', emailNorm: 'bob@x.com', phoneLast10: '6025550102', nameNorm: 'bob ray' },
  // c3 shares a name with c4: name matches are ambiguous.
  { id: 'c3', emailNorm: 'sky@x.com', phoneLast10: null, nameNorm: 'lee sky' },
  { id: 'c4', emailNorm: null, phoneLast10: '6025550104', nameNorm: 'lee sky' },
];

const index = buildIdentityIndex(contacts);

describe('identity resolution priority', () => {
  it('email beats phone beats name', () => {
    // Hints that could match c1 by email but c2 by phone: email wins.
    const result = resolveIdentity(
      { email: 'jane@x.com', phoneLast10: '6025550102', nameNorm: 'bob ray' },
      index
    );
    expect(result.contactId).toBe('c1');
    expect(result.method).toBe('email');
  });

  it('falls to phone when email misses', () => {
    const result = resolveIdentity({ email: 'nobody@x.com', phoneLast10: '6025550102' }, index);
    expect(result.contactId).toBe('c2');
    expect(result.method).toBe('phone');
  });

  it('falls to name last', () => {
    const result = resolveIdentity({ nameNorm: 'doe jane' }, index);
    expect(result.contactId).toBe('c1');
    expect(result.method).toBe('name');
  });

  it('returns none when nothing matches', () => {
    const result = resolveIdentity({ nameNorm: 'stranger person' }, index);
    expect(result.contactId).toBeNull();
    expect(result.method).toBe('none');
  });
});

describe('ambiguity flags', () => {
  it('flags a name key mapping to multiple identities', () => {
    const result = resolveIdentity({ nameNorm: 'lee sky' }, index);
    expect(result.ambiguous).toBe(true);
    expect(result.contactId).toBe('c3');
  });

  it('does not flag unique keys', () => {
    const result = resolveIdentity({ email: 'bob@x.com' }, index);
    expect(result.ambiguous).toBe(false);
  });
});

describe('client id bridge', () => {
  const bridge = new Map([
    ['cl1', { clientId: 'cl1', emailNorm: 'jane@x.com', phoneLast10: null, nameNorm: 'doe jane' }],
    ['cl-name-only', { clientId: 'cl-name-only', emailNorm: null, phoneLast10: null, nameNorm: 'bob ray' }],
  ]);

  it('expands a client id into identity keys and matches', () => {
    const result = resolveIdentity({ clientId: 'cl1' }, index, bridge);
    expect(result.contactId).toBe('c1');
    expect(result.method).toBe('client_id');
  });

  it('a bridge record with only a name still matches by name', () => {
    const result = resolveIdentity({ clientId: 'cl-name-only' }, index, bridge);
    expect(result.contactId).toBe('c2');
  });

  it('an unknown client id falls back to direct hints', () => {
    const result = resolveIdentity({ clientId: 'nope', email: 'sky@x.com' }, index, bridge);
    expect(result.contactId).toBe('c3');
  });
});
