import express from 'express';
import prisma from '../src/lib/prisma';
import { ownerRouter } from '../src/routes/owner';

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/owner', ownerRouter);
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/owner`;

  const login = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@demosalon.com', password: 'admin123' }),
  }).then((r) => r.json()) as any;
  if (!login.token) throw new Error('owner login failed: ' + JSON.stringify(login));

  const me = await fetch(`${base}/me`, {
    headers: { Authorization: `Bearer ${login.token}` },
  }).then((r) => r.json()) as any;

  const tag = Date.now().toString(36);
  const email = `ui-verify-mgr-${tag}@test.com`;
  const inviteRes = await fetch(`${base}/members/invite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${login.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      businessIds: [me.id],
      temporaryPassword: 'TempPass123',
    }),
  });
  const inviteJson = await inviteRes.json() as any;
  console.log('invite', inviteRes.status, { ok: inviteJson.ok, email: inviteJson.email });

  const mgrLoginRes = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TempPass123' }),
  });
  const mgrJson = await mgrLoginRes.json() as any;
  console.log('manager login', mgrLoginRes.status, { role: mgrJson.role });

  const mgrMe = await fetch(`${base}/me`, {
    headers: { Authorization: `Bearer ${mgrJson.token}` },
  }).then((r) => r.json()) as any;
  console.log('manager me', { role: mgrMe.role, shops: mgrMe.shops?.length });

  const sub = await fetch(`${base}/subscription/select`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrJson.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ plan: 'MONTHLY_799' }),
  });
  console.log('manager subscription select', sub.status);

  // Manager cannot invite
  const mgrInvite = await fetch(`${base}/members/invite`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrJson.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: `other-${tag}@test.com`,
      businessIds: [me.id],
      temporaryPassword: 'TempPass123',
    }),
  });
  console.log('manager invite attempt', mgrInvite.status);

  if (inviteJson.userId) {
    await prisma.businessMembership.deleteMany({ where: { userId: inviteJson.userId } });
    await prisma.orgMember.deleteMany({ where: { userId: inviteJson.userId } });
    await prisma.user.delete({ where: { id: inviteJson.userId } }).catch(() => {});
  }
  console.log('cleanup ok');
  server.close();

  const ok =
    inviteRes.status === 201 &&
    mgrLoginRes.status === 200 &&
    mgrJson.role === 'MANAGER' &&
    mgrMe.role === 'MANAGER' &&
    sub.status === 403 &&
    mgrInvite.status === 403;
  if (!ok) {
    console.error('VERIFY FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('VERIFY PASS');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
