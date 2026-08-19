import prisma from '../lib/prisma';
import crypto from 'crypto';

export function normalizeCustomerPhone(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const prefix = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${prefix}${digits}` : null;
}

export function normalizeCustomerEmail(value?: string | null): string | null {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

export function isValidNotifyEmail(value?: string | null): boolean {
  const email = normalizeCustomerEmail(value);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidWhatsappNumber(value?: string | null): boolean {
  const phone = normalizeCustomerPhone(value);
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

export function customerIdentityKey(phone?: string | null, email?: string | null): string | null {
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (normalizedPhone) return `phone:${normalizedPhone}`;
  const normalizedEmail = normalizeCustomerEmail(email);
  if (normalizedEmail) return `email:${normalizedEmail}`;
  return null;
}

export function newAnonymousIdentityKey(): string {
  return `anon:${crypto.randomUUID()}`;
}

export type CustomerContactInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  lastServiceName?: string | null;
  lastBookedAt?: Date | null;
};

export function pickContactKeeper<T extends { id: string; lastBookedAt?: Date | null; bookingCount?: number; updatedAt?: Date }>(
  contacts: T[],
  preferId?: string | null
): T {
  if (preferId) {
    const preferred = contacts.find((contact) => contact.id === preferId);
    if (preferred) return preferred;
  }
  return [...contacts].sort((a, b) => {
    const bookedA = a.lastBookedAt ? new Date(a.lastBookedAt).getTime() : 0;
    const bookedB = b.lastBookedAt ? new Date(b.lastBookedAt).getTime() : 0;
    if (bookedA !== bookedB) return bookedB - bookedA;
    const countA = a.bookingCount ?? 0;
    const countB = b.bookingCount ?? 0;
    if (countA !== countB) return countB - countA;
    const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return updatedB - updatedA;
  })[0];
}

class CustomerService {
  private async findMatchingContacts(
    businessId: string,
    phone: string | null,
    email: string | null,
    db: any
  ) {
    const or: any[] = [];
    if (phone) {
      or.push({ phone });
      or.push({ identityKey: `phone:${phone}` });
    }
    if (email) {
      or.push({ email: { equals: email, mode: 'insensitive' } });
      or.push({ identityKey: `email:${email}` });
    }
    if (or.length === 0) return [];

    const rows = await db.customerContact.findMany({
      where: { businessId, OR: or },
    });
    const unique = new Map<string, any>();
    for (const row of rows) unique.set(row.id, row);
    return [...unique.values()];
  }

  private async mergeIntoKeeper(
    keeper: any,
    duplicates: any[],
    db: any
  ) {
    if (duplicates.length === 0) return keeper;
    const extraIds = duplicates.map((row) => row.id);
    await db.customerNotification.updateMany({
      where: { customerId: { in: extraIds } },
      data: { customerId: keeper.id },
    });
    await db.customerContact.deleteMany({
      where: { id: { in: extraIds } },
    });

    const bookingCount = duplicates.reduce((sum, row) => sum + (row.bookingCount || 0), keeper.bookingCount || 0);
    const lastBookedAt = [keeper, ...duplicates]
      .map((row) => row.lastBookedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || keeper.lastBookedAt;
    const lastServiceName = [keeper, ...duplicates]
      .sort((a, b) => {
        const bookedA = a.lastBookedAt ? new Date(a.lastBookedAt).getTime() : 0;
        const bookedB = b.lastBookedAt ? new Date(b.lastBookedAt).getTime() : 0;
        return bookedB - bookedA;
      })[0]?.lastServiceName ?? keeper.lastServiceName;
    const notes = [keeper.notes, ...duplicates.map((row) => row.notes)]
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .join('\n') || keeper.notes;

    return db.customerContact.update({
      where: { id: keeper.id },
      data: {
        bookingCount,
        lastBookedAt,
        lastServiceName,
        notes,
      },
    });
  }

  async upsertContact(
    businessId: string,
    input: CustomerContactInput,
    options: {
      keepId?: string | null;
      incrementBooking?: boolean;
      db?: any;
    } = {}
  ): Promise<any> {
    const db = options.db || prisma;
    const phone = normalizeCustomerPhone(input.phone);
    const email = normalizeCustomerEmail(input.email);
    const name = String(input.name || '').trim();
    if (!name) throw new Error('A customer needs a name');
    const identityKey = customerIdentityKey(phone, email) ?? newAnonymousIdentityKey();

    const matches = await this.findMatchingContacts(businessId, phone, email, db);
    let keeper: any = null;

    if (options.keepId) {
      keeper = matches.find((row) => row.id === options.keepId)
        || await db.customerContact.findFirst({ where: { id: options.keepId, businessId } });
      if (!keeper) throw new Error('Customer not found');
    } else if (matches.length > 0) {
      keeper = pickContactKeeper(matches);
    }

    if (keeper) {
      const duplicates = matches.filter((row) => row.id !== keeper.id);
      if (duplicates.length > 0) {
        keeper = await this.mergeIntoKeeper(keeper, duplicates, db);
      }

      const nextPhone = phone ?? keeper.phone;
      const nextEmail = email ?? keeper.email;
      const nextService = input.lastServiceName !== undefined
        ? (input.lastServiceName || null)
        : keeper.lastServiceName;
      const nextBookedAt = options.incrementBooking
        ? (input.lastBookedAt || new Date())
        : (input.lastBookedAt !== undefined ? input.lastBookedAt : keeper.lastBookedAt);

      return db.customerContact.update({
        where: { id: keeper.id },
        data: {
          identityKey: customerIdentityKey(nextPhone, nextEmail) ?? keeper.identityKey,
          name,
          phone: nextPhone,
          email: nextEmail,
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          lastServiceName: nextService,
          lastBookedAt: nextBookedAt,
          ...(options.incrementBooking ? { bookingCount: { increment: 1 } } : {}),
        },
      });
    }

    return db.customerContact.create({
      data: {
        businessId,
        identityKey,
        name,
        phone,
        email,
        notes: input.notes || null,
        lastServiceName: input.lastServiceName || null,
        lastBookedAt: options.incrementBooking ? (input.lastBookedAt || new Date()) : (input.lastBookedAt || null),
        bookingCount: options.incrementBooking ? 1 : 0,
      },
    });
  }

  async syncFromBooking(
    businessId: string,
    customer: {
      name: string;
      phone?: string | null;
      email?: string | null;
      lastServiceName?: string | null;
    },
    db: any = prisma
  ): Promise<any> {
    return this.upsertContact(businessId, {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      lastServiceName: customer.lastServiceName,
    }, { incrementBooking: true, db });
  }

  async findOrCreateForMessage(
    businessId: string,
    customer: { id?: string | null; name?: string | null; phone?: string | null; email?: string | null }
  ) {
    if (customer.id) {
      const existing = await prisma.customerContact.findFirst({
        where: { id: customer.id, businessId },
      });
      if (!existing) throw new Error('Customer not found');
      const phone = normalizeCustomerPhone(customer.phone) ?? existing.phone;
      const email = normalizeCustomerEmail(customer.email) ?? existing.email;
      const name = String(customer.name || existing.name).trim() || existing.name;
      return this.upsertContact(businessId, {
        name,
        phone,
        email,
        notes: existing.notes,
        lastServiceName: existing.lastServiceName,
        lastBookedAt: existing.lastBookedAt,
      }, { keepId: existing.id });
    }

    const phone = normalizeCustomerPhone(customer.phone);
    const email = normalizeCustomerEmail(customer.email);
    const name = String(customer.name || email || phone || 'Customer').trim();
    return this.upsertContact(businessId, { name, phone, email });
  }
}

export const customerService = new CustomerService();
