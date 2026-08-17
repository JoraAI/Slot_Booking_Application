import prisma from '../lib/prisma';

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

export function customerIdentityKey(phone?: string | null, email?: string | null): string {
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (normalizedPhone) return `phone:${normalizedPhone}`;
  const normalizedEmail = normalizeCustomerEmail(email);
  if (normalizedEmail) return `email:${normalizedEmail}`;
  throw new Error('A customer needs a phone number or email address');
}

class CustomerService {
  async syncFromBooking(
    businessId: string,
    customer: { name: string; phone?: string | null; email?: string | null },
    db: any = prisma
  ): Promise<any> {
    const phone = normalizeCustomerPhone(customer.phone);
    const email = normalizeCustomerEmail(customer.email);
    const identityKey = customerIdentityKey(phone, email);
    const name = customer.name.trim();

    return db.customerContact.upsert({
      where: { businessId_identityKey: { businessId, identityKey } },
      create: {
        businessId,
        identityKey,
        name,
        phone,
        email,
        bookingCount: 1,
        lastBookedAt: new Date(),
      },
      update: {
        name,
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        bookingCount: { increment: 1 },
        lastBookedAt: new Date(),
      },
    });
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
      return prisma.customerContact.update({
        where: { id: existing.id },
        data: {
          name,
          phone,
          email,
        },
      });
    }

    const phone = normalizeCustomerPhone(customer.phone);
    const email = normalizeCustomerEmail(customer.email);
    const name = String(customer.name || email || phone || 'Customer').trim();
    const identityKey = customerIdentityKey(phone, email);

    return prisma.customerContact.upsert({
      where: { businessId_identityKey: { businessId, identityKey } },
      create: {
        businessId,
        identityKey,
        name,
        phone,
        email,
      },
      update: {
        name,
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
      },
    });
  }
}

export const customerService = new CustomerService();
