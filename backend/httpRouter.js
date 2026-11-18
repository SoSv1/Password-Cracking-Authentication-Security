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
  #pendingLogins = 0;
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

      if (path !== '/api/login') this.#closeUnread(request, response);

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

      this.#closeUnread(request, response);
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
    const retryAfter = this.#rateLimiter.check(request);

    if (retryAfter) {
      response.setHeader('Retry-After', String(retryAfter));
      throw new HttpError(429, 'TOO_MANY_REQUESTS');
    }

    // Reserve before reading bodies: even slow uploads cannot create unbounded waiters.
    if (this.#pendingLogins >= this.#config.loginConcurrency + this.#config.loginQueueSize) {
      response.setHeader('Retry-After', '1');
      throw new HttpError(429, 'TOO_MANY_REQUESTS');
    }

    this.#pendingLogins += 1;
    const controller = new AbortController();
    const abort = () => controller.abort();
    response.once('close', abort);

    try {
      const body = await this.#readJson(request);

      if (!body || typeof body !== 'object' || Array.isArray(body)
        || typeof body.username !== 'string' || typeof body.password !== 'string'
        || !body.username || body.username.length > 64 || !body.password
        || [...body.password].length > 6) throw new HttpError(400, 'INVALID_INPUT');

      const valid = await this.#auth.verifyCredentials(body.username, body.password, controller.signal);

      if (response.destroyed) return;

      if (valid === null) {
        response.setHeader('Retry-After', '1');
        throw new HttpError(429, 'TOO_MANY_REQUESTS');
      }

      if (!valid) throw new HttpError(401, 'INVALID_CREDENTIALS');

      // The stable subject and key deliberately survive credential changes and logout.
      response.setHeader('Set-Cookie', this.#cookie(this.#jwt.sign('admin')));
      this.#json(response, 200, { ok: true });
    } finally {
      response.off('close', abort);
      this.#pendingLogins -= 1;
    }
  }

  #readJson(request) {
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new HttpError(400, 'INVALID_INPUT');
    }

    if (Number(request.headers['content-length']) > this.#config.bodyLimitBytes) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const finish = (error, body) => {
        clearTimeout(timer);
        request.off('data', onData);
        request.off('end', onEnd);
        request.off('error', onError);
        request.off('aborted', onError);
        chunks.length = 0;

        if (error) {
          request.pause();
          reject(error);
        } else resolve(body);
      };

      const onData = (chunk) => {
        size += chunk.length;

        if (size > this.#config.bodyLimitBytes) {
          finish(new HttpError(413, 'PAYLOAD_TOO_LARGE'));
          return;
        }

        chunks.push(chunk);
      };

      const onEnd = () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          finish(null, body);
        } catch {
          finish(new HttpError(400, 'INVALID_INPUT'));
        }
      };
      const onError = () => finish(new HttpError(400, 'INVALID_INPUT'));
      // Absolute body deadline, not an idle timeout that slow trickles can extend.
      const timer = setTimeout(() => finish(new HttpError(408, 'REQUEST_TIMEOUT')),
        this.#config.loginBodyTimeoutMs);

      request.on('data', onData);
      request.once('end', onEnd);
      request.once('error', onError);
      request.once('aborted', onError);

      if (request.destroyed) onError();
    });
  }

  #closeUnread(request, response) {
    const hasBody = request.headers['transfer-encoding'] || Number(request.headers['content-length']) > 0;

    if (request.readableEnded || !hasBody) return;

    // Send the error first, then close; never drain an unlimited rejected upload.
    request.pause();
    response.setHeader('Connection', 'close');
    response.shouldKeepAlive = false;
    // Node closes after flushing a Connection: close response; an immediate destroy
    // here could reset the socket before the client receives the error.
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
