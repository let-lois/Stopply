import { MODULE_ORDER, MODULE_REGISTRY, defaultViewFor, getModule } from '@/modules/registry';
import { MODULE_IDS, type ModuleId } from '@/types';
import { ACCENT_TOKENS } from '@/types/accent';

describe('MODULE_REGISTRY', () => {
  it('covers every module id', () => {
    expect(Object.keys(MODULE_REGISTRY).sort()).toEqual([...MODULE_IDS].sort());
    expect([...MODULE_ORDER].sort()).toEqual([...MODULE_IDS].sort());
  });

  it('gives every module a defaultView that actually exists', () => {
    // The prototype's defaultRoute values used a different vocabulary from
    // its real routes, so none of them resolved. This is the assertion that
    // would have caught it.
    for (const id of MODULE_IDS) {
      const def = MODULE_REGISTRY[id];
      expect(Object.keys(def.views)).toContain(def.defaultView);
    }
  });

  it('uses a real accent token for every module', () => {
    for (const id of MODULE_IDS) {
      expect(ACCENT_TOKENS).toContain(MODULE_REGISTRY[id].accent);
    }
  });

  it('gives analytics its own colour', () => {
    // The prototype's inline ternary fell through to purple for both crm and
    // analytics, so analytics rendered a colour its registry never specified.
    expect(MODULE_REGISTRY.analytics.accent).toBe('rose');
    expect(MODULE_REGISTRY.crm.accent).not.toBe(MODULE_REGISTRY.analytics.accent);
  });

  it('gives every module a real icon component, not a name', () => {
    for (const id of MODULE_IDS) {
      expect(typeof MODULE_REGISTRY[id].Icon).not.toBe('string');
    }
  });
});

describe('getModule', () => {
  it('resolves a known module', () => {
    expect(getModule('crm')?.name).toBe('CRM');
  });

  it('returns undefined for an unknown one rather than lying about it', () => {
    expect(getModule('field_dashbord')).toBeUndefined();
  });
});

describe('defaultViewFor', () => {
  it('picks the first enabled module in nav order', () => {
    expect(defaultViewFor(['crm', 'advertising'])).toEqual({
      moduleId: 'advertising',
      viewId: 'dashboard',
    });
  });

  it('respects a client that only has a later module', () => {
    expect(defaultViewFor(['analytics'])).toEqual({ moduleId: 'analytics', viewId: 'overview' });
  });

  it('returns undefined for a client with nothing enabled', () => {
    expect(defaultViewFor([] as ModuleId[])).toBeUndefined();
  });
});
