import prisma from '../lib/prisma';

/**
 * Single resolver for public business identity.
 *
 * Canonical identity is the opaque `Business.publicCode`. Legacy slugs remain
 * temporarily supported for compatibility. Public codes are checked first and
 * validated by format to avoid collisions/ambiguity.
 */
class BusinessResolver {
  /** A public code is 16+ URL-safe base64url characters (opaque). */
  private static isPublicCodeFormat(value: string): boolean {
    return /^[A-Za-z0-9_-]{16,}$/.test(value);
  }

  /**
   * Resolve a business by public code or legacy slug.
   * Returns the business row or null.
   */
  async resolve(identifier: string, db: any = prisma) {
    if (BusinessResolver.isPublicCodeFormat(identifier)) {
      const byCode = await db.business.findUnique({
        where: { publicCode: identifier },
      });
      if (byCode) return byCode;
      // Not a valid code format hit — fall through to legacy slug lookup
    }
    return db.business.findUnique({ where: { slug: identifier } });
  }

  /** Resolve and throw a friendly 404-style error when missing. */
  async resolveOrThrow(identifier: string, db: any = prisma) {
    const business = await this.resolve(identifier, db);
    if (!business) {
      const err: any = new Error('Business not found');
      err.status = 404;
      throw err;
    }
    return business;
  }
}

export const businessResolver = new BusinessResolver();
