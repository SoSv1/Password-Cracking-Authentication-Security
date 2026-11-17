import { LoginRateLimiter } from './services/loginRateLimiter.js';

class HttpError extends Error {
  constructor(status, code) {
    super(code);

    this.status = status;
    this.code = code;
  }
}

export class HttpRouter {
  #config;
  #auth;
  #jwt;
  #rateLimiter;
  #methods = new Map([
    ['/health', 'GET'],
    ['/api/login', 'POST'],
    ['/api/auth', 'GET'],
    ['/api/admin', 'GET'],
    ['/api/logout', 'POST'],
  ]);

  constructor(config, authService, jwtService) {
    this.#config = config;
    this.#auth = authService;
    this.#jwt = jwtService;

    this.#rateLimiter = new LoginRateLimiter(config);
  }

  async handle(request, response)
  {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');

    try {
      this.#checkOrigin(request, response);

      const path = new URL(request.url, 'http://localhost').pathname;
      const method = this.#methods.get(path);

      if (!method) throw new HttpError(404, 'NOT_FOUND');

      if (request.method === 'OPTIONS') {
        this.#preflight(request, response, method);
        return;
      }

      if (request.method !== method) {
        response.setHeader('Allow', `${method}, OPTIONS`);
        throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      }

      if (path === '/health') return this.#json(response, 200, { ok: true });
      if (path === '/api/login') return await this.#login(request, response);

      if (path === '/api/logout') {
        response.setHeader('Set-Cookie', this.#cookie('', true));
        response.writeHead(204).end();
        return;
      }

      const claims = this.#jwt.verify(this.#readCookie(request));

      if (!claims || claims.sub !== 'admin') throw new HttpError(401, 'UNAUTHORIZED');

      const data = path === '/api/admin' ? { secret: this.#config.adminSecret } : {};

      this.#json(response, 200, { ok: true, ...data });
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;

      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';

      this.#json(response, status, { ok: false, error: { code } });
    }
  }

  #checkOrigin(request, response) {
    const origin = request.headers.origin;

    if (origin && origin !== this.#config.frontendOrigin) throw new HttpError(403, 'ORIGIN_DENIED');

    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', this.#config.frontendOrigin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Reject missing and opaque origins on mutations, including login and logout.
    if (request.method === 'POST' && origin !== this.#config.frontendOrigin) {
      throw new HttpError(403, 'ORIGIN_DENIED');
    }
  }

  #preflight(request, response, method) {
    if (request.headers.origin !== this.#config.frontendOrigin
      || request.headers['access-control-request-method'] !== method) {
      throw new HttpError(403, 'ORIGIN_DENIED');
    }

    const headers = (request.headers['access-control-request-headers'] || '')
      .split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);

    if (headers.some((header) => header !== 'content-type')) throw new HttpError(403, 'ORIGIN_DENIED');

    response.setHeader('Access-Control-Allow-Methods', method);
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
    response.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');

    response.writeHead(204).end();
  }

  async #login(request, response) {
    // Use the socket address, never an untrusted X-Forwarded-For header.
    const retryAfter = this.#rateLimiter.check(request.socket.remoteAddress);

    if (retryAfter) {
      response.setHeader('Retry-After', String(retryAfter));
      throw new HttpError(429, 'TOO_MANY_REQUESTS');
    }

    const body = await this.#readJson(request);

    if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.username !== 'string' || typeof body.password !== 'string'
      || !body.username || body.username.length > 64 || !body.password
      || [...body.password].length > 6) throw new HttpError(400, 'INVALID_INPUT');

    const valid = await this.#auth.verifyCredentials(body.username, body.password);

    if (valid === null) {
      response.setHeader('Retry-After', '1');
      throw new HttpError(429, 'TOO_MANY_REQUESTS');
    }

    if (!valid) throw new HttpError(401, 'INVALID_CREDENTIALS');

    // The stable subject and key deliberately survive credential changes and logout.
    response.setHeader('Set-Cookie', this.#cookie(this.#jwt.sign('admin')));
    this.#json(response, 200, { ok: true });
  }

  #readJson(request) {
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      request.resume();
      throw new HttpError(400, 'INVALID_INPUT');
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let failed = false;

      request.on('data', (chunk) => {
        if (failed) return;

        size += chunk.length;

        if (size > this.#config.bodyLimitBytes) {
          failed = true;
          chunks.length = 0;
          reject(new HttpError(413, 'PAYLOAD_TOO_LARGE'));
          return;
        }

        chunks.push(chunk);
      });

      request.on('end', () => {
        if (failed) return;

        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new HttpError(400, 'INVALID_INPUT'));
        }
      });

      request.on('error', () => reject(new HttpError(400, 'INVALID_INPUT')));
      request.on('aborted', () => reject(new HttpError(400, 'INVALID_INPUT')));
    });
  }

  #readCookie(request) {
    const header = request.headers.cookie;

    if (!header || header.length > 8192) return null;

    const matches = header.split(';').map((part) => part.trim())
      .filter((part) => part.slice(0, part.indexOf('=')) === this.#config.cookieName);

    // Reject ambiguous duplicate cookies and malformed percent encoding.
    if (matches.length !== 1) return null;

    try {
      return decodeURIComponent(matches[0].slice(matches[0].indexOf('=') + 1));
    } catch {
      return null;
    }
  }

  #cookie(token, remove = false) {
    const maxAge = remove ? 0 : this.#config.jwtLifetimeSeconds;
    const expires = remove ? new Date(0) : new Date(Date.now() + maxAge * 1000);

    return `${this.#config.cookieName}=${token}; Path=/; HttpOnly; SameSite=${this.#config.cookieSameSite}`
      + `; Max-Age=${maxAge}; Expires=${expires.toUTCString()}`
      + (this.#config.isProduction ? '; Secure' : '');
  }

  #json(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });

    response.end(JSON.stringify(body));
  }
}
