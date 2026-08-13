import type { PlatformUser } from '@/types';
import { can } from '@/lib/auth/useCan';

function user(over: Partial<PlatformUser> = {}): PlatformUser {
  return {
    id: 'u1', name: 'Test', email: 't@example.invalid',
    role: 'representative', clientId: null, status: 'active', ...over,
  };
}

describe('can', () => {
  it('lets a super admin manage credentials', () => {
    expect(can(user({ role: 'super_admin' }), 'credentials.manage')).toBe(true);
  });

  it('refuses a representative the things the prototype let them keep', () => {
    // Switching to representative there changed one label while the user
    // retained the credentials page, the team page, and every client.
    const rep = user({ role: 'representative' });
    expect(can(rep, 'credentials.view')).toBe(false);
    expect(can(rep, 'team.invite')).toBe(false);
    expect(can(rep, 'client.viewAll')).toBe(false);
  });

  it('still lets a representative do their job', () => {
    expect(can(user({ role: 'representative' }), 'field.logVisit')).toBe(true);
  });

  it('scopes a client admin to their own workspace', () => {
    const admin = user({ role: 'client_admin', clientId: 'cl_a' });
    expect(can(admin, 'client.configure', { clientId: 'cl_a' })).toBe(true);
    expect(can(admin, 'client.configure', { clientId: 'cl_b' })).toBe(false);
  });

  it('lets a platform-wide user act on any workspace', () => {
    const root = user({ role: 'super_admin', clientId: null });
    expect(can(root, 'client.configure', { clientId: 'cl_anything' })).toBe(true);
  });

  it('does not let a client admin create clients', () => {
    expect(can(user({ role: 'client_admin', clientId: 'cl_a' }), 'client.create')).toBe(false);
  });
});
