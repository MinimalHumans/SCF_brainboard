# Scriptyard OAuth token broker

A stateless PHP endpoint that stands between the browser client and Google's
OAuth token endpoint. It never touches a database or the filesystem for
per-request data — its only persistent state is a config file that lives
outside the web root.

## What it does

- **`POST action=exchange`** — takes a Google authorization `code` (from the
  offline-access consent flow), exchanges it for an access token + refresh
  token, encrypts the refresh token with a server-side key, and returns the
  plain access token plus the *encrypted* refresh token blob.
- **`POST action=refresh`** — takes an encrypted refresh token blob, decrypts
  it server-side, and exchanges it with Google for a fresh access token. The
  refresh token itself is never returned to the client.
- **`GET ?action=health`** — reports whether config was found and which
  crypto backend is active, without leaking any paths or secret values.

The client is responsible for storing the encrypted refresh token blob
locally (e.g. `localStorage`) and presenting it back on `action=refresh`. The
symmetric key that can decrypt it never leaves the server.

## Server setup

**The broker's code lives at `brainboard/public/auth/index.php` and ships
automatically** — Vite copies everything under `public/` into `dist/`
verbatim on every `npm run build`, same as `favicon.ico` and `privacy.html`,
so it's already in `dist.zip` with no extra CI step. `php/deploy/index.php`'s
`extractTo()` then drops it at `<site-root>/auth/index.php` on every push,
same as the rest of the app. This is deliberately unlike `php/deploy/index.php`
itself, which had to be placed on the server manually once — it's what *runs*
the deploy, so it can't deploy itself. The auth broker has no such bootstrap
problem, so it rides the normal pipeline and updates whenever the code
changes, like any other part of the app.

Nothing to upload by hand. The only manual, one-time step is the config file:

1. **Create the config file outside the web root.** Copy
   `php/auth/scriptyard-auth.config.php.example` to your account home
   directory as `~/scriptyard-auth.config.php` (i.e. a sibling of
   `DOCUMENT_ROOT`, not inside it) and fill in real values. The broker walks
   upward from its own directory and also checks `$_SERVER['HOME']` /
   `posix_getpwuid()`'s home, rejecting any candidate that resolves inside
   `DOCUMENT_ROOT` — so as long as the file sits anywhere above the served
   tree, it'll be found. No account username needs to appear in this repo or
   in git history. If prod and dev both live under the same hosting account,
   one shared config file at `~/scriptyard-auth.config.php` serves both
   deployed copies of the broker — the secrets aren't environment-specific.

2. **Generate the encryption key:**

   ```bash
   php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
   ```

   Paste the 64-hex-char output into `encryption_key_hex`.

3. **Fill in `google_client_id` / `google_client_secret`** from Google Cloud
   Console → APIs & Services → Credentials (same project as
   `VITE_GOOGLE_CLIENT_ID`).

4. **Leave `allowed_origins` alone unless you need cross-origin calls.** The
   deployed web app calls `/auth/index.php` on its own domain, which is
   same-origin and needs no CORS header at all. The list only matters for the
   local Vite dev server, or the Tauri desktop build — see the comments in
   the example file.

5. **Verify**, after the next release ships:

   ```bash
   curl https://scriptyard.minimalhumans.com/auth/index.php?action=health
   ```

   Expect `{"status":"ok","config":true,...}`. If `config` is `false`, check
   `config_error` (`config_missing` or `config_invalid`) and the file
   location/permissions — the message never reveals the path it looked in.

`php/auth/README.md` and `php/auth/scriptyard-auth.config.php.example` (this
file and its template) are deliberately *not* under `brainboard/public/` —
only the PHP entrypoint itself ships to the live site. Docs and the config
template staying out of `public/` means they never become publicly
downloadable files on the deployed domain.

## Security notes

- No database, no session, no log line ever contains the code, access token,
  or refresh token. `display_errors` is off and a top-level exception handler
  returns a bare `{"error":"internal_error"}` so a PHP stack trace can never
  leak the account home path.
- The config file must resolve outside `DOCUMENT_ROOT`; the broker actively
  refuses a config file that resolves inside it, even if one is found there.
- Refresh tokens are encrypted with XChaCha20-Poly1305 (libsodium) if
  available, else AES-256-GCM (OpenSSL) — both AEAD, both bound to a fixed
  associated-data string so a blob can't be replayed elsewhere.
- Rotating `encryption_key_hex` invalidates every previously issued blob;
  clients get `400 invalid_payload` and should fall back to interactive
  consent.
- CORS is opt-in per origin via `allowed_origins`; unlisted origins get no
  `Access-Control-Allow-Origin` header and the browser blocks the response.
  The deployed app calling its own domain is same-origin and unaffected by
  this list — it only matters for the local dev server, a separate dev
  subdomain, or the Tauri desktop build.

## Client wiring

`brainboard/src/lib/sync/googleAuth.ts` uses this broker with automatic
failover to Google Identity Services' plain implicit-token flow
(`initTokenClient` + FedCM silent reacquire — the original mechanism, kept
intact) whenever the broker is unset, unreachable, times out, or errors.
Interactive linking tries the broker-backed authorization-code flow
(`initCodeClient`) first for a persistent encrypted refresh token; silent
renewal tries the broker first when one is stored. Either step falls back
seamlessly if the broker is down, so the offline/desktop app keeps working
even when this server-side piece doesn't.

`VITE_AUTH_BROKER_URL` (in `brainboard/.env`, not a secret — safe to commit)
points the client at this broker. Leaving it unset reverts to the pre-broker
implicit-only behavior entirely.
