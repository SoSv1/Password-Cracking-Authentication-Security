import { createHmac, timingSafeEqual } from 'node:crypto';

export class JwtService {
  #key;
  #lifetimeSeconds;

  constructor(config) {
    this.#key = config.jwtSigningKey;
    this.#lifetimeSeconds = config.jwtLifetimeSeconds;
  }

  sign(subject) {
    const issuedAt = Math.floor(Date.now() / 1000);

    const header = this.#encode({ alg: 'HS256', typ: 'JWT' });
    const payload = this.#encode({ sub: subject, iat: issuedAt, exp: issuedAt + this.#lifetimeSeconds });

    const input = `${header}.${payload}`;

    return `${input}.${this.#signature(input).toString('base64url')}`;
  }

  verify(token) {
    try {
      if (typeof token !== 'string' || token.length > 4096) return null;

      const parts = token.split('.');

      if (parts.length !== 3) return null;

      const [headerPart, payloadPart, signaturePart] = parts;
      const header = JSON.parse(this.#decode(headerPart).toString('utf8'));

      if (!header || header.alg !== 'HS256' || header.typ !== 'JWT'
        || Object.keys(header).some((key) => !['alg', 'typ'].includes(key))) return null;

      const signature = this.#decode(signaturePart);
      const expected = this.#signature(`${headerPart}.${payloadPart}`);

      if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;

      const payload = JSON.parse(this.#decode(payloadPart).toString('utf8'));
      const now = Math.floor(Date.now() / 1000);

      if (!payload || typeof payload.sub !== 'string' || !payload.sub
        || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
        || payload.iat > now || payload.exp <= now || payload.exp <= payload.iat) return null;

      return payload;
    } catch {
      return null;
    }
  }

  #encode(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  #decode(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Base64URL.');

    const buffer = Buffer.from(value, 'base64url');

    if (buffer.toString('base64url') !== value) throw new Error('Noncanonical Base64URL.');

    return buffer;
  }

  #signature(input) {
    return createHmac('sha256', this.#key).update(input).digest();
  }
}
