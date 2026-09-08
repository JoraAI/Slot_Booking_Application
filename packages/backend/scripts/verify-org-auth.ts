import prisma from '../src/lib/prisma';
import { orgAuthService } from '../src/services/OrgAuthService';
import { verifyOwnerPassword } from '../src/services/OwnerPassword';

async function main() {
  const businesses = await prisma.business.count();
  const users = await prisma.user.count();
  const orgs = await prisma.organization.count();
  const unlinked = await prisma.business.count({ where: { organizationId: null } });
  console.log({ businesses, users, orgs, unlinked });

  const demo = await prisma.business.findFirst({
    where: { ownerEmail: { equals: 'owner@demosalon.com', mode: 'insensitive' } },
    include: { organization: true, memberships: true },
  });
  if (!demo) {
    console.log('demo salon not found');
    return;
  }
  console.log('demo shop', {
    id: demo.id,
    name: demo.name,
    isPrimary: demo.isPrimary,
    orgId: demo.organizationId,
    memberships: demo.memberships.length,
  });

  const user = await prisma.user.findUnique({ where: { email: 'owner@demosalon.com' } });
  console.log('demo user', user ? { id: user.id, hasPassword: !!user.passwordHash } : null);

  if (user?.passwordHash) {
    const ok = await verifyOwnerPassword(user.passwordHash, 'admin123');
    console.log('password admin123 valid?', ok);
    if (ok) {
      const shop = await orgAuthService.resolveLoginShop(user.id);
      const session = orgAuthService.sessionPayload({
        userId: user.id,
        orgId: shop!.orgId,
        business: shop!.business,
        role: shop!.role,
      });
      const shops = await orgAuthService.listShopsForUser(user.id, shop!.orgId);
      console.log('login ok', { role: session.role, business: session.business.name, shops: shops.length });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
