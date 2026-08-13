// API paths, built rather than written.
//
// The same argument as src/types/routes.ts, applied to the other set of
// strings in this codebase. These have to agree with server/api.ts, and the
// way to keep them agreeing is for there to be one place each is spelled.

export const apiPaths = {
  login: () => '/api/auth/login',
  logout: () => '/api/auth/logout',
  session: () => '/api/auth/session',

  clients: () => '/api/clients',
  clientModules: (clientId: string) => `/api/clients/${encodeURIComponent(clientId)}/modules`,
  clientDataMode: (clientId: string) => `/api/clients/${encodeURIComponent(clientId)}/data-mode`,

  team: () => '/api/team',
  audit: (limit?: number) => (limit ? `/api/audit?limit=${limit}` : '/api/audit'),

  credentials: () => '/api/credentials',
  credential: (id: string) => `/api/credentials/${encodeURIComponent(id)}`,

  fieldSalesData: (clientId: string) =>
    `/api/clients/${encodeURIComponent(clientId)}/field-sales/data`,
  fieldSalesVisits: (clientId: string) =>
    `/api/clients/${encodeURIComponent(clientId)}/field-sales/visits`,
} as const;
