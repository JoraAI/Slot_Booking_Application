import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;
const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

export function isHashedOwnerPassword(value: string): boolean {
  return BCRYPT_PREFIX.test(value);
}

export async function hashOwnerPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyOwnerPassword(stored: string, candidate: string): Promise<boolean> {
  if (!stored || !candidate) return false;
  if (isHashedOwnerPassword(stored)) {
    return bcrypt.compare(candidate, stored);
  }
  return stored === candidate;
}
