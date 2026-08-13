// Session tokens and identifiers.
//
// The token goes in the cookie. Only its SHA-256 is written to the sessions
// table, so a dump of that table is not a set of working logins. This is the
// same reason passwords are not stored either, applied to the credential the
// browser actually presents on every request.

/** 32 bytes of CSPRNG output, base64url. */
export function mintSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The row key for a token. SHA-256 is right here: the input is already high entropy, so there is nothing to slow an attacker down for. */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A prefixed, random identifier for a new row.
 *
 * Sequential ids would leak how many clients exist and let anyone enumerate
 * them by counting, which matters on a platform where the id appears in the
 * URL of every workspace.
 */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}
