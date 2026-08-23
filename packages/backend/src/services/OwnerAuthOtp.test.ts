import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { notificationService } from './NotificationService';
import { ownerAuthOtpService } from './OwnerAuthOtpService';
import { googleTokenVerifier } from './GoogleTokenVerifier';
import { ownerRouter } from '../routes/owner';
import { publicRouter } from '../routes/public';
import { hashOwnerPassword } from './OwnerPassword';

/**
 * Owner Google Sign-In + email OTP (signup + forgot-password) tests.
 */

let server: any;
let baseUrl: string;
const createdBusinessIds: string[] = [];
const sentOtps: Array<{ email: string; code: string }> = [];

const originalSendOtp = (notificationService as any).sendOtpEmail;
const originalVerifyCredential = (googleTokenVerifier as any).verifyCredential;
const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;

async function makeBusiness(overrides: any = {}) {
  const tag = crypto.randomBytes(4).toString('hex');
  const b = await prisma.business.create({
    data: {
      name: `OwnerAuth ${tag}`,
      slug: `ownerauth-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `ownerauth-${tag}@test.com`,
      ownerPassword: await hashOwnerPassword('password123'),
      slotGranularityMinutes: 15,
      workingHours: {
        create: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i, openTime: '09:00', closeTime: '18:00', isOpen: true,
        })),
      },
      ...overrides,
    },
  });
  createdBusinessIds.push(b.id);
  return b;
}

async function req(method: string, path: string, opts: any = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

function ownerToken(b: any): string {
  return jwt.sign(
    { businessId: b.id, email: b.ownerEmail },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: '1h' } as any
  );
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/owner', ownerRouter);
  app.use('/api', publicRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  (notificationService as any).sendOtpEmail = async (email: string, code: string) => {
    sentOtps.push({ email: String(email).toLowerCase(), code });
  };
  (googleTokenVerifier as any).verifyCredential = async () => {
    throw new Error('Google not configured in tests');
  };
});

beforeEach(() => {
  sentOtps.length = 0;
});

after(async () => {
  (notificationService as any).sendOtpEmail = originalSendOtp;
  (googleTokenVerifier as any).verifyCredential = originalVerifyCredential;
  process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
  await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  createdBusinessIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('OA-1. OTP request stores only a hash (never plaintext) and delivers via sender', async () => {
  const email = `hash-${crypto.randomBytes(4).toString('hex')}@test.com`;
  await ownerAuthOtpService.requestOtp(email, 'SIGNUP', null);

  const row = await prisma.ownerAuthOtp.findFirst({ where: { email, purpose: 'SIGNUP' }, orderBy: { createdAt: 'desc' } });
  assert.ok(row);
  assert.ok(!row.codeHash.includes(sentOtps[0]?.code || 'zzzzzz'), 'plaintext code must not be stored');
  const expectedHash = crypto.createHash('sha256').update(sentOtps[0].code).digest('hex');
  assert.strictEqual(row.codeHash, expectedHash);
  assert.ok(row.expiresAt > new Date());
});

test('OA-2. OTP verify succeeds once, then the code is consumed', async () => {
  const email = `verify-${crypto.randomBytes(4).toString('hex')}@test.com`;
  await ownerAuthOtpService.requestOtp(email, 'SIGNUP', null);
  const { code } = sentOtps[sentOtps.length - 1];

  const ok = await ownerAuthOtpService.verifyOtp(email, 'SIGNUP', code);
  assert.strictEqual(ok.email, email);
  await assert.rejects(() => ownerAuthOtpService.verifyOtp(email, 'SIGNUP', code), /Invalid or expired code/);
});

test('OA-3. Wrong code increments attempts and locks after max attempts', async () => {
  const email = `attempts-${crypto.randomBytes(4).toString('hex')}@test.com`;
  await ownerAuthOtpService.requestOtp(email, 'PASSWORD_RESET', null);
  const { code } = sentOtps[sentOtps.length - 1];

  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => ownerAuthOtpService.verifyOtp(email, 'PASSWORD_RESET', '000000'), /Invalid or expired code/);
  }
  await assert.rejects(() => ownerAuthOtpService.verifyOtp(email, 'PASSWORD_RESET', code), /Too many incorrect attempts/);
});

test('OA-4. Resend is rate limited (cooldown)', async () => {
  const email = `cooldown-${crypto.randomBytes(4).toString('hex')}@test.com`;
  await ownerAuthOtpService.requestOtp(email, 'SIGNUP', null);
  await assert.rejects(() => ownerAuthOtpService.requestOtp(email, 'SIGNUP', null), /Please wait a moment/);
});

test('OA-5. Full signup flow: OTP verify → complete → JWT; duplicate email rejected', async () => {
  const email = `signup-${crypto.randomBytes(4).toString('hex')}@test.com`;

  const start = await req('POST', '/auth/signup/request-otp', { body: { email } });
  assert.strictEqual(start.status, 200);

  const captured = sentOtps.find((s) => s.email === email);
  assert.ok(captured, 'OTP email must be delivered');

  const verify = await req('POST', '/auth/signup/verify-otp', { body: { email, code: captured!.code } });
  assert.strictEqual(verify.status, 200);
  assert.ok(verify.json.signupToken);

  const complete = await req('POST', '/signup', {
    body: { signupToken: verify.json.signupToken, name: 'OTP Salon', ownerPassword: 'newpass123', timezone: 'UTC' },
  });
  assert.strictEqual(complete.status, 201);
  assert.ok(complete.json.token);
  createdBusinessIds.push(complete.json.business.id);
  assert.strictEqual(complete.json.business.email, email);

  const biz = await prisma.business.findUnique({ where: { id: complete.json.business.id } });
  assert.ok(biz?.emailVerifiedAt, 'emailVerifiedAt must be set');
  assert.strictEqual(biz?.ownerEmail, email);

  const unverified = await req('POST', '/signup', { body: { name: 'X', ownerPassword: 'x', ownerEmail: email } });
  assert.strictEqual(unverified.status, 400);

  const dup = await req('POST', '/auth/signup/request-otp', { body: { email } });
  assert.strictEqual(dup.status, 409);

  const login = await req('POST', '/owner/login', { body: { email, password: 'newpass123' } });
  assert.strictEqual(login.status, 200);
  assert.ok(login.json.token);
});

test('OA-6. Forgot password: OTP → reset → new password works; old password fails', async () => {
  const business = await makeBusiness();
  const email = business.ownerEmail;

  const start = await req('POST', '/auth/forgot/request-otp', { body: { email } });
  assert.strictEqual(start.status, 200);
  const captured = sentOtps.find((s) => s.email === email);
  assert.ok(captured, 'reset OTP must be delivered');

  const verify = await req('POST', '/auth/forgot/verify-otp', { body: { email, code: captured!.code } });
  assert.strictEqual(verify.status, 200);
  assert.ok(verify.json.resetToken);

  const reset = await req('POST', '/auth/forgot/reset', { body: { resetToken: verify.json.resetToken, newPassword: 'brandnew99' } });
  assert.strictEqual(reset.status, 200);

  const oldLogin = await req('POST', '/owner/login', { body: { email, password: 'password123' } });
  assert.strictEqual(oldLogin.status, 401);
  const newLogin = await req('POST', '/owner/login', { body: { email, password: 'brandnew99' } });
  assert.strictEqual(newLogin.status, 200);
});

test('OA-7. Forgot request for an unknown email returns a generic ok (no enumeration)', async () => {
  const email = `ghost-${crypto.randomBytes(4).toString('hex')}@test.com`;
  const res = await req('POST', '/auth/forgot/request-otp', { body: { email } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.ok, true);
  assert.strictEqual(sentOtps.filter((s) => s.email === email).length, 0);
});

test('OA-8. Google auto-link: existing same-email account → JWT + googleSub recorded', async () => {
  const business = await makeBusiness();
  (googleTokenVerifier as any).verifyCredential = async () => ({
    sub: 'google-sub-123',
    email: business.ownerEmail,
    emailVerified: true,
    name: 'Google Owner',
  });

  const res = await req('POST', '/auth/google', { body: { credential: 'fake.jwt.token' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.needsSignupCompletion, false);
  assert.ok(res.json.token);
  assert.strictEqual(res.json.business.email, business.ownerEmail);

  const updated = await prisma.business.findUnique({ where: { id: business.id } });
  assert.strictEqual(updated?.googleSub, 'google-sub-123');
  assert.ok(updated?.emailVerifiedAt);
});

test('OA-9. Google new user: complete signup → JWT with ownerPassword null → password/set works', async () => {
  const email = `gnew-${crypto.randomBytes(4).toString('hex')}@test.com`;
  const gsub = 'google-sub-new-' + crypto.randomBytes(4).toString('hex');
  (googleTokenVerifier as any).verifyCredential = async () => ({
    sub: gsub,
    email,
    emailVerified: true,
    name: 'New Google User',
  });

  const res = await req('POST', '/auth/google', { body: { credential: 'fake.jwt.token' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.needsSignupCompletion, true);
  assert.ok(res.json.googleSignupToken);

  const complete = await req('POST', '/auth/google/complete', {
    body: { googleSignupToken: res.json.googleSignupToken, name: 'Google Salon', timezone: 'UTC' },
  });
  assert.strictEqual(complete.status, 201);
  assert.ok(complete.json.token);
  createdBusinessIds.push(complete.json.business.id);

  const biz = await prisma.business.findUnique({ where: { id: complete.json.business.id } });
  assert.strictEqual(biz?.ownerPassword, null);
  assert.strictEqual(biz?.googleSub, gsub);
  assert.ok(biz?.emailVerifiedAt);

  // Email+password login is rejected until a password is set.
  const noPwLogin = await req('POST', '/owner/login', { body: { email, password: 'whatever123' } });
  assert.strictEqual(noPwLogin.status, 401);
  assert.strictEqual(noPwLogin.json.code, 'NO_PASSWORD');

  // Owner can set a password in Settings (no current password required).
  const token = ownerToken(biz!);
  const set = await req('POST', '/owner/password/set', {
    headers: { Authorization: `Bearer ${token}` },
    body: { newPassword: 'setpass123' },
  });
  assert.strictEqual(set.status, 200);

  const nowLogin = await req('POST', '/owner/login', { body: { email, password: 'setpass123' } });
  assert.strictEqual(nowLogin.status, 200);

  // Setting again is rejected (a password already exists).
  const again = await req('POST', '/owner/password/set', {
    headers: { Authorization: `Bearer ${token}` },
    body: { newPassword: 'another123' },
  });
  assert.strictEqual(again.status, 400);
});
