import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { notificationService } from './NotificationService';

/**
 * Owner auth email OTP (signup + forgot-password only). Mirrors the customer
 * BookingManagementOtp patterns: SHA-256 hash at rest, TTL, attempt cap,
 * consume-once, per-email/per-IP rate limits. Emails are sent via PLATFORM SMTP
 * from env only (no business → resolveSmtp falls back to SMTP_* env).
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_RESENDS = 3; // active (unconsumed, unexpired) per email+purpose
const OTP_MAX_PER_IP = 3;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const SIGNUP_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

export type OtpPurpose = 'SIGNUP' | 'PASSWORD_RESET';

class OwnerAuthOtpService {
  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  private generateCode(): string {
    return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  }

  private httpError(status: number, message: string): Error & { status?: number } {
    const err: Error & { status?: number } = new Error(message);
    err.status = status;
    return err;
  }

  private normalizeEmail(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  /** Request + email an OTP. Throws with .status for HTTP mapping. */
  async requestOtp(email: string, purpose: OtpPurpose, ip: string | null): Promise<{ ok: true }> {
    const normalized = this.normalizeEmail(email);
    if (!normalized) throw this.httpError(400, 'Email is required');

    const now = new Date();
    const activeCount = await prisma.ownerAuthOtp.count({
      where: { email: normalized, purpose, consumedAt: null, expiresAt: { gt: now } },
    });
    if (activeCount >= OTP_MAX_RESENDS) {
      throw this.httpError(429, 'Too many OTP requests. Please try again later.');
    }
    if (ip) {
      const ipCount = await prisma.ownerAuthOtp.count({
        where: { email: normalized, purpose, consumedAt: null, expiresAt: { gt: now }, requesterIp: ip },
      });
      if (ipCount >= OTP_MAX_PER_IP) {
        throw this.httpError(429, 'Too many OTP requests from this device.');
      }
    }
    const last = await prisma.ownerAuthOtp.findFirst({
      where: { email: normalized, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last && now.getTime() - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw this.httpError(429, 'Please wait a moment before requesting another code.');
    }

    const code = this.generateCode();
    try {
      // Platform SMTP only: no business is passed, so resolveSmtp uses env.
      await notificationService.sendOtpEmail(normalized, code, 'Reservly', undefined);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      console.error('Owner auth OTP email failed:', msg);
      // Fail closed — never claim delivery succeeded. Distinguish misconfig vs provider reject.
      if (/not configured|RESEND_API_KEY|SMTP_USER/i.test(msg)) {
        throw this.httpError(
          503,
          'Platform email is not configured. Set RESEND_API_KEY on Render (recommended), or SMTP_USER/SMTP_PASS on a host that allows outbound SMTP, then redeploy.'
        );
      }
      if (/ETIMEDOUT|ECONNREFUSED|Connection timeout/i.test(msg)) {
        throw this.httpError(
          503,
          'Email send timed out. On Render free tier, Gmail SMTP is blocked — use RESEND_API_KEY instead.'
        );
      }
      throw this.httpError(
        503,
        'Unable to deliver the verification code. Check RESEND_API_KEY / SMTP credentials and try again.'
      );
    }

    await prisma.ownerAuthOtp.create({
      data: {
        email: normalized,
        purpose,
        codeHash: this.hash(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        maxAttempts: OTP_MAX_ATTEMPTS,
        requesterIp: ip || null,
      },
    });
    return { ok: true };
  }

  /** Verify a code (consume-once). Throws with .status on failure. */
  async verifyOtp(email: string, purpose: OtpPurpose, code: string): Promise<{ ok: true; email: string }> {
    const normalized = this.normalizeEmail(email);
    const now = new Date();
    const otp = await prisma.ownerAuthOtp.findFirst({
      where: { email: normalized, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw this.httpError(400, 'Invalid or expired code');

    if (otp.attempts >= otp.maxAttempts) {
      await prisma.ownerAuthOtp.update({ where: { id: otp.id }, data: { consumedAt: now } });
      throw this.httpError(429, 'Too many incorrect attempts. Request a new code.');
    }

    if (!this.safeEqual(otp.codeHash, this.hash(String(code).trim()))) {
      await prisma.ownerAuthOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw this.httpError(400, 'Invalid or expired code');
    }

    await prisma.ownerAuthOtp.update({ where: { id: otp.id }, data: { consumedAt: now } });
    return { ok: true, email: normalized };
  }

  private signToken(typ: string, email: string, ttlMs: number): string {
    return jwt.sign(
      { typ, email },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: Math.floor(ttlMs / 1000) } as any
    );
  }

  /** Short-lived purpose-scoped token after OTP verify. */
  issueToken(purpose: OtpPurpose, email: string): string {
    return purpose === 'SIGNUP'
      ? this.signToken('owner_signup', email, SIGNUP_TOKEN_TTL_MS)
      : this.signToken('owner_password_reset', email, RESET_TOKEN_TTL_MS);
  }

  /** Verify a purpose-scoped token; returns the email. Throws on mismatch. */
  verifyToken(token: string, expectedTyp: 'owner_signup' | 'owner_password_reset' | 'owner_google_signup'): string {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
    if (decoded?.typ !== expectedTyp || !decoded?.email) {
      throw this.httpError(400, 'Invalid or expired verification token');
    }
    return this.normalizeEmail(decoded.email);
  }
}

export const ownerAuthOtpService = new OwnerAuthOtpService();
