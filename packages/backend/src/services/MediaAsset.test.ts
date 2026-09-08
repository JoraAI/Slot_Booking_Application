import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { ownerRouter } from '../routes/owner';
import { serveMediaAsset } from './MediaService';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let server: any;
let baseUrl: string;
let business: any;
const createdIds: string[] = [];

function tokenFor() {
  return jwt.sign(
    { businessId: business.id, email: business.ownerEmail },
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
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* ignore */ }
  }
  return { status: res.status, json, buf, headers: res.headers };
}

before(async () => {
  const app = express();
  app.use('/api/owner/media/upload', express.json({ limit: '4mb' }));
  app.use(express.json());
  app.get('/api/media/:id', (req, res) => { void serveMediaAsset(req, res); });
  app.use('/api/owner', ownerRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  const tag = crypto.randomBytes(4).toString('hex');
  business = await prisma.business.create({
    data: {
      name: 'Media Biz',
      slug: `media-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `media-${tag}@test.com`,
      ownerPassword: 'hashed',
    },
  });
  createdIds.push(business.id);
});

after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('media upload stores bytes in Postgres and serves them by id', async () => {
  const uploaded = await req('POST', '/owner/media/upload', {
    headers: { Authorization: `Bearer ${tokenFor()}` },
    body: { mimeType: 'image/png', dataBase64: PNG_1X1.toString('base64') },
  });
  assert.strictEqual(uploaded.status, 201);
  assert.ok(uploaded.json?.url);
  assert.ok(uploaded.json?.publicId);
  assert.match(uploaded.json.url, /\/api\/media\//);

  const id = uploaded.json.publicId as string;
  const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
  assert.strictEqual(row.mimeType, 'image/webp');
  assert.strictEqual(row.businessId, business.id);
  assert.ok(row.byteSize > 0);
  assert.ok(row.byteSize <= 80 * 1024);

  const served = await req('GET', `/media/${id}`);
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'image/webp');
  assert.ok(served.buf.length > 0);
  assert.ok(Buffer.from(served.buf.subarray(0, 4)).toString('ascii') === 'RIFF');
});

test('media upload rejects non-image payloads', async () => {
  const uploaded = await req('POST', '/owner/media/upload', {
    headers: { Authorization: `Bearer ${tokenFor()}` },
    body: { dataBase64: Buffer.from('not-an-image').toString('base64') },
  });
  assert.strictEqual(uploaded.status, 400);
});

test('clearing logo and cover URLs nulls fields and deletes media assets', async () => {
  const auth = { Authorization: `Bearer ${tokenFor()}` };

  const logoUp = await req('POST', '/owner/media/upload', {
    headers: auth,
    body: { mimeType: 'image/png', dataBase64: PNG_1X1.toString('base64') },
  });
  assert.strictEqual(logoUp.status, 201);
  const logoId = logoUp.json.publicId as string;

  const coverUp = await req('POST', '/owner/media/upload', {
    headers: auth,
    body: { mimeType: 'image/png', dataBase64: PNG_1X1.toString('base64') },
  });
  assert.strictEqual(coverUp.status, 201);
  const coverId = coverUp.json.publicId as string;

  const set = await req('PUT', '/owner/config', {
    headers: auth,
    body: {
      logoUrl: logoUp.json.url,
      logoPublicId: logoId,
      coverImageUrl: coverUp.json.url,
      coverImagePublicId: coverId,
    },
  });
  assert.strictEqual(set.status, 200, set.json?.error || 'set branding failed');
  assert.ok(set.json?.logoUrl);
  assert.ok(set.json?.coverImageUrl);

  const cleared = await req('PUT', '/owner/config', {
    headers: auth,
    body: {
      logoUrl: '',
      logoPublicId: '',
      coverImageUrl: '',
      coverImagePublicId: '',
    },
  });
  assert.strictEqual(cleared.status, 200, cleared.json?.error || 'clear branding failed');
  assert.strictEqual(cleared.json?.logoUrl ?? null, null);
  assert.strictEqual(cleared.json?.logoPublicId ?? null, null);
  assert.strictEqual(cleared.json?.coverImageUrl ?? null, null);
  assert.strictEqual(cleared.json?.coverImagePublicId ?? null, null);

  const logoRow = await prisma.mediaAsset.findUnique({ where: { id: logoId } });
  const coverRow = await prisma.mediaAsset.findUnique({ where: { id: coverId } });
  assert.strictEqual(logoRow, null, 'logo media asset should be deleted');
  assert.strictEqual(coverRow, null, 'cover media asset should be deleted');

  const biz = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.strictEqual(biz.logoUrl, null);
  assert.strictEqual(biz.coverImageUrl, null);
});

test('replacing logo deletes the previous media asset only', async () => {
  const auth = { Authorization: `Bearer ${tokenFor()}` };

  const first = await req('POST', '/owner/media/upload', {
    headers: auth,
    body: { mimeType: 'image/png', dataBase64: PNG_1X1.toString('base64') },
  });
  assert.strictEqual(first.status, 201);
  const firstId = first.json.publicId as string;

  await req('PUT', '/owner/config', {
    headers: auth,
    body: { logoUrl: first.json.url, logoPublicId: firstId },
  });

  const second = await req('POST', '/owner/media/upload', {
    headers: auth,
    body: { mimeType: 'image/png', dataBase64: PNG_1X1.toString('base64') },
  });
  assert.strictEqual(second.status, 201);
  const secondId = second.json.publicId as string;

  const replaced = await req('PUT', '/owner/config', {
    headers: auth,
    body: { logoUrl: second.json.url, logoPublicId: secondId },
  });
  assert.strictEqual(replaced.status, 200, replaced.json?.error || 'replace failed');

  assert.strictEqual(await prisma.mediaAsset.findUnique({ where: { id: firstId } }), null);
  assert.ok(await prisma.mediaAsset.findUnique({ where: { id: secondId } }));
});
