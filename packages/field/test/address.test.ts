import { describe, expect, it } from 'vitest';
import { addressKey, distanceMeters, formatAddress, normalizeAddress } from '../src/address';

describe('addressKey', () => {
  it('collapses the ways three reps type the same house', () => {
    const a = addressKey({ street: '123 N. Main Street', city: 'Mesa', state: 'AZ', postalCode: '85201' });
    const b = addressKey({ street: '123 n main st', city: 'mesa', state: 'az', postalCode: '85201' });
    const c = addressKey({ street: '  123   North Main St ', city: 'Mesa', state: 'AZ', postalCode: '85201' });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('keeps different houses on the same street apart', () => {
    const a = addressKey({ street: '123 Main St', postalCode: '85201' });
    const b = addressKey({ street: '125 Main St', postalCode: '85201' });
    expect(a).not.toBe(b);
  });

  it('treats an inline unit and a separate unit field as the same door', () => {
    const inline = addressKey({ street: '400 Oak Ave Apt 12', postalCode: '85201' });
    const separate = addressKey({ street: '400 Oak Ave', unit: '12', postalCode: '85201' });
    const hash = addressKey({ street: '400 Oak Ave #12', postalCode: '85201' });
    expect(separate).toBe(inline);
    expect(hash).toBe(inline);
  });

  it('keeps two units in one building apart', () => {
    const a = addressKey({ street: '400 Oak Ave', unit: '12', postalCode: '85201' });
    const b = addressKey({ street: '400 Oak Ave', unit: '14', postalCode: '85201' });
    expect(a).not.toBe(b);
  });

  it('does not fold a house number that looks like a directional word', () => {
    // "N" as the first token is a house number, not a compass point. Folding
    // it would merge unrelated addresses.
    const a = addressKey({ street: 'North St', postalCode: '85201' });
    const b = addressKey({ street: 'N St', postalCode: '85201' });
    expect(a).not.toBe(b);
  });

  it('prefers the postal code over city spelling', () => {
    const a = addressKey({ street: '123 Main St', city: 'Mesa', postalCode: '85201' });
    const b = addressKey({ street: '123 Main St', city: 'Meza', postalCode: '85201' });
    expect(b).toBe(a);
  });

  it('falls back to city and state when no postal code was captured', () => {
    const mesa = addressKey({ street: '123 Main St', city: 'Mesa', state: 'AZ' });
    const tempe = addressKey({ street: '123 Main St', city: 'Tempe', state: 'AZ' });
    expect(mesa).not.toBe(tempe);
    expect(mesa).toContain('mesa az');
  });

  it('ignores a trailing unit word with no unit after it', () => {
    const a = addressKey({ street: '123 Main St Apt', postalCode: '85201' });
    const b = addressKey({ street: '123 Main St', postalCode: '85201' });
    expect(a).toBe(b);
  });
});

describe('normalizeAddress', () => {
  it('keeps the street as the rep typed it and lifts an inline unit out', () => {
    const n = normalizeAddress({ street: ' 400  Oak Ave Apt 12 ', city: 'Mesa', state: 'az', postalCode: '85201' });
    expect(n.street).toBe('400 Oak Ave Apt 12');
    expect(n.unit).toBe('12');
    expect(n.state).toBe('AZ');
  });

  it('prefers an explicit unit field over one found inline', () => {
    const n = normalizeAddress({ street: '400 Oak Ave Apt 12', unit: 'B' });
    expect(n.unit).toBe('B');
  });

  it('returns null rather than empty strings for blank optional fields', () => {
    const n = normalizeAddress({ street: '123 Main St', city: '  ', state: '', postalCode: null });
    expect(n.city).toBeNull();
    expect(n.state).toBeNull();
    expect(n.postalCode).toBeNull();
  });
});

describe('formatAddress', () => {
  it('renders one line for a report row', () => {
    expect(
      formatAddress({ street: '400 Oak Ave', unit: '12', city: 'Mesa', state: 'AZ', postalCode: '85201' })
    ).toBe('400 Oak Ave #12, Mesa, AZ 85201');
  });

  it('does not leave dangling separators when only a street is known', () => {
    expect(formatAddress({ street: '400 Oak Ave' })).toBe('400 Oak Ave');
  });

  it('does not double the hash on a unit the rep already prefixed', () => {
    expect(formatAddress({ street: '400 Oak Ave', unit: '#12' })).toBe('400 Oak Ave #12');
  });
});

describe('distanceMeters', () => {
  it('measures a short hop down the block', () => {
    const d = distanceMeters({ lat: 33.4152, lng: -111.8315 }, { lat: 33.4161, lng: -111.8315 });
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });

  it('is zero at the same point', () => {
    expect(distanceMeters({ lat: 33.4, lng: -111.8 }, { lat: 33.4, lng: -111.8 })).toBe(0);
  });
});
