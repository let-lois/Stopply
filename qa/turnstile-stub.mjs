// A stand-in for Cloudflare's Turnstile verifier, for local runs only.
//
// The build sandbox cannot reach challenges.cloudflare.com, and the server
// correctly refuses every write when the verifier is unreachable. That is the
// behaviour we want, and it also means the signed-in half of the API cannot
// be exercised locally without something to answer.
//
// This answers. It accepts a token and reports success unless the token is
// the literal string "fail", which lets the harness check both directions.
// server/turnstile.ts only consults TURNSTILE_VERIFY_URL outside production,
// so nothing here can affect the deployed service.

import { createServer } from 'node:http';

const port = Number(process.env.STUB_PORT ?? 8799);

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const success = !body.includes('name="response"\r\n\r\nfail');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(success ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] })
    );
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`turnstile stub on http://127.0.0.1:${port}`);
});
