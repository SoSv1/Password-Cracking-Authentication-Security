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
node --env-file=.env server.js
```

Terminal 2, from the repository root:

```bash
python3 -m http.server 8080 --bind 127.0.0.1 --directory frontend
```

Open **http://localhost:8080** and log in with **admin / BCIT12**. Use `localhost` consistently: opening the frontend as `127.0.0.1` changes its origin. Stop either server with Ctrl+C. `npm start` inside `backend` is equivalent to the backend command; `npm install` is unnecessary.

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

Edit `backend/.env`:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=BCIT12
ADMIN_SECRET=defaultSecret
```

Change password and secret together, save, then restart the backend once. Passwords must contain 1–6 characters; secrets must contain 1–19 characters and no whitespace. Quote environment values if they contain dotenv syntax such as `#`. Never commit replacement credentials or the signing key.

Keep `JWT_SIGNING_KEY` unchanged. Unexpired tokens keep working after credential changes, username changes, and logout. Logout only deletes the browser cookie; someone holding a copied token retains access until its three-hour expiration. There is deliberately no blacklist or password-based token invalidation.

Backend settings live in `.env`; the frontend API URL is the single `apiBaseUrl` constant in `frontend/scripts/scripts.js`. If you change ports, update this constant and/or `FRONTEND_ORIGIN`. The latter must be an exact origin without a trailing slash.

## API

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/login` | JSON username/password; HTTP 200 and HttpOnly JWT cookie, or 401 for incorrect credentials |
| GET | `/api/auth` | HTTP 200 when authenticated, otherwise 401 |
| GET | `/api/admin` | Authenticated JSON containing the current secret |
| POST | `/api/logout` | HTTP 204 and an expired cookie |
| GET | `/health` | Public `{ "ok": true }` |

Successful JSON responses use `{ "ok": true, ... }`; errors use `{ "ok": false, "error": { "code": "..." } }`. Mutations require the configured `Origin` header. OPTIONS validates the requested origin, method, and headers. Wrong methods return 405, unknown routes 404, invalid input 400, disallowed origins 403, bodies over 1 KiB 413, and limited attempts 429 with `Retry-After`. Internal failures return generic 500 responses.

Login allows ten attempts per socket IP per minute, including successful attempts. At most four async scrypt checks run concurrently. Limits reset on backend restart. Forwarded IP headers are intentionally not trusted.

## Verify in a browser

1. Open Developer Tools → Network and Console. Try a wrong password, then `admin` / `BCIT12`; expect 401 then 200 from `/api/login`.
2. Inspect the backend's cookies under Application/Storage. `authToken` should have HttpOnly, Path `/`, SameSite Lax, and about three hours of lifetime. Local HTTP intentionally omits Secure. The JWT is never returned in JSON or placed in web storage.
3. On the landing page confirm `Welcome to Team prjD5, Secret: "defaultSecret", Time: ...`. The time uses the browser's date, timezone, and locale; the secret arrives only from authenticated `/api/admin`.
4. Visit Page 1, Page 2, and Admin Landing Page, then refresh each page. Authentication should persist. Keep Console open to check for frontend errors.
5. Copy the cookie for the assignment's token-lifetime check, then click Logout. The cookie should disappear and the login page should show the logout message. Opening any protected HTML page should redirect to Login.
6. A copied token can still authenticate until expiry. With the token stored privately in a shell variable, run `curl -i --cookie "authToken=$TOKEN" http://localhost:3000/api/auth`; expect 200 after logout. Do not share or commit the token.
7. Change both credential variables, restart once without changing the signing key, and retry the copied token; expect 200. Old credentials should fail and the new credentials should work. Restore the initial values if desired.

Browser redirects hide the static page shells, but backend JWT verification is what protects the secret. All pages recheck authentication on load, refresh, navigation, and browser history cache restoration. API responses disable caching. JavaScript must be enabled.

## Verification performed

33 inline API checks passed against running local HTTP servers: correct/incorrect login, cookie flags and three-hour expiration, protected routes, explicit credentialed CORS, OPTIONS, missing/expired/future/malformed/tampered JWTs, strict algorithms, malformed/duplicate cookies, origin rejection, input/body limits, 404/405 responses, logout deletion, copied tokens after logout and credential replacement, production cookie attributes, login limits, configuration validation, and response timing. Twenty authenticated requests averaged 0.3 ms on this machine; this is a local smoke measurement, not a load benchmark.

Six additional frontend module checks passed with a minimal DOM stub and live API: translated labels, failed/successful login, password clearing, protected secret and date rendering logic, simulated navigation/refresh and history restoration, logout, anonymous redirects, and absence of unhandled errors. These check JavaScript flow, not real browser rendering or cookie enforcement.

Production cookie headers were checked using production configuration on a temporary local test server; real HTTPS and deployed cross-site browser behavior have not been tested. Browser automation was unavailable and native Chrome access was denied, so rendered login/navigation/refresh behavior, browser cookie acceptance, and browser console errors still need the manual checks above. No browser test is reported as passed.

## Later cPanel deployment

No hosting has been configured or deployed. Later, configure:

- Node.js 22+ runtime, the `backend` application root and `server.js` startup file, host/port integration with cPanel's Node runner, and HTTPS termination.
- Private environment variables, a persistent random signing key, replacement credentials, and the exact HTTPS `FRONTEND_ORIGIN`.
- `NODE_ENV=production` for Secure cookies and the `__Host-authToken` name. Use `COOKIE_SAME_SITE=None` when the frontend and backend are on different sites. No cookie Domain is set.
- The frontend's HTTPS `apiBaseUrl` and static document root pointing only to `frontend`. Never serve the repository root or backend environment files.
- Verify credentialed CORS and cookie acceptance in target browsers. Cross-site cookie restrictions can block even SameSite=None cookies; frontend/backend subdomains under the same site avoid this browser limitation.
- Review the hosting proxy's trusted client-IP mechanism before adapting rate limiting. With the current socket-based limiter, clients behind one proxy may share a limit. In-memory limits are local to each process.
