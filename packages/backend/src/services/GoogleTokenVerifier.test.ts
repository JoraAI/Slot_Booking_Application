import { test, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { googleTokenVerifier } from './GoogleTokenVerifier';

/**
 * Google ID-token verification: self-signed RS256 JWT + injected JWKS, so the
 * signature path is exercised without hitting Google's live endpoints.
 */

const originalClientId = process.env.GOOGLE_CLIENT_ID;

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}

function makeJwt(header: any, payload: any, privateKey: crypto.KeyObject): string {
  const h = b64u(Buffer.from(JSON.stringify(header)));
  const p = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey);
  return `${h}.${p}.${b64u(sig)}`;
}

function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pub = publicKey.export({ format: 'jwk' });
  return { publicKey, privateKey, jwk: { kid: 'test-kid-1', kty: 'RSA', alg: 'RS256', n: pub.n, e: pub.e } };
}

after(() => {
  process.env.GOOGLE_CLIENT_ID = originalClientId;
  googleTokenVerifier.setJwksFetcher(null);
});

test('GTV-1. Valid Google credential verifies (issuer, audience, signature, verified email)', async () => {
  const { privateKey, jwk } = makeKeyPair();
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  googleTokenVerifier.setJwksFetcher(async () => [jwk]);

  const now = Math.floor(Date.now() / 1000);
  const token = makeJwt(
    { alg: 'RS256', kid: 'test-kid-1', typ: 'JWT' },
    { iss: 'accounts.google.com', aud: 'test-client.apps.googleusercontent.com', sub: 'sub-abc', email: 'owner@test.com', email_verified: true, name: 'Test Owner', iat: now - 10, exp: now + 3600 },
    privateKey
  );

  const user = await googleTokenVerifier.verifyCredential(token);
  assert.strictEqual(user.sub, 'sub-abc');
  assert.strictEqual(user.email, 'owner@test.com');
  assert.strictEqual(user.emailVerified, true);
  assert.strictEqual(user.name, 'Test Owner');
});

test('GTV-2. Rejects wrong audience / unverified email / bad signature / missing client id', async () => {
  const { privateKey, jwk } = makeKeyPair();
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  googleTokenVerifier.setJwksFetcher(async () => [jwk]);
  const now = Math.floor(Date.now() / 1000);

  const base = {
    iss: 'accounts.google.com',
    aud: 'test-client.apps.googleusercontent.com',
    sub: 'sub-abc',
    email: 'owner@test.com',
    email_verified: true,
    iat: now - 10,
    exp: now + 3600,
  };

  await assert.rejects(
    () => googleTokenVerifier.verifyCredential(makeJwt({ alg: 'RS256', kid: 'test-kid-1' }, { ...base, aud: 'other-app' }, privateKey)),
    /audience/
  );
  await assert.rejects(
    () => googleTokenVerifier.verifyCredential(makeJwt({ alg: 'RS256', kid: 'test-kid-1' }, { ...base, email_verified: false }, privateKey)),
    /email is not verified/
  );

  const tampered = makeJwt({ alg: 'RS256', kid: 'test-kid-1' }, base, privateKey);
  const [h, p] = tampered.split('.');
  const badSig = `${h}.${p}.${b64u(Buffer.from('c2lnbmF0dXJl'))}`;
  await assert.rejects(() => googleTokenVerifier.verifyCredential(badSig), /signature verification failed/);

  await assert.rejects(
    () => googleTokenVerifier.verifyCredential(makeJwt({ alg: 'RS256', kid: 'missing-kid' }, base, privateKey)),
    /signing key not found/
  );

  // Expired token.
  await assert.rejects(
    () => googleTokenVerifier.verifyCredential(makeJwt({ alg: 'RS256', kid: 'test-kid-1' }, { ...base, exp: now - 60 }, privateKey)),
    /expired/
  );
});

test('GTV-3. Fails closed when GOOGLE_CLIENT_ID is missing', async () => {
  const { privateKey, jwk } = makeKeyPair();
  process.env.GOOGLE_CLIENT_ID = '';
  googleTokenVerifier.setJwksFetcher(async () => [jwk]);
  const now = Math.floor(Date.now() / 1000);
  const token = makeJwt(
    { alg: 'RS256', kid: 'test-kid-1' },
    { iss: 'accounts.google.com', aud: 'whatever', sub: 's', email: 'a@b.com', email_verified: true, iat: now - 10, exp: now + 3600 },
    privateKey
  );
  await assert.rejects(() => googleTokenVerifier.verifyCredential(token), /GOOGLE_CLIENT_ID missing/);
});
