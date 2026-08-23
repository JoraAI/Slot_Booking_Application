import crypto from 'crypto';

/**
 * Server-side Google ID token (credential) verification for GIS sign-in, using
 * Node's crypto + Google's published JWKS. No extra dependency.
 * Fails closed: missing GOOGLE_CLIENT_ID, bad signature, wrong audience, or
 * unverified email → rejected. JWKS cached in-process for 1 hour.
 */

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string };
type VerifiedGoogleUser = { sub: string; email: string; emailVerified: boolean; name?: string };

class GoogleTokenVerifier {
  private jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
  private jwksFetch: (() => Promise<Jwk[]>) | null = null;

  /** Test hook: replace the JWKS fetcher. */
  setJwksFetcher(fn: (() => Promise<Jwk[]>) | null) {
    this.jwksCache = null;
    this.jwksFetch = fn;
  }

  private async getJwks(): Promise<Jwk[]> {
    if (this.jwksCache && Date.now() - this.jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
      return this.jwksCache.keys;
    }
    let keys: Jwk[];
    if (this.jwksFetch) {
      keys = await this.jwksFetch();
    } else {
      const res = await fetch(GOOGLE_JWKS_URL);
      if (!res.ok) throw new Error('Could not fetch Google signing keys');
      const body: any = await res.json();
      keys = Array.isArray(body?.keys) ? body.keys : [];
    }
    this.jwksCache = { keys, fetchedAt: Date.now() };
    return keys;
  }

  private base64UrlDecode(value: string): Buffer {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }

  private jwkToPem(jwk: Jwk): string {
    if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new Error('Unsupported Google signing key');
    const n = this.base64UrlDecode(jwk.n);
    const e = this.base64UrlDecode(jwk.e);
    const spki = buildRsaPublicKeyDer(n, e);
    return `-----BEGIN PUBLIC KEY-----\n${spki.toString('base64').match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
  }

  /** Verify a Google ID token (credential). Throws on any failure. */
  async verifyCredential(credential: string): Promise<VerifiedGoogleUser> {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!clientId) {
      throw new Error('Google sign-in is not configured (GOOGLE_CLIENT_ID missing)');
    }
    if (!credential || typeof credential !== 'string') throw new Error('Missing Google credential');

    const parts = credential.split('.');
    if (parts.length !== 3) throw new Error('Invalid Google credential');

    let header: any;
    let payload: any;
    try {
      header = JSON.parse(this.base64UrlDecode(parts[0]).toString('utf8'));
      payload = JSON.parse(this.base64UrlDecode(parts[1]).toString('utf8'));
    } catch {
      throw new Error('Invalid Google credential');
    }

    const keys = await this.getJwks();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('Google signing key not found');

    const publicKey = this.jwkToPem(jwk);
    const signature = this.base64UrlDecode(parts[2]);
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const valid = crypto.verify('RSA-SHA256', data, publicKey, signature);
    if (!valid) throw new Error('Google credential signature verification failed');

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < nowSec) throw new Error('Google credential expired');
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 60) throw new Error('Google credential issued in the future');
    const issOk = payload.iss === 'accounts.google.com' || payload.iss === 'https://accounts.google.com';
    if (!issOk) throw new Error('Google credential issuer mismatch');
    if (payload.aud !== clientId) throw new Error('Google credential audience mismatch');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Google credential missing subject');
    if (typeof payload.email !== 'string' || !payload.email) throw new Error('Google credential missing email');
    if (payload.email_verified !== true) throw new Error('Google email is not verified');

    return {
      sub: payload.sub,
      email: String(payload.email).trim().toLowerCase(),
      emailVerified: true,
      ...(typeof payload.name === 'string' && payload.name ? { name: payload.name } : {}),
    };
  }
}

/**
 * Build an SPKI DER for an RSA public key from modulus (n) and exponent (e).
 */
function buildRsaPublicKeyDer(n: Buffer, e: Buffer): Buffer {
  const bitString = encodeTlv(0x02, n); // INTEGER modulus
  const exp = encodeTlv(0x02, e); // INTEGER exponent
  const rsaKey = encodeTlv(0x30, Buffer.concat([bitString, exp])); // SEQUENCE
  const algoId = Buffer.from('300d06092a864886f70d0101010500', 'hex'); // rsaEncryption
  const pubKey = encodeTlv(0x03, Buffer.concat([Buffer.from([0x00]), rsaKey])); // BIT STRING
  return encodeTlv(0x30, Buffer.concat([algoId, pubKey])); // SEQUENCE (SPKI)
}

function encodeTlv(tag: number, value: Buffer): Buffer {
  const length = value.length;
  let lengthBytes: Buffer;
  if (length < 0x80) {
    lengthBytes = Buffer.from([length]);
  } else {
    const hex = length.toString(16);
    const padded = hex.length % 2 ? `0${hex}` : hex; // even-length hex: 0x100 → '0100'
    const lenBuf = Buffer.from(padded, 'hex');
    lengthBytes = Buffer.concat([Buffer.from([0x80 | lenBuf.length]), lenBuf]);
  }
  return Buffer.concat([Buffer.from([tag]), lengthBytes, value]);
}

export const googleTokenVerifier = new GoogleTokenVerifier();
