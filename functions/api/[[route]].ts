// The only Pages Function in this project.
//
// Everything under /api arrives here and is dispatched by server/api.ts.
// Keeping it to one entry means the middleware order is a sequence in one
// file rather than something you reconstruct from which _middleware.ts
// happens to sit in which directory.

import { dispatch } from '@server/api';
import type { Env } from '@server/env';

interface PagesContext {
  request: Request;
  env: Env;
}

export const onRequest = (context: PagesContext): Promise<Response> =>
  dispatch(context.request, context.env);
