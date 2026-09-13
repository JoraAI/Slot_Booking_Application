import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { ownerRouter } from '../routes/owner';
import { notificationService } from './NotificationService';

let server: any;
let baseUrl: string;
let business: any;
const createdIds: string[] = [];
let sentArgs: any = null;
let originalSend: typeof notificationService.sendSupportTicketEmail;

function tokenFor(email = 'owner@support-test.com') {
  return jwt.sign(
    { businessId: business.id, email, role: 'OWNER' },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: '1h' } as any
  );
}

async function req(method: string, path: string, opts: any = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

before(async () => {
  originalSend = notificationService.sendSupportTicketEmail.bind(notificationService);
  (notificationService as any).sendSupportTicketEmail = async (args: any) => {
    sentArgs = args;
  };

  const app = express();
  app.use(express.json());
  app.use('/api/owner', ownerRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(async () => {
  sentArgs = null;
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  const tag = crypto.randomBytes(4).toString('hex');
  business = await prisma.business.create({
    data: {
      name: 'Support Test Salon',
      slug: `support-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `support-${tag}@test.com`,
      ownerPassword: 'hashed',
    },
  });
  createdIds.push(business.id);
});

after(async () => {
  (notificationService as any).sendSupportTicketEmail = originalSend;
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('POST /owner/support requires auth', async () => {
  const res = await req('POST', '/owner/support', {
    body: { category: 'bug', subject: 'Broken QR', message: 'Cannot download QR on iPhone' },
  });
  assert.equal(res.status, 401);
  assert.equal(sentArgs, null);
});

test('POST /owner/support rejects invalid payload', async () => {
  const auth = { Authorization: `Bearer ${tokenFor()}` };
  const short = await req('POST', '/owner/support', {
    headers: auth,
    body: { category: 'bug', subject: 'Hi', message: 'too short' },
  });
  assert.equal(short.status, 400);

  const badCat = await req('POST', '/owner/support', {
    headers: auth,
    body: { category: 'unknown', subject: 'Valid subject', message: 'Long enough message here' },
  });
  assert.equal(badCat.status, 400);
  assert.equal(sentArgs, null);
});

test('POST /owner/support emails admin with Reply-To owner and shop context', async () => {
  const ownerEmail = 'owner@support-test.com';
  const res = await req('POST', '/owner/support', {
    headers: { Authorization: `Bearer ${tokenFor(ownerEmail)}` },
    body: {
      category: 'enhancement',
      subject: 'Add SMS reminders',
      message: 'Please add SMS reminders for customers in addition to WhatsApp.',
    },
  });
  assert.equal(res.status, 200, res.json?.error || 'expected 200');
  assert.equal(res.json?.ok, true);
  assert.equal(res.json?.emailedTo, 'admin@staffingpros.tech');
  assert.ok(sentArgs);
  assert.equal(sentArgs.to, 'admin@staffingpros.tech');
  assert.equal(sentArgs.replyTo, ownerEmail);
  assert.equal(sentArgs.category, 'enhancement');
  assert.equal(sentArgs.subject, 'Add SMS reminders');
  assert.match(sentArgs.message, /SMS reminders/);
  assert.equal(sentArgs.businessId, business.id);
  assert.equal(sentArgs.businessName, 'Support Test Salon');
  assert.equal(sentArgs.businessSlug, business.slug);
  assert.equal(sentArgs.shopPublicCode, business.publicCode);
  assert.equal(sentArgs.ownerEmail, ownerEmail);
  assert.equal(sentArgs.voiceAttachment, null);
});

test('POST /owner/support accepts voice-only ticket as email attachment', async () => {
  const ownerEmail = 'owner@support-test.com';
  // Minimal EBML/WebM-looking header so sniffAudioMime accepts it.
  const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
  const res = await req('POST', '/owner/support', {
    headers: { Authorization: `Bearer ${tokenFor(ownerEmail)}` },
    body: {
      category: 'bug',
      subject: '',
      message: '',
      voiceNoteBase64: audio.toString('base64'),
      voiceNoteMimeType: 'audio/webm',
    },
  });
  assert.equal(res.status, 200, res.json?.error || 'expected 200');
  assert.ok(sentArgs);
  assert.equal(sentArgs.subject, 'Voice support note');
  assert.ok(sentArgs.voiceAttachment);
  assert.equal(sentArgs.voiceAttachment.contentType, 'audio/webm');
  assert.equal(sentArgs.voiceAttachment.filename, 'support-voice-note.webm');
  assert.ok(Buffer.isBuffer(sentArgs.voiceAttachment.content));
  assert.equal(sentArgs.voiceAttachment.content.length, audio.length);
});

test('POST /owner/support rate-limits excessive tickets', async () => {
  const auth = { Authorization: `Bearer ${tokenFor()}` };
  const body = {
    category: 'other',
    subject: 'Rate limit probe',
    message: 'This is a rate-limit verification message.',
  };
  for (let i = 0; i < 5; i++) {
    const ok = await req('POST', '/owner/support', { headers: auth, body });
    assert.equal(ok.status, 200, `ticket ${i + 1} should succeed`);
  }
  const blocked = await req('POST', '/owner/support', { headers: auth, body });
  assert.equal(blocked.status, 429);
});
