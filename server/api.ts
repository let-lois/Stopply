// The whole API surface, on one screen.
//
// Every route the server answers is in this list. That is the point: an
// endpoint cannot appear by adding a file, so reviewing what is reachable
// means reading one table rather than walking a directory.
//
// Each handler begins by resolving the session, then validating the requested
// client against that session's scope, then checking entitlement if it serves
// module data. None of those are middleware that a route can forget to
// declare; they are the first lines of the handler, and a handler that skips
// one has no session variable to use afterwards.

import { createRouter, route } from '@server/router';
import { login, logout, session } from '@server/routes/auth';
import {
  createClient,
  listAudit,
  listClients,
  listTeam,
  setClientDataMode,
  setClientModule,
} from '@server/routes/clients';
import { createCredential, deleteCredential, listCredentials } from '@server/routes/credentials';
import { getFieldSalesData, logVisit } from '@server/routes/fieldSales';
import { fieldDoors, fieldLogVisit, fieldLogin, fieldLogout } from '@server/routes/field';
import {
  assignRep,
  createTerritory,
  deleteTerritory,
  listTerritories,
  updateTerritory,
} from '@server/routes/territories';

export const routes = [
  route('POST', '/api/auth/login', login),
  route('POST', '/api/auth/logout', logout),
  route('GET', '/api/auth/session', session),

  route('GET', '/api/clients', listClients),
  route('POST', '/api/clients', createClient),
  route('PATCH', '/api/clients/:clientId/modules', setClientModule),
  route('PATCH', '/api/clients/:clientId/data-mode', setClientDataMode),

  route('GET', '/api/team', listTeam),
  route('GET', '/api/audit', listAudit),

  route('GET', '/api/credentials', listCredentials),
  route('POST', '/api/credentials', createCredential),
  route('DELETE', '/api/credentials/:id', deleteCredential),

  // Module data. The slug in the path is the module's, so adding a module
  // means adding its routes here deliberately rather than a generic endpoint
  // dispatching on a string from the URL.
  route('GET', '/api/clients/:clientId/field-sales/data', getFieldSalesData),
  route('POST', '/api/clients/:clientId/field-sales/visits', logVisit),

  // Territories, and who works them.
  route('GET', '/api/clients/:clientId/territories', listTerritories),
  route('POST', '/api/clients/:clientId/territories', createTerritory),
  route('PATCH', '/api/clients/:clientId/territories/:territoryId', updateTerritory),
  route('DELETE', '/api/clients/:clientId/territories/:territoryId', deleteTerritory),
  route('PATCH', '/api/clients/:clientId/reps/:repId', assignRep),

  // The rep app. A separate prefix with a separate cookie and a separate
  // session table, so nothing here can reach a client's reporting and nothing
  // above can be reached with a rep's credential.
  route('POST', '/api/field/login', fieldLogin),
  route('POST', '/api/field/logout', fieldLogout),
  route('GET', '/api/field/doors', fieldDoors),
  route('POST', '/api/field/visits', fieldLogVisit),
] as const;

export const dispatch = createRouter(routes);
