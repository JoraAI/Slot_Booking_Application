import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OrgRole } from '@prisma/client';
import prisma from '../lib/prisma';
import { hashOwnerPassword } from './OwnerPassword';
import { timeService } from './TimeService';

export type SessionRole = 'OWNER' | 'MANAGER';

export interface SessionClaims {
  userId: string;
  orgId: string;
  businessId: string;
  role: SessionRole;
  email: string;
}

export interface ShopSummary {
  id: string;
  name: string;
  slug: string;
  publicCode: string;
  isPrimary: boolean;
  role: SessionRole;
}

function jwtSecret() {
  return process.env.JWT_SECRET || 'fallback-secret';
}

function newId(): string {
  return 'c' + crypto.randomBytes(12).toString('hex');
}

async function uniqueSlug(name: string): Promise<string> {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!base) base = 'business';
  let slug = base;
  let suffix = 2;
  while (await prisma.business.findUnique({ where: { slug } })) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

async function uniquePublicCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const candidate = crypto.randomBytes(16).toString('base64url');
    if (!(await prisma.business.findUnique({ where: { publicCode: candidate } }))) {
      return candidate;
    }
  }
  throw Object.assign(new Error('Could not generate a unique public code'), { status: 500 });
}

export const orgAuthService = {
  issueSessionJwt(claims: SessionClaims): string {
    return jwt.sign(claims, jwtSecret(), {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    } as jwt.SignOptions);
  },

  /** Prefer primary shop; otherwise first membership by createdAt. */
  async resolveLoginShop(userId: string): Promise<{
    business: { id: string; name: string; slug: string; publicCode: string; ownerEmail: string; organizationId: string | null };
    role: SessionRole;
    orgId: string;
  } | null> {
    const memberships = await prisma.businessMembership.findMany({
      where: { userId },
      include: { business: true },
      orderBy: { createdAt: 'asc' },
    });
    if (memberships.length === 0) return null;

    const preferred =
      memberships.find((m) => m.business.isPrimary && m.business.organizationId) ||
      memberships[0];

    const orgId = preferred.business.organizationId;
    if (!orgId) return null;

    return {
      business: preferred.business,
      role: preferred.role as SessionRole,
      orgId,
    };
  },

  async listShopsForUser(userId: string, orgId: string): Promise<ShopSummary[]> {
    const orgMember = await prisma.orgMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!orgMember) return [];

    if (orgMember.role === OrgRole.OWNER) {
      const shops = await prisma.business.findMany({
        where: { organizationId: orgId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, slug: true, publicCode: true, isPrimary: true },
      });
      return shops.map((s) => ({ ...s, role: 'OWNER' as SessionRole }));
    }

    const memberships = await prisma.businessMembership.findMany({
      where: { userId, business: { organizationId: orgId } },
      include: {
        business: {
          select: { id: true, name: true, slug: true, publicCode: true, isPrimary: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      ...m.business,
      role: m.role as SessionRole,
    }));
  },

  async assertShopAccess(userId: string, businessId: string): Promise<{
    role: SessionRole;
    orgId: string;
    business: { id: string; name: string; slug: string; publicCode: string; ownerEmail: string };
  }> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business?.organizationId) {
      throw Object.assign(new Error('Shop not found'), { status: 404 });
    }

    const orgMember = await prisma.orgMember.findUnique({
      where: { organizationId_userId: { organizationId: business.organizationId, userId } },
    });
    if (!orgMember) {
      throw Object.assign(new Error('Access denied'), { status: 403 });
    }

    if (orgMember.role === OrgRole.OWNER) {
      return {
        role: 'OWNER',
        orgId: business.organizationId,
        business,
      };
    }

    const membership = await prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId, userId } },
    });
    if (!membership) {
      throw Object.assign(new Error('Access denied'), { status: 403 });
    }
    return {
      role: membership.role as SessionRole,
      orgId: business.organizationId,
      business,
    };
  },

  sessionPayload(args: {
    userId: string;
    orgId: string;
    business: { id: string; name: string; slug: string; publicCode?: string; ownerEmail: string };
    role: SessionRole;
  }) {
    const token = this.issueSessionJwt({
      userId: args.userId,
      orgId: args.orgId,
      businessId: args.business.id,
      role: args.role,
      email: args.business.ownerEmail,
    });
    return {
      token,
      business: {
        id: args.business.id,
        name: args.business.name,
        slug: args.business.slug,
        publicCode: args.business.publicCode,
        email: args.business.ownerEmail,
      },
      role: args.role,
      orgId: args.orgId,
      userId: args.userId,
    };
  },

  /**
   * Create User + Organization + primary Business (+ memberships).
   * Used by email/Google signup.
   */
  async createOwnerWorkspace(input: {
    name: string;
    email: string;
    timezone: string;
    password?: string;
    googleSub?: string;
    emailVerifiedAt: Date;
  }) {
    const email = input.email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw Object.assign(new Error('An account with this email already exists. Please sign in.'), { status: 409 });
    }

    const slug = await uniqueSlug(input.name);
    const publicCode = await uniquePublicCode();
    const hashedPassword = input.password ? await hashOwnerPassword(input.password) : null;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: newId(),
          email,
          passwordHash: hashedPassword,
          googleSub: input.googleSub || null,
          emailVerifiedAt: input.emailVerifiedAt,
        },
      });

      const org = await tx.organization.create({
        data: { id: newId(), name: input.name.trim() },
      });

      await tx.orgMember.create({
        data: {
          id: newId(),
          organizationId: org.id,
          userId: user.id,
          role: OrgRole.OWNER,
        },
      });

      const business = await tx.business.create({
        data: {
          id: newId(),
          organizationId: org.id,
          isPrimary: true,
          name: input.name.trim(),
          slug,
          publicCode,
          timezone: input.timezone,
          ownerEmail: email,
          ownerPassword: hashedPassword,
          ...(input.googleSub ? { googleSub: input.googleSub } : {}),
          emailVerifiedAt: input.emailVerifiedAt,
          slotGranularityMinutes: 15,
          workingHours: {
            create: [
              { dayOfWeek: 0, openTime: '10:00', closeTime: '18:00', isOpen: true },
              { dayOfWeek: 1, openTime: '09:00', closeTime: '20:00', isOpen: true },
              { dayOfWeek: 2, openTime: '09:00', closeTime: '20:00', isOpen: true },
              { dayOfWeek: 3, openTime: '09:00', closeTime: '20:00', isOpen: true },
              { dayOfWeek: 4, openTime: '09:00', closeTime: '20:00', isOpen: true },
              { dayOfWeek: 5, openTime: '09:00', closeTime: '20:00', isOpen: true },
              { dayOfWeek: 6, openTime: '10:00', closeTime: '18:00', isOpen: true },
            ],
          },
          formFields: {
            create: [
              { label: 'Full Name', fieldType: 'text', required: true, order: 1, visible: true, placeholder: 'Enter your full name' },
              { label: 'Phone Number', fieldType: 'tel', required: true, order: 2, visible: true, placeholder: 'Enter your phone number' },
              { label: 'Email Address', fieldType: 'email', required: false, order: 3, visible: true, placeholder: 'Enter your email address' },
              { label: 'Notes / Special Requests', fieldType: 'textarea', required: false, order: 4, visible: true, placeholder: 'Any special requests?' },
            ],
          },
        },
      });

      await tx.businessMembership.create({
        data: {
          id: newId(),
          businessId: business.id,
          userId: user.id,
          role: OrgRole.OWNER,
        },
      });

      return { user, org, business };
    });

    return result;
  },

  /** Owner adds another shop under the same organization. */
  async createAdditionalShop(args: {
    userId: string;
    orgId: string;
    name: string;
    timezone?: string;
    copyHoursFromPrimary?: boolean;
  }) {
    const orgMember = await prisma.orgMember.findUnique({
      where: { organizationId_userId: { organizationId: args.orgId, userId: args.userId } },
    });
    if (!orgMember || orgMember.role !== OrgRole.OWNER) {
      throw Object.assign(new Error('Only owners can add shops'), { status: 403 });
    }

    const primary = await prisma.business.findFirst({
      where: { organizationId: args.orgId, isPrimary: true },
      include: { workingHours: true },
    });
    if (!primary) {
      throw Object.assign(new Error('Primary shop not found'), { status: 404 });
    }

    const slug = await uniqueSlug(args.name);
    const publicCode = await uniquePublicCode();
    const tz = args.timezone || primary.timezone || 'Asia/Kolkata';
    if (!timeService.isValidTimezone(tz)) {
      throw Object.assign(new Error('Invalid timezone'), { status: 400 });
    }

    const hoursSource =
      args.copyHoursFromPrimary !== false && primary.workingHours.length > 0
        ? primary.workingHours.map((h) => ({
            dayOfWeek: h.dayOfWeek,
            openTime: h.openTime,
            closeTime: h.closeTime,
            isOpen: h.isOpen,
          }))
        : [
            { dayOfWeek: 0, openTime: '10:00', closeTime: '18:00', isOpen: true },
            { dayOfWeek: 1, openTime: '09:00', closeTime: '20:00', isOpen: true },
            { dayOfWeek: 2, openTime: '09:00', closeTime: '20:00', isOpen: true },
            { dayOfWeek: 3, openTime: '09:00', closeTime: '20:00', isOpen: true },
            { dayOfWeek: 4, openTime: '09:00', closeTime: '20:00', isOpen: true },
            { dayOfWeek: 5, openTime: '09:00', closeTime: '20:00', isOpen: true },
            { dayOfWeek: 6, openTime: '10:00', closeTime: '18:00', isOpen: true },
          ];

    const owners = await prisma.orgMember.findMany({
      where: { organizationId: args.orgId, role: OrgRole.OWNER },
      select: { userId: true },
    });

    const business = await prisma.$transaction(async (tx) => {
      const created = await tx.business.create({
        data: {
          id: newId(),
          organizationId: args.orgId,
          isPrimary: false,
          name: args.name.trim(),
          slug,
          publicCode,
          timezone: tz,
          ownerEmail: primary.ownerEmail,
          ownerPassword: primary.ownerPassword,
          googleSub: primary.googleSub,
          emailVerifiedAt: primary.emailVerifiedAt,
          slotGranularityMinutes: primary.slotGranularityMinutes,
          bookingWindowDays: primary.bookingWindowDays,
          enableWaitlist: primary.enableWaitlist,
          enableRecurring: primary.enableRecurring,
          enablePayments: primary.enablePayments,
          enableMultiStaff: primary.enableMultiStaff,
          paymentMode: primary.paymentMode,
          subscriptionPlan: primary.subscriptionPlan,
          subscriptionCommissionPercent: primary.subscriptionCommissionPercent,
          subscriptionMonthlyInr: primary.subscriptionMonthlyInr,
          workingHours: { create: hoursSource },
          formFields: {
            create: [
              { label: 'Full Name', fieldType: 'text', required: true, order: 1, visible: true, placeholder: 'Enter your full name' },
              { label: 'Phone Number', fieldType: 'tel', required: true, order: 2, visible: true, placeholder: 'Enter your phone number' },
              { label: 'Email Address', fieldType: 'email', required: false, order: 3, visible: true, placeholder: 'Enter your email address' },
              { label: 'Notes / Special Requests', fieldType: 'textarea', required: false, order: 4, visible: true, placeholder: 'Any special requests?' },
            ],
          },
        },
      });

      await tx.businessMembership.createMany({
        data: owners.map((o) => ({
          id: newId(),
          businessId: created.id,
          userId: o.userId,
          role: OrgRole.OWNER,
        })),
      });

      return created;
    });

    return business;
  },

  async inviteManager(args: {
    ownerUserId: string;
    orgId: string;
    email: string;
    businessIds: string[];
    temporaryPassword: string;
  }) {
    const orgMember = await prisma.orgMember.findUnique({
      where: { organizationId_userId: { organizationId: args.orgId, userId: args.ownerUserId } },
    });
    if (!orgMember || orgMember.role !== OrgRole.OWNER) {
      throw Object.assign(new Error('Only owners can invite managers'), { status: 403 });
    }

    const email = args.email.trim().toLowerCase();
    if (args.businessIds.length === 0) {
      throw Object.assign(new Error('Select at least one shop'), { status: 400 });
    }

    const shops = await prisma.business.findMany({
      where: { id: { in: args.businessIds }, organizationId: args.orgId },
      select: { id: true },
    });
    if (shops.length !== args.businessIds.length) {
      throw Object.assign(new Error('One or more shops are invalid'), { status: 400 });
    }

    const passwordHash = await hashOwnerPassword(args.temporaryPassword);

    return prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        user = await tx.user.create({
          data: {
            id: newId(),
            email,
            passwordHash,
            emailVerifiedAt: new Date(),
          },
        });
      } else if (!user.passwordHash) {
        user = await tx.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
      }

      const existingOrg = await tx.orgMember.findUnique({
        where: { organizationId_userId: { organizationId: args.orgId, userId: user.id } },
      });
      if (existingOrg?.role === OrgRole.OWNER) {
        throw Object.assign(new Error('This user is already an owner of the organization'), { status: 409 });
      }
      if (!existingOrg) {
        await tx.orgMember.create({
          data: {
            id: newId(),
            organizationId: args.orgId,
            userId: user.id,
            role: OrgRole.MANAGER,
          },
        });
      }

      for (const shop of shops) {
        await tx.businessMembership.upsert({
          where: { businessId_userId: { businessId: shop.id, userId: user.id } },
          create: {
            id: newId(),
            businessId: shop.id,
            userId: user.id,
            role: OrgRole.MANAGER,
          },
          update: { role: OrgRole.MANAGER },
        });
      }

      return { userId: user.id, email: user.email, shopIds: shops.map((s) => s.id) };
    });
  },

  async setPasswordForEmail(email: string, passwordHash: string) {
    const normalized = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
    }
    // Dual-write legacy Business.ownerPassword for shops still reading it
    await prisma.business.updateMany({
      where: { ownerEmail: { equals: normalized, mode: 'insensitive' } },
      data: { ownerPassword: passwordHash },
    });
    return user;
  },

  async findUserByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  },

  /** Ensure a legacy Business (no org) is wrapped — used if migration missed a row. */
  async ensureOrgForBusiness(businessId: string) {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return null;
    if (business.organizationId) return business;

    const email = business.ownerEmail.trim().toLowerCase();
    return prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        user = await tx.user.create({
          data: {
            id: newId(),
            email,
            passwordHash: business.ownerPassword,
            googleSub: business.googleSub,
            emailVerifiedAt: business.emailVerifiedAt,
          },
        });
      }
      const org = await tx.organization.create({
        data: { id: newId(), name: business.name },
      });
      await tx.orgMember.create({
        data: { id: newId(), organizationId: org.id, userId: user.id, role: OrgRole.OWNER },
      });
      const updated = await tx.business.update({
        where: { id: business.id },
        data: { organizationId: org.id, isPrimary: true },
      });
      await tx.businessMembership.upsert({
        where: { businessId_userId: { businessId: business.id, userId: user.id } },
        create: { id: newId(), businessId: business.id, userId: user.id, role: OrgRole.OWNER },
        update: {},
      });
      return updated;
    });
  },
};
