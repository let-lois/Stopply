// Apple Ads Platform API client (API 1.0, https://api.ads.apple.com/v1).
//
// Read only by construction: the only verbs this file sends are GET and the
// POST /query endpoints, which read. Nothing here creates, changes, pauses or
// deletes a campaign, and nothing should be added that does: LetLois reports
// on Apple Maps ads, it does not manage them.
//
// Auth is OAuth2 client credentials, as Apple documents it in "Implementing
// OAuth for the Apple Ads Platform API":
//   1. sign a client secret, an ES256 JWT, with the API user's private key
//   2. exchange it at appleid.apple.com for a one hour access token
//      (scope searchadsorg)
//   3. send the token as a Bearer token, plus X-AP-Context: adAccountId=<id>
//      on every ad account scoped call
// Because this Worker holds the private key, it mints a fresh secret and
// token per run. Nothing is persisted: no access token is ever written to a
// database, and a 401 mid run mints a new one once before giving up.
//
// Rate limits follow "Applying Rate Limits": read RateLimit-Remaining and
// RateLimit-Reset off every response, wait Retry-After on a 429, double the
// wait on each consecutive 429 up to 16 seconds.

export const APPLE_ADS_API_BASE = 'https://api.ads.apple.com/v1';
export const APPLE_ADS_TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
export const APPLE_ADS_AUDIENCE = 'https://appleid.apple.com';
export const APPLE_ADS_SCOPE = 'searchadsorg';

// What went wrong, in the terms an administrator can act on.
//   auth         the credentials were refused: key revoked or replaced,
//                wrong client/team/key id, or a malformed private key
//   permission   authenticated, but this API user may not see that account
//                or resource, or the account is not an Apple Maps account
//   rate_limited Apple kept answering 429 after the retries ran out
//   not_found    the account or resource does not exist
//   bad_request  Apple rejected the request shape
//   server       Apple answered 5xx after the retries ran out
//   network      the request never got an answer
//   config       something in the saved settings cannot work as entered
export type AppleAdsFailure =
  | 'auth'
  | 'permission'
  | 'rate_limited'
  | 'not_found'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'config';

export class AppleAdsError extends Error {
  readonly failure: AppleAdsFailure;
  readonly status: number | undefined;
  constructor(failure: AppleAdsFailure, message: string, status?: number) {
    super(message);
    this.name = 'AppleAdsError';
    this.failure = failure;
    this.status = status;
  }
}

export interface AppleAdsAuth {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

export interface AppleAdsClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  // Milliseconds since the epoch. Injected so tests control token expiry.
  now?: () => number;
  maxRetries?: number;
  maxBackoffMs?: number;
  // A Retry-After longer than this fails the run instead of holding the
  // Worker open; the next scheduled sync picks the work up again.
  maxWaitMs?: number;
  maxPages?: number;
}

/* ------------------------------------------------------------------ */
/* the client secret                                                   */
/* ------------------------------------------------------------------ */

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(text: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(text));
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}

// id-ecPublicKey with the prime256v1 curve, the AlgorithmIdentifier a PKCS#8
// wrapper needs around an EC key.
const P256_ALGORITHM_ID = [
  0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
];

// OpenSSL's `ecparam -genkey`, the command Apple's guide uses, writes a SEC1
// "EC PRIVATE KEY". Web Crypto only imports PKCS#8, so wrap it:
//   SEQUENCE { INTEGER 0, AlgorithmIdentifier, OCTET STRING { sec1 } }
function sec1ToPkcs8(sec1: Uint8Array): Uint8Array {
  const octet = [0x04, ...derLength(sec1.length), ...sec1];
  const body = [0x02, 0x01, 0x00, ...P256_ALGORITHM_ID, ...octet];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

// The key is pasted into a form, which may flatten its line breaks or turn
// them into literal "\n". Everything between the markers is base64 either
// way, so whitespace is simply dropped.
export function parsePrivateKey(pem: string): { der: Uint8Array; kind: 'pkcs8' | 'sec1' } {
  const text = pem.replace(/\\n/g, '\n').trim();
  const match = /-----BEGIN ((?:EC )?PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(text);
  const body = (match ? match[2]! : text).replace(/\s+/g, '');
  let der: Uint8Array;
  try {
    der = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
  } catch {
    throw new AppleAdsError('config', 'The private key is not a PEM key. Paste the whole private-key.pem, including its BEGIN and END lines.');
  }
  if (der.length < 16 || der[0] !== 0x30) {
    throw new AppleAdsError('config', 'The private key is not a PEM key. Paste the whole private-key.pem, including its BEGIN and END lines.');
  }
  if (match) return { der, kind: match[1] === 'EC PRIVATE KEY' ? 'sec1' : 'pkcs8' };
  // No markers: tell the two apart by structure. SEC1 starts its sequence
  // with INTEGER 1, PKCS#8 with INTEGER 0.
  const lengthBytes = der[1]! & 0x80 ? (der[1]! & 0x7f) + 1 : 1;
  const version = der[1 + lengthBytes + 2];
  return { der, kind: version === 1 ? 'sec1' : 'pkcs8' };
}

async function importSigningKey(pem: string): Promise<CryptoKey> {
  const { der, kind } = parsePrivateKey(pem);
  const pkcs8 = kind === 'sec1' ? sec1ToPkcs8(der) : der;
  try {
    return await crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  } catch {
    throw new AppleAdsError(
      'config',
      'The private key could not be read. Apple Ads needs a prime256v1 (P-256) key, generated as in Apple’s OAuth guide.'
    );
  }
}

// The client secret Apple's guide describes: header {alg ES256, kid keyId},
// claims {sub clientId, iss teamId, aud appleid.apple.com, iat, exp}. Apple
// allows up to 180 days. This one lives an hour, since a new one is minted
// for every run and a short life limits what a leaked one is worth.
export async function signClientSecret(auth: AppleAdsAuth, nowSeconds: number): Promise<string> {
  const key = await importSigningKey(auth.privateKey);
  const header = base64UrlFromString(JSON.stringify({ alg: 'ES256', kid: auth.keyId }));
  const payload = base64UrlFromString(
    JSON.stringify({ sub: auth.clientId, iss: auth.teamId, aud: APPLE_ADS_AUDIENCE, iat: nowSeconds, exp: nowSeconds + 3600 })
  );
  const signingInput = `${header}.${payload}`;
  // Web Crypto's ECDSA output is the raw r||s pair JWS ES256 expects.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

/* ------------------------------------------------------------------ */
/* errors                                                              */
/* ------------------------------------------------------------------ */

// Error text ends up on screens and in sync history. Apple's own code and
// message are what an administrator needs, but nothing that could be a
// token is allowed through, and the length is bounded.
export function sanitizeMessage(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_\-+/=.~]{40,}/g, '[redacted]')
    .slice(0, 300);
}

interface AppleErrorBody {
  error?: { code?: string; message?: string | null; details?: Array<{ code?: string; message?: string | null }> } | string;
  error_description?: string;
}

async function errorSummary(res: Response): Promise<string> {
  let body: AppleErrorBody | null = null;
  try {
    body = (await res.json()) as AppleErrorBody;
  } catch {
    return `HTTP ${res.status}`;
  }
  if (!body) return `HTTP ${res.status}`;
  if (typeof body.error === 'string') {
    return sanitizeMessage([body.error, body.error_description].filter(Boolean).join(': '));
  }
  const e = body.error;
  if (!e) return `HTTP ${res.status}`;
  const details = (e.details ?? [])
    .map((d) => [d.code, d.message].filter(Boolean).join(' '))
    .filter(Boolean)
    .slice(0, 3);
  const head = [e.code, e.message].filter(Boolean).join(': ');
  return sanitizeMessage([head || `HTTP ${res.status}`, ...details].join(' | '));
}

function classify(status: number, summary: string): AppleAdsError {
  if (status === 401) {
    return new AppleAdsError(
      'auth',
      `Apple refused the access token (${summary}). The API user may have been removed or its public key replaced. Re-enter the credentials from Account Settings > API.`,
      status
    );
  }
  if (status === 403) {
    return new AppleAdsError(
      'permission',
      `Apple says this API user is not allowed to read that (${summary}). Ask an Apple Ads account administrator to give the API user a role on this ad account; API Account Read Only is enough.`,
      status
    );
  }
  if (status === 404) return new AppleAdsError('not_found', `Apple could not find that resource (${summary}).`, status);
  if (status === 429) return new AppleAdsError('rate_limited', `Apple Ads rate limit reached (${summary}). The next scheduled sync will try again.`, status);
  if (status >= 500) return new AppleAdsError('server', `Apple Ads is having trouble (${summary}). The next scheduled sync will try again.`, status);
  return new AppleAdsError('bad_request', `Apple rejected the request (${summary}).`, status);
}

/* ------------------------------------------------------------------ */
/* the client                                                          */
/* ------------------------------------------------------------------ */

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
}

export interface ResponsePagination {
  offset?: number;
  pageSize?: number;
  totalCount?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function headerSeconds(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export class AppleAdsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly maxBackoffMs: number;
  private readonly maxWaitMs: number;
  private readonly maxPages: number;
  private cached: { token: string; expiresAt: number } | null = null;
  // How many access tokens this client has minted. Read by tests.
  tokensIssued = 0;

  constructor(
    private readonly auth: AppleAdsAuth,
    private readonly adAccountId: string | null,
    options: AppleAdsClientOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
    this.maxRetries = options.maxRetries ?? 5;
    this.maxBackoffMs = options.maxBackoffMs ?? 16_000;
    this.maxWaitMs = options.maxWaitMs ?? 60_000;
    this.maxPages = options.maxPages ?? 50;
  }

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.token;
    const secret = await signClientSecret(this.auth, Math.floor(this.now() / 1000));
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.auth.clientId,
      client_secret: secret,
      scope: APPLE_ADS_SCOPE,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(APPLE_ADS_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      throw new AppleAdsError('network', 'Could not reach appleid.apple.com to authenticate.');
    }
    if (!res.ok) {
      const summary = await errorSummary(res);
      if (res.status >= 500) throw classify(res.status, summary);
      throw new AppleAdsError(
        'auth',
        `Apple did not accept the API credentials (${summary}). Check the client ID, team ID, key ID and private key, and that the matching public key is still uploaded in Account Settings > API.`,
        res.status
      );
    }
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!json.access_token) throw new AppleAdsError('auth', 'Apple answered the token request without an access token.');
    this.tokensIssued += 1;
    const lifetime = (json.expires_in ?? 3600) * 1000;
    // Renew a minute early so a token never expires between the check and
    // the call it authorises.
    this.cached = { token: json.access_token, expiresAt: this.now() + Math.max(0, lifetime - 60_000) };
    return json.access_token;
  }

  // account: the ad account the call is scoped to (X-AP-Context), or null
  // for the few org level reads Apple serves without one (/me, /acls).
  async get<T>(path: string, account: string | null = this.adAccountId): Promise<T> {
    return this.send<T>('GET', path, undefined, account, path === '/me' || path === '/acls');
  }

  // POST is used only for Apple's /query endpoints, which read.
  async query<T>(path: string, body: unknown, account: string | null = this.adAccountId): Promise<T> {
    if (!/\/query$/.test(path)) throw new AppleAdsError('config', 'Only query endpoints may be POSTed to. This integration is read only.');
    return this.send<T>('POST', path, body, account, false);
  }

  private async send<T>(method: 'GET' | 'POST', path: string, body: unknown, account: string | null, unscoped: boolean): Promise<T> {
    if (!unscoped && !account) throw new AppleAdsError('config', 'No ad account selected.');
    let wait = 2000;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.token();
      const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
      if (!unscoped && account) headers['x-ap-context'] = `adAccountId=${account}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      let res: Response;
      try {
        res = await this.fetchImpl(`${APPLE_ADS_API_BASE}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        if (attempt < this.maxRetries) {
          await this.sleep(wait);
          wait = Math.min(wait * 2, this.maxBackoffMs);
          continue;
        }
        throw new AppleAdsError('network', 'Could not reach api.ads.apple.com.');
      }

      if (res.status === 429) {
        if (attempt >= this.maxRetries) throw classify(429, await errorSummary(res));
        const told = headerSeconds(res, 'retry-after') ?? headerSeconds(res, 'ratelimit-reset');
        const ms = told !== null ? told * 1000 : wait;
        if (ms > this.maxWaitMs) throw classify(429, `asked to wait ${Math.round(ms / 1000)}s`);
        await this.sleep(ms);
        wait = Math.min(wait * 2, this.maxBackoffMs);
        continue;
      }
      // An access token can be revoked inside its hour. Mint one new token
      // and try once more; a second 401 is a real refusal.
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        this.cached = null;
        continue;
      }
      if (res.status >= 500 && attempt < this.maxRetries) {
        await this.sleep(wait);
        wait = Math.min(wait * 2, this.maxBackoffMs);
        continue;
      }
      if (!res.ok) throw classify(res.status, await errorSummary(res));

      let json: T;
      try {
        json = (await res.json()) as T;
      } catch {
        throw new AppleAdsError('server', 'Apple Ads answered with something that is not JSON.');
      }
      // Pace before the window runs out rather than after a 429.
      const remaining = headerSeconds(res, 'ratelimit-remaining');
      const reset = headerSeconds(res, 'ratelimit-reset');
      if (remaining !== null && reset !== null && remaining < 5) {
        await this.sleep(Math.min(reset * 1000, this.maxWaitMs));
      }
      return json;
    }
  }

  // Every page of a report. Report rows live in result.rows; an empty
  // result comes back as {} rather than {rows: []}.
  async reportRows<R>(path: string, request: Record<string, unknown>, pageSize = 1000): Promise<R[]> {
    const rows: R[] = [];
    let offset = 0;
    for (let page = 0; page < this.maxPages; page++) {
      const res = await this.query<{ result?: { rows?: R[] }; pagination?: ResponsePagination }>(path, {
        ...request,
        pagination: { offset, pageSize },
      });
      const got = res.result?.rows ?? [];
      rows.push(...got);
      offset += got.length;
      const total = res.pagination?.totalCount;
      if (got.length < pageSize || (typeof total === 'number' && offset >= total)) return rows;
    }
    throw new AppleAdsError('server', `Stopped after ${this.maxPages} pages of ${path}. The report is larger than this sync expects.`);
  }

  // Every page of an entity query, whose result is the array itself.
  async queryAll<E>(path: string, request: Record<string, unknown>, pageSize = 1000): Promise<E[]> {
    const out: E[] = [];
    let offset = 0;
    for (let page = 0; page < this.maxPages; page++) {
      const res = await this.query<{ result?: E[]; pagination?: ResponsePagination }>(path, {
        ...request,
        pagination: { offset, pageSize },
      });
      const got = Array.isArray(res.result) ? res.result : [];
      out.push(...got);
      offset += got.length;
      const total = res.pagination?.totalCount;
      if (got.length < pageSize || (typeof total === 'number' && offset >= total)) return out;
    }
    throw new AppleAdsError('server', `Stopped after ${this.maxPages} pages of ${path}.`);
  }
}
