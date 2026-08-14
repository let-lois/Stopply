# Moving this app to a letlois.com hostname

The code is portable. The infrastructure is not, and that is the whole
difficulty. This is what has to happen and who has to do it.

## The one hard constraint

This app's Pages project and its D1 live in the **All LetLois Domains**
account (`af6cdf4448e16dc7a72f84c3dd7cf7fb`). `letlois.com`, and therefore
`bi.letlois.com`, lives in the **LetLois** account
(`40d6a92830a7cb75278c823f7f1b19a0`).

Cloudflare Pages custom domains are account scoped: a project can only serve a
hostname whose zone is in the same account. Checked rather than assumed, by
listing the zones in both: All LetLois Domains holds 43 zones and `letlois.com`
is not among them.

So the domain cannot simply be pointed here. Something has to move.

## Decide this first: what happens to the existing dashboard

`bi.letlois.com` already serves the BI platform, and its Worker owns four
routes on that hostname:

```
bi.letlois.com/api/*      bi.letlois.com/ingest/*
bi.letlois.com/t.js       bi.letlois.com/t/*
```

**Worker routes take precedence over Pages Functions.** This app serves its own
API from `/api/*`, so if it were put on `bi.letlois.com` the existing Worker
would intercept every one of its API calls and nothing would work. The two
cannot share that hostname.

That leaves two answers, and they are business decisions rather than technical
ones:

**A. A second hostname, both apps running.** Something like
`app.letlois.com`. No collision, nothing existing is touched, and the BI
platform keeps serving Be Clinical, Blue Cactus, Back Nine and TXD Roofing
exactly as it does now. This is the low risk option and the only one that can
be undone by deleting a DNS record.

**B. This app replaces the BI platform on `bi.letlois.com`.** The Worker routes
above are removed and the existing dashboard stops working. Note what that
costs: this app has no advertising module with a live source. Meta, Google Ads,
the GHL webhooks, CSV ingest and click ID attribution are all features of the
platform being replaced, and clients using them would lose them on the day of
the switch. Do not choose this without porting those first.

## Steps

Everything below needs access to the **LetLois** account. The API token in this
sandbox cannot see it, so these are for someone who can, or for me once a token
with that account is available.

### 1. Create the database

```sh
export CLOUDFLARE_ACCOUNT_ID=40d6a92830a7cb75278c823f7f1b19a0
npx wrangler d1 create stopply-platform
```

Copy the `database_id` it prints into `wrangler.toml`, replacing
`700412bd-ef39-47b8-8d00-6d0d0aeb0490`. That line is the only thing in the
repository tied to the old account.

### 2. Import the data

Take the export at the moment you migrate rather than using a stale one, so
nothing logged in between is lost:

```sh
# Against the OLD account, so unset or switch CLOUDFLARE_ACCOUNT_ID first
CLOUDFLARE_ACCOUNT_ID=af6cdf4448e16dc7a72f84c3dd7cf7fb \
  npx wrangler d1 export stopply-platform --remote --output migrate/export.sql

CLOUDFLARE_ACCOUNT_ID=40d6a92830a7cb75278c823f7f1b19a0 \
  npx wrangler d1 execute stopply-platform --remote --file migrate/export.sql
```

A full export is around 90KB and covers all 11 tables, schema included.

**The export is deliberately not committed and is gitignored.** It carries
password hashes, session token hashes and the sealed credential blobs. It
belongs on the machine doing the migration and nowhere else. Delete it when you
are done.

Two tables in it are transient and can be dropped from the file first if you
would rather start clean: `sessions` (everyone signs in again) and
`login_attempts` (rate limit history). Everything else is real: the workspaces,
the users and their password hashes, the field roster, territories, doors,
knocks and the audit trail.

### 3. Create the Pages project and set its secrets

```sh
npx wrangler pages project create stopply-platform --production-branch main
npx wrangler pages secret put CRED_MASTER_KEY   # base64 32 bytes, NEW value
npx wrangler pages secret put TURNSTILE_SECRET  # server half of the keypair
```

`CRED_MASTER_KEY` **must be the same value as the current one** if any
credentials have been stored, because it wraps `credential_refs.sealed`. A new
key leaves those rows unreadable. If nothing has been stored yet, generate a
fresh one.

`TURNSTILE_SECRET` is the moment to stop using Cloudflare's test keypair. Make
a real widget for the new hostname, put its secret here and its site key in
`.env.production` as `VITE_TURNSTILE_SITE_KEY`. The login page currently warns
in amber that the test keys accept any answer; that warning disappears on its
own once a real key is in place.

### 4. Deploy and attach the hostname

```sh
npm run verify
npx wrangler pages deploy dist --project-name stopply-platform --branch main
```

`--branch main` is not optional. Without it the deploy lands as a Preview,
reports success, and production keeps serving whatever was there before.

Then add the custom domain in the Pages dashboard, or:

```sh
npx wrangler pages domain add app.letlois.com --project-name stopply-platform
```

### 5. Check it before telling anyone

- Sign in as a real account, not a demo one.
- Open a client workspace and confirm the funnel and canvass carry real numbers.
- Sign in on a phone at `/field` as a rep.
- Confirm `bi.letlois.com` still works, if you chose option A.

## What is not needed

No code changes beyond the one `database_id` line. Nothing in `src/` or
`server/` names an account, a hostname or a zone. The build output is identical
either way.
