import { test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { orgAuthService } from './OrgAuthService';
import { hashOwnerPassword } from './OwnerPassword';

const cleanupUserIds: string[] = [];
const cleanupOrgIds: string[] = [];

after(async () => {
  for (const id of cleanupOrgIds) {
    await prisma.business.deleteMany({ where: { organizationId: id } }).catch(() => {});
    await prisma.organization.delete({ where: { id } }).catch(() => {});
  }
  for (const id of cleanupUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
});

test('createOwnerWorkspace creates org + primary shop + OWNER memberships', async () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const email = `org-auth-${tag}@test.com`;
  const { user, org, business } = await orgAuthService.createOwnerWorkspace({
    name: `Org Auth ${tag}`,
    email,
    timezone: 'Asia/Kolkata',
    password: 'password123',
    emailVerifiedAt: new Date(),
  });
  cleanupUserIds.push(user.id);
  cleanupOrgIds.push(org.id);

  assert.equal(business.isPrimary, true);
  assert.equal(business.organizationId, org.id);

  const shops = await orgAuthService.listShopsForUser(user.id, org.id);
  assert.equal(shops.length, 1);
  assert.equal(shops[0].role, 'OWNER');

  const extra = await orgAuthService.createAdditionalShop({
    userId: user.id,
    orgId: org.id,
    name: `Branch ${tag}`,
  });
  assert.equal(extra.isPrimary, false);

  const shops2 = await orgAuthService.listShopsForUser(user.id, org.id);
  assert.equal(shops2.length, 2);

  const invited = await orgAuthService.inviteManager({
    ownerUserId: user.id,
    orgId: org.id,
    email: `mgr-${tag}@test.com`,
    businessIds: [extra.id],
    temporaryPassword: 'managerpass1',
  });
  cleanupUserIds.push(invited.userId);

  const listed = await orgAuthService.listManagers({ ownerUserId: user.id, orgId: org.id });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].email, `mgr-${tag}@test.com`);
  assert.equal(listed[0].shops.length, 1);

  await orgAuthService.updateManagerShops({
    ownerUserId: user.id,
    orgId: org.id,
    userId: invited.userId,
    businessIds: [business.id, extra.id],
  });
  const listed2 = await orgAuthService.listManagers({ ownerUserId: user.id, orgId: org.id });
  assert.equal(listed2[0].shops.length, 2);

  await orgAuthService.resetManagerPassword({
    ownerUserId: user.id,
    orgId: org.id,
    userId: invited.userId,
    temporaryPassword: 'newmanager1',
  });

  const mgrShops = await orgAuthService.listShopsForUser(invited.userId, org.id);
  assert.equal(mgrShops.length, 2);

  await assert.rejects(
    () => orgAuthService.assertShopAccess(invited.userId, business.id).then(() =>
      orgAuthService.updateManagerShops({
        ownerUserId: invited.userId,
        orgId: org.id,
        userId: invited.userId,
        businessIds: [business.id],
      })
    ),
    (e: any) => e.status === 403
  );

  await orgAuthService.removeManager({
    ownerUserId: user.id,
    orgId: org.id,
    userId: invited.userId,
  });
  const listed3 = await orgAuthService.listManagers({ ownerUserId: user.id, orgId: org.id });
  assert.equal(listed3.length, 0);
  // user was cleaned up — drop from cleanup list
  const idx = cleanupUserIds.indexOf(invited.userId);
  if (idx >= 0) cleanupUserIds.splice(idx, 1);
});

test('ensureOrgForBusiness wraps legacy business', async () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const email = `legacy-${tag}@test.com`;
  const b = await prisma.business.create({
    data: {
      name: `Legacy ${tag}`,
      slug: `legacy-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: email,
      ownerPassword: await hashOwnerPassword('password123'),
    },
  });
  const wrapped = await orgAuthService.ensureOrgForBusiness(b.id);
  assert.ok(wrapped?.organizationId);
  cleanupOrgIds.push(wrapped!.organizationId!);
  const user = await prisma.user.findUnique({ where: { email } });
  assert.ok(user);
  cleanupUserIds.push(user!.id);
});
