# COMP4537 Password Hackathon — Team prjD5

A minimal static frontend and Node.js backend. No dependencies, database, build system, or deployment configuration. Requires Node.js 22+ and Python 3 for the local static server.

## Run locally

Run commands from the repository root. A private, ignored `backend/.env` was generated during implementation. If it already exists, skip this one-time setup; keeping its signing key preserves existing JWTs.

```bash
cp -n backend/.env.example backend/.env
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = 'backend/.env';
const content = readFileSync(path, 'utf8');
if (content.includes('JWT_SIGNING_KEY=REPLACE_WITH_A_RANDOM_64_CHARACTER_HEX_KEY')) {
  writeFileSync(path, content.replace('JWT_SIGNING_KEY=REPLACE_WITH_A_RANDOM_64_CHARACTER_HEX_KEY',
    `JWT_SIGNING_KEY=${randomBytes(32).toString('hex')}`), { mode: 0o600 });
}
NODE
```

Terminal 1, from the repository root:

```bash
cd backend
npm run dev
```

Terminal 2, from the repository root:

```bash
python3 -m http.server 8080 --bind 127.0.0.1 --directory frontend
```

Open **http://localhost:8080** and log in with **admin / BCIT12**. Use `localhost` consistently: opening the frontend as `127.0.0.1` changes its origin. Stop either server with Ctrl+C. `npm run dev` loads the local `.env`; `npm start` (or `node server.js`) uses environment variables supplied by the process manager and does not require that file. The original `node --env-file=.env server.js` command still works locally. `npm install` is unnecessary.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `frontend/index.html` | Login form |
| `frontend/admin.html` | Protected landing page shell |
| `frontend/page1.html`, `frontend/page2.html` | Protected page shells and shared navigation |
| `frontend/css/style.css` | Minimal styling |
| `frontend/scripts/scripts.js` | `ApiClient` sends credentialed requests; frontend `Application` translates pages and manages login, navigation checks, browser time, and logout; `ApiError` carries API failures |
| `frontend/lang/en/en.js` | `EnglishStrings` contains all frontend wording |
| `backend/server.js` | Backend `Application` initializes services and starts the HTTP server |
| `backend/config/config.js` | `Config` loads and validates environment configuration |
| `backend/services/authService.js` | `AuthService` hashes the configured password with async scrypt and compares credentials in constant time |
| `backend/services/jwtService.js` | `JwtService` signs and validates HS256 JWTs with strict Base64URL, algorithm, signature, and time checks |
| `backend/services/loginRateLimiter.js` | `LoginRateLimiter` bounds login attempts and memory use |
| `backend/httpRouter.js` | `HttpRouter` handles routes, CORS, origin checks, JSON limits, cookies, and protected responses; internal `HttpError` carries safe error codes |
| `backend/package.json`, `backend/.env.example`, `.gitignore` | Runtime metadata, environment template, and private-file exclusions |

The empty root `index.html` was moved into the requested frontend structure. No test files were added.

## Configuration and credential changes

For local development, edit `backend/.env`. On cPanel, edit the Node application environment variables instead:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=BCIT12
ADMIN_SECRET=defaultSecret
```

Change password and secret together, save, then restart the backend once. Passwords must contain 1–6 characters; secrets must contain 1–19 characters and no whitespace. Quote environment values if they contain dotenv syntax such as `#`. Never commit replacement credentials or the signing key.

Keep `JWT_SIGNING_KEY` unchanged. Unexpired tokens keep working after credential changes, username changes, and logout. Logout only deletes the browser cookie; someone holding a copied token retains access until its three-hour expiration. There is deliberately no blacklist or password-based token invalidation.

Backend settings come from environment variables (loaded from `.env` by the local development command); the frontend API URL is the single `apiBaseUrl` constant in `frontend/scripts/scripts.js`. If you change ports, update this constant and/or `FRONTEND_ORIGIN`. The latter must be an exact origin without a trailing slash.

## API

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/login` | JSON username/password; HTTP 200 and HttpOnly JWT cookie, or 401 for incorrect credentials |
| GET | `/api/auth` | HTTP 200 when authenticated, otherwise 401 |
| GET | `/api/admin` | Authenticated JSON containing the current secret |
| POST | `/api/logout` | HTTP 204 and an expired cookie |
| GET | `/health` | Public `{ "ok": true }` |

Successful JSON responses use `{ "ok": true, ... }`; errors use `{ "ok": false, "error": { "code": "..." } }`. Mutations require the configured `Origin` header. OPTIONS validates the requested origin, method, and headers. Wrong methods return 405, unknown routes 404, invalid input 400, disallowed origins 403, bodies over 1 KiB 413, and limited attempts 429 with `Retry-After`. Internal failures return generic 500 responses.

Login overload returns 429 with a short `Retry-After`; slow login bodies return 408. There is no intentional 503 response. Health, authenticated APIs, navigation checks, logout and preflight have no rate quota.

## Login availability and proxy configuration

The protections have separate responsibilities:

1. **Admission:** at most `LOGIN_CONCURRENCY + LOGIN_QUEUE_SIZE` login handlers (28 by default), including uploads, run at once. Excess requests get immediate 429 without reading their bodies. Other endpoints do not use these slots.
2. **Body bounds:** login JSON is at most 1 KiB, with an absolute two-second upload deadline. Declared oversize bodies are rejected before buffering; chunked uploads are checked as data arrives. Rejection drops buffered chunks and stops reading. Unread request bodies get `Connection: close`, allowing Node to flush the response and close rather than drain an unlimited upload. Normal completed requests retain keep-alive. Aborts remove body listeners/timers and release admission slots.
3. **Password work:** at most four asynchronous scrypt operations, plus 24 FIFO waiters. Queue admission expires after one second. Disconnects remove queued work. Running scrypt cannot be cancelled; its slot remains occupied until it finishes. No synchronous password hashing occurs in handlers.
4. **Identified-client quota:** 30 login attempts per fixed 60-second window, including successful and malformed attempts, only when client identity is verified. Twenty legitimate requests fit a fresh allowance with ten retries remaining. This is a guessing deterrent, not a defence against distributed guessing. Window boundaries can permit two allowances close together.
5. **Tracking:** at most 4,096 client entries. Windows expire in insertion order; at most 16 stale entries are cleaned on each identified-client attempt. Existing exhausted entries keep their quota when the map fills. New addresses bypass tracking at capacity, rather than locking unrelated clients out. Crypto/admission bounds still apply. There is no map-wide per-request scan, periodic cleanup timer, blacklist, or logging for every rejection.

Proxy modes must be chosen from verified hosting information:

| Setting | Behaviour |
| --- | --- |
| `LOGIN_CLIENT_IP_MODE=unknown` (default) | An unverified socket address gets no client quota. Bounded admission and crypto work protect resources without a shared-proxy lockout. This also means weaker guessing protection. |
| `LOGIN_CLIENT_IP_MODE=direct` | Use the socket IP only for peers outside the explicitly trusted proxy list. Enable only if sockets really identify external clients. Arbitrary forwarding headers cannot change this identity. |
| `TRUSTED_PROXY_IPS=` (default empty) | Comma-separated exact immediate peer IPs, never assumed cPanel addresses. Adding an address asserts that this trusted proxy **overwrites** `X-Forwarded-For` with exactly one verified external IP. |

For a listed immediate proxy, accept only one syntactically valid XFF address. Missing/malformed values, ports, scoped addresses and appended chains fall back to bounded authentication work without a shared quota. `X-Real-IP` and other headers are always ignored. Canonical IPv6 and IPv4-mapped forms share tracking identities. Listing a proxy that merely appends client-controlled XFF would be unsafe; do not configure it. With multiple proxy hops, the immediate trusted proxy must supply a sanitized single external IP; otherwise retain `unknown` mode. Quotas and queues are per process, and restart resets them.

Environment defaults and validated ranges:

| Variable | Default | Allowed |
| --- | ---: | --- |
| `LOGIN_CONCURRENCY` | 4 | 1–4 |
| `LOGIN_QUEUE_SIZE` | 24 | 0–64 |
| `LOGIN_QUEUE_WAIT_MS` | 1000 | 50–1500 ms |
| `LOGIN_BODY_TIMEOUT_MS` | 2000 | 100–3000 ms |
| `LOGIN_WINDOW_MS` | 60000 | 1000–300000 ms |
| `LOGIN_ATTEMPTS_PER_WINDOW` | 30 | 1–300 |
| `LOGIN_MAX_CLIENTS` | 4096 | 1–10000 |

Keep defaults until measuring the actual host. Four default scrypt jobs can consume roughly 64 MiB of working memory plus Node overhead. A constrained host may need concurrency 1–2; this reduces throughput and can cause queue expiry. Increasing the queue keeps more people waiting and does not create CPU capacity.

The server retains 15-second request, 10-second header and 5-second keep-alive timeouts, a 16 KiB header cap and a 50-header parsing limit. Timeout checks run every second rather than Node's longer default interval. Parser limits/timeouts are resource safeguards, not a promise of sub-five-second responses. Login body deadlines are separate. The request listener contains rejected promises and stream errors without per-request log amplification. Cheap endpoints use bounded-size JWT HMAC verification and never wait for the scrypt queue.

## Verify in a browser

1. Open Developer Tools → Network and Console. Try a wrong password, then `admin` / `BCIT12`; expect 401 then 200 from `/api/login`.
2. Inspect the backend's cookies under Application/Storage. `authToken` should have HttpOnly, Path `/`, SameSite Lax, and about three hours of lifetime. Local HTTP intentionally omits Secure. The JWT is never returned in JSON or placed in web storage.
3. On the landing page confirm `Welcome to Team prjD5, Secret: "defaultSecret", Time: ...`. The time uses the browser's date, timezone, and locale; the secret arrives only from authenticated `/api/admin`.
4. Visit Page 1, Page 2, and Admin Landing Page, then refresh each page. Authentication should persist. Keep Console open to check for frontend errors.
5. Copy the cookie for the assignment's token-lifetime check, then click Logout. The cookie should disappear and the login page should show the logout message. Opening any protected HTML page should redirect to Login.
6. A copied token can still authenticate until expiry. With the token stored privately in a shell variable, run `curl -i --cookie "authToken=$TOKEN" http://localhost:3000/api/auth`; expect 200 after logout. Do not share or commit the token.
7. Change both credential variables, restart once without changing the signing key, and retry the copied token; expect 200. Old credentials should fail and the new credentials should work. Restore the initial values if desired.

Browser redirects hide the static page shells, but backend JWT verification is what protects the secret. All pages recheck authentication on load, refresh, navigation, and browser history cache restoration. API responses disable caching. JavaScript must be enabled.

## Verification performed — November 17, 2026

Tests ran against temporary loopback HTTP servers using the real `server.js`, generated test-only signing keys and Node **v26.13.1**. Node 22 was unavailable here and still needs a smoke test on the host. No production system was contacted. All scripts/output were temporary files outside the repository; no test files or dependencies were added. Timing is client-observed total response time in milliseconds, including connection setup; TTFB was also measured and did not exceed the listed totals. Counts of 401/429 below are expected outcomes, not unexpected errors.

The final full run passed 10,269 assertions (many exercise thousands of unique tracking addresses). Every workload below completed with **zero 500, zero 503 and zero connection failures**. The server remained running and subsequent health checks passed after every load stage.

| Concurrent valid logins | 200 | 401 | 429 | Average ms | p95 ms | Maximum ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 | 12 | 0 | 0 | 48.4 | 71.6 | 71.6 |
| 20 | 20 | 0 | 0 | 69.3 | 113.5 | 113.6 |
| 50 | 28 | 0 | 22 | 57.1 | 166.8 | 167.1 |
| 100 | 28 | 0 | 72 | 31.8 | 140.2 | 162.4 |
| 250 | 28 | 0 | 222 | 28.2 | 102.4 | 168.4 |
| 500 | 32 | 0 | 468 | 33.4 | 56.6 | 188.0 |

More than 28 total successes can occur when slots free while later connections arrive; the simultaneous bound stays 28. Health and authenticated `/api/admin` probes during these bursts all returned 200 (80 probes total). Their worst time was **14.4 ms**, during the 500-login burst.

Mixed workloads rotate evenly through valid login, invalid login, authenticated `/api/admin`, anonymous `/api/auth`, and `/health`:

| Concurrent mixed requests | 200 | 401 | 429 | Average ms | p95 ms | Maximum ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 12 | 8 | 0 | 14.2 | 46.2 | 46.2 |
| 50 | 30 | 20 | 0 | 28.3 | 113.3 | 113.5 |
| 100 | 54 | 34 | 12 | 29.9 | 139.3 | 162.1 |
| 250 | 114 | 64 | 72 | 22.3 | 95.1 | 163.5 |
| 500 | 216 | 116 | 168 | 30.2 | 53.6 | 191.8 |

Short sustained mixed workloads used the same endpoint mix, paced in 20 ms batches, each for two seconds:

| Target requests/sec | Total | 200 | 401 | 429 | Average ms | p95 ms | Maximum ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | 50 | 30 | 20 | 0 | 11.1 | 30.3 | 37.6 |
| 100 | 200 | 120 | 80 | 0 | 9.2 | 22.8 | 29.0 |
| 250 | 500 | 300 | 200 | 0 | 8.9 | 22.2 | 22.5 |
| 500 | 1000 | 591 | 388 | 21 | 41.9 | 154.0 | 160.2 |

Health and valid authenticated post-stage probes all returned 200, at most 0.5 ms. Other executed checks:

- Twenty concurrent incorrect logins: 20 × 401; average 74.8, p95 120.4, max 120.6 ms. Twenty alternating valid/invalid logins: 10 × 200, 10 × 401; average 72.2, p95 118.9, max 119.4 ms.
- 250 concurrent authenticated API requests: 250 × 200; average 12.0, p95 15.1, max 15.5 ms. 250 anonymous API requests: 250 × 401; average 10.4, p95 12.3, max 12.6 ms.
- Correct/incorrect credentials; independent HMAC signature validation; exact three-hour JWT and cookie lifetime; duplicate/malformed cookies; missing, modified, expired, future-issued and malformed JWTs; wrong signing algorithms; 404/405; strict credentialed CORS and OPTIONS; denied/missing origins; logout cookie deletion.
- A copied JWT worked after logout and after **one real process restart** changing password and secret together while preserving the key. Old credentials returned 401, new credentials 200, and the old JWT retrieved the new secret. Production-configured HTTP fixtures issued `__Host-authToken`, HttpOnly, Secure, Path=/, SameSite=None and Max-Age=10800; this verifies headers, not HTTPS browser acceptance.
- Real HTTP proxy cases: one trusted client exhausted its allowance without blocking another client behind the same proxy; untrusted forwarded IPs could not bypass a direct-client quota; unknown shared proxies did not impose a shared quota; forwarded chains and missing values safely used the fallback. Unit checks covered mapped IP equivalence, expired windows, invalid configuration and untrusted scoped addresses.
- Actual async crypto-resource observation: maximum **four** unfinished scrypt jobs; 100 direct service calls admitted 28 and rejected 72. An aborted queued check was removed. With concurrency 1 and a 50 ms queue deadline, 25 calls produced 3 successful checks and 22 expired waiters (latest expiry 51.6 ms).
- A temporary observation accessor on an in-memory copy of the limiter verified **4,096 tracked entries after 10,000 distinct clients**. One cleanup pass removed only 16 expired entries, then inserted one. Production source was not instrumented.
- Chunked oversize upload: 413 delivered before connection close, 0.4 ms. Incomplete body: 408 at 2001.9 ms. Twenty aborted uploads did not crash the server or prevent subsequent login.
- All 28 admission slots held by unfinished uploads: the next login got 429 while `/health` and authenticated `/api/admin` got 200; maximum 1.6 ms. Aborting the uploads restored normal login. Twenty concurrent malformed bodies all returned 400 (max 2.3 ms); twenty oversized bodies all returned 413 (max 1.4 ms).

Earlier exploratory runs exposed connection resets at mixed concurrency 500 (2 in one run, 82 in another). Review found unnecessary bodyless-request closure and a premature `request.destroy()` after responding. The final code limits closure to unread framed bodies and lets Node flush/close normally; the full rerun above had zero resets. These are finite local measurements, not a hosting capacity guarantee or a long-duration soak test.

### Real browser verification

Native Google Chrome was used against `http://localhost:8080` and `http://localhost:3000`. Observed invalid-login feedback, successful redirect to Admin, the required team/secret/browser-time text, navigation to Page 1 and Page 2, refresh on all three protected pages, logout, and anonymous redirects back to Login from all three pages. DevTools storage showed the HttpOnly, Path=/, SameSite=Lax cookie with three-hour expiry. Successful cross-origin login/navigation and loss of access after logout confirmed local cookie acceptance and deletion.

The Console on the refreshed Admin page showed zero messages. The Issues panel displayed one CSP/eval issue without a source location; its origin was not established. No application eval is used. Chrome DevTools also requested its optional `.well-known/appspecific/com.chrome.devtools.json`, which the local static server returned as 404. Production HTTPS, browser cookie restrictions across deployed origins, and host-specific proxy behaviour remain untested.

## Reliability trade-offs and remaining vulnerabilities

Ranked by severity and origin:

1. **Critical — assignment requirement:** any team that logs in with the known initial credentials can copy a JWT and use it for every required protected operation, including reading the changed secret throughout its three-hour lifetime. Password/secret changes and logout cannot remove that access. This fundamentally limits secret confidentiality during Phase 2; it cannot be fixed without changing the rules. Signing-key loss likewise cannot be repaired while preserving issued-token validity. Never regenerate the key during the event.
2. **High — hosting limitation:** bandwidth, connection/backlog/file-descriptor exhaustion, CPU/memory quotas, noisy neighbours, proxy/WAF/provider blocks and process termination can still make the service unavailable or slower than five seconds. Per-process controls do not cap total resources if the host launches several Node workers. Node timers cannot execute promptly when the host itself is stalled. Hosting-level buffering may consume resources before a request reaches this code.
3. **High — assignment plus availability choice:** six-character passwords allow guessing. In unknown-proxy mode or with a full tracking map, rate quotas are intentionally bypassed for unidentifiable/new clients. Bounded scrypt limits throughput/resource use but sustained attackers can occupy login slots indefinitely and legitimate logins may get 429. Distributed clients and window boundaries weaken per-client quotas even when identity is known. Incorrect proxy trust configuration could also allow spoofing.
4. **Medium — inherent HTTP/browser limits:** third-party cookie restrictions can prevent cross-site authentication even with SameSite=None. Use separate HTTPS origins under the same site when possible and test target browsers. Copied bearer tokens can be replayed until expiry as required; HttpOnly reduces script access but does not eliminate theft from a compromised device.
5. **Low — availability/operations trade-off:** no per-request error logging avoids log floods but limits incident diagnosis. Proxy/WAF logs need sampling/rotation. A NAT with verified direct-client mode can still group real users under one external IP, so do not assume per-IP means per-person. A trusted-proxy header failure falls back to weaker guessing protection to preserve availability.

Legitimate users can receive 429 when their verified client allowance is exhausted, all admission/queue slots are occupied, or queue waiting exceeds the short deadline. Slow uploads receive 408. This code does not intentionally emit 503, but the hosting runner/proxy can. Existing authenticated clients never share a login quota. The queue accommodates realistic bursts without keeping thousands of pending requests, but it offers no fairness guarantee against sustained hostile traffic.

## Later cPanel deployment — not performed

Verify each item before the initial assignment check:

- Node.js **22+** (prefer the host's current maintained 22 patch), ESM support in the Node runner, backend application root, startup file **`server.js`**, and the host's required `HOST`/`PORT` or Passenger integration. The code uses a conventional HTTP listener; do not assume an unverified Passenger configuration will work. Test process startup from injected environment variables with no local `.env` dependency. `npm start` is `node server.js`; local development is `npm run dev`.
- Provision separate frontend/backend **HTTPS origins**. Both public URLs must include Team `prjD5` in their hostname or URL path. DNS hostnames are case-insensitive and URL origins normalize them to lowercase; confirm the instructor accepts that spelling, or use an exact `/prjD5/` public path. If the backend is mounted below `/prjD5`, verify the hosting proxy strips that prefix before routing `/api/*` and `/health`, and include the prefix in the frontend API base URL. The backend itself exposes the documented root paths; no public mount prefix is assumed.
- Set `FRONTEND_ORIGIN` to the exact normalized HTTPS origin, **without a path or trailing slash**. Set the frontend's single `apiBaseUrl` constant to the backend HTTPS base (including any verified mount prefix, without a trailing slash). Confirm HTTPS certificates, routing and mixed-content-free requests. The backend never trusts `X-Forwarded-Proto` to decide cookie security; `NODE_ENV=production` sets it explicitly behind HTTPS termination.
- Inject `NODE_ENV=production`, `JWT_SIGNING_KEY`, `ADMIN_USERNAME=admin`, password and secret through private Node application settings. Persist the same private random signing key across workers, credential updates and restarts. Keep the initial verification credentials `admin` / `BCIT12` and secret `defaultSecret` until instructed to change them. Do not print keys or secrets in logs.
- Use production `__Host-authToken`, Secure, HttpOnly, Path=/, no Domain, three-hour JWT/cookie lifetime. Configure `COOKIE_SAME_SITE=None` for different sites; the production default is None. Same-site HTTPS subdomains remain different origins while avoiding many third-party cookie blocks. Test cookie acceptance, CORS preflight, login, refresh/navigation and logout in target browsers; local HTTP is insufficient to prove this.
- Point the public static document root **only at `frontend`**. Keep backend sources, `.env`, repository metadata and private app settings outside public document roots. Confirm direct HTTP requests cannot fetch them. cPanel must serve Node API responses, never backend source files. Review frontend response headers/CSP at the static host if desired without blocking the ES modules or API origin.
- Keep `LOGIN_CLIENT_IP_MODE=unknown` and `TRUSTED_PROXY_IPS=` until the host confirms the immediate proxy IP(s), any extra hops, and a sanitized **overwritten single-address** XFF header. Verify clients cannot spoof it and verify actual socket IPs from private host diagnostics. Do not deploy test IPs or hardcode guesses. If the host only appends chains or behaviour is unknown, retain the bounded-work fallback.
- Verify worker count and per-worker memory/CPU limits, request buffering, provider connection/traffic/WAF limits, and host timeout settings. Measure a small authorized login burst and authenticated/health latency before the event. Avoid disruptive hosted stress tests. Do not lengthen queues to conceal insufficient host capacity.

For the five-minute change window: edit `ADMIN_PASSWORD` (1–6 characters) and `ADMIN_SECRET` (1–19 characters, no whitespace) together in the **injected environment**, preserve `JWT_SIGNING_KEY`, save/apply, and restart at most once. Determine ahead of time whether the cPanel UI automatically restarts on saving so that it does not cause two restarts. Verify health, a copied pre-change JWT against `/api/auth` and `/api/admin`, the new password, and browser refresh. Make no further credential changes/restarts during attacks. The server reads settings once on startup; there is no runtime credential-update endpoint.

## Assignment compliance

- Manual HS256 JWT signing/verification through built-in `crypto`; strict signature and expiration checks unchanged; no JWT/authentication library, Express, database or external service.
- HttpOnly authentication cookies; Secure in production; three-hour JWT **and** cookie lifetime unchanged (more than two hours). The signing key stays independent of the password. Old JWTs survive password/secret/username changes and logout; logout deletes only the browser cookie.
- Initial defaults remain `admin`, `BCIT12`, `defaultSecret`. Login remains a server-side POST; successful login redirects to Admin, invalid credentials show an error. Backend protected endpoints independently verify JWTs.
- Login Team `prjD5`, Admin/Page 1/Page 2 navigation and Logout are retained. The Admin page uses the verified backend secret and the current browser date/time. Anonymous protected-page visits redirect to Login; refresh and navigation preserve authentication.
- Separate frontend/backend HTTPS origins, Team identification in both public URLs, production cookie acceptance and cPanel startup are **prepared but require deployment-time verification**. Nothing has been deployed, pushed, or changed in hosting settings.
- Password/secret environment configuration supports the one-restart five-minute workflow. No revocation, key rotation, token versioning or extra protected-page authentication was introduced. The frontend appearance and page structure are unchanged; only the overload message wording changed.
