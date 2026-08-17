import crypto from 'crypto';
import prisma from '../lib/prisma';
import { notificationService } from './NotificationService';
import { locationInfo } from './LocationService';
import {
  smtpConfigured as smtpReady,
  twilioSmsConfigured as smsReady,
} from './notificationCredentials';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_RESENDS = 3; // active challenges per booking
const OTP_MAX_PER_IP = 2; // active challenges per booking + IP

/**
 * Single implementation of customer booking-management authorization.
 *
 * A cryptographically random management token (>= 128 bits) is issued once at
 * booking creation; only its SHA-256 hash is stored. Customers authenticate
 * with the token; when the owner enables OTP, a verified, single-use OTP is
 * also required and a short-lived, booking-scoped session is issued. Booking ID
 * alone never authorizes anything.
 */
class BookingManagementService {
  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /** Generate a token (256 bits) and its stored hash. */
  generateToken(): { token: string; hash: string } {
    const token = crypto.randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  private generateOtpCode(): string {
    return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  }

  private maskEmail(email: string): string {
    const at = email.indexOf('@');
    if (at <= 0) return '***@***';
    const user = email.slice(0, at);
    const domain = email.slice(at);
    return `${user[0]}***${domain}`;
  }

  private maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length <= 4) return '***';
    const keepTail = 4;
    const visible = digits.slice(0, Math.max(0, digits.length - keepTail - 4));
    const tail = digits.slice(-keepTail);
    return visible ? `${visible}${'*'.repeat(digits.length - visible.length - keepTail)}${tail}` : `***${tail}`;
  }

  maskDestination(channel: string, destination: string): string {
    return channel === 'EMAIL' ? this.maskEmail(destination) : this.maskPhone(destination);
  }

  /** Build the customer management URL with the opaque publicCode. */
  managementUrl(business: { publicCode: string }, bookingId: string, token: string): string {
    const base = (process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    return `${base}/b/${business.publicCode}/bookings/${bookingId}/manage?token=${encodeURIComponent(token)}`;
  }

  /** Minimal customer-facing booking view (never payment secrets). */
  customerBookingView(booking: any): any {
    return {
      id: booking.id,
      customerName: booking.customerName,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status,
      serviceName: booking.serviceNameSnapshot,
      staffName: booking.staff?.name ?? null,
      finalPrice: booking.finalPrice ?? null,
      // Batch 4 — salon location (address + server-generated directions link).
      location: booking.business ? locationInfo(booking.business) : null,
    };
  }

  /** Authorize a management token against a booking scoped to a business. */
  async authorizeToken(businessId: string, bookingId: string, token: string): Promise<any> {
    if (!token || typeof token !== 'string' || token.length < 32) {
      const err: any = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, businessId },
      include: { staff: true, business: true },
    });
    if (!booking) {
      const err: any = new Error('Booking not found');
      err.status = 404;
      throw err;
    }
    if (!booking.managementTokenHash) {
      const err: any = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    const providedHash = this.hash(token);
    if (!this.safeEqual(providedHash, booking.managementTokenHash)) {
      const err: any = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    return booking;
  }

  /** Create a short-lived, booking-scoped management session. */
  async createSession(businessId: string, booking: any): Promise<{ sessionToken: string; session: any }> {
    const { token: sessionToken, hash: sessionTokenHash } = this.generateToken();
    const session = await prisma.bookingManagementSession.create({
      data: {
        bookingId: booking.id,
        sessionTokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    void businessId;
    return { sessionToken, session };
  }

  /** Authorize a management session; returns the session + its booking. */
  async authorizeSession(sessionToken: string): Promise<{ session: any; booking: any }> {
    if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length < 32) {
      const err: any = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    const session = await prisma.bookingManagementSession.findUnique({
      where: { sessionTokenHash: this.hash(sessionToken) },
      include: { booking: { include: { staff: true, business: true } } },
    });
    if (!session) {
      const err: any = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    if (session.expiresAt < new Date()) {
      const err: any = new Error('Session expired');
      err.status = 401;
      throw err;
    }
    return { session, booking: session.booking };
  }

  /** Resolve which channel/destination to use for a booking's OTP. */
  private resolveOtpTarget(business: any, booking: any): { channel: 'EMAIL' | 'SMS'; destination: string } {
    const configured = business.bookingManagementOtpChannel || 'EITHER';
    const smtp = this.smtpConfigured(business);
    const sms = this.twilioSmsConfigured(business);
    const email = booking.customerEmail;
    const phone = booking.customerPhone;

    if (configured === 'EMAIL') {
      if (!smtp) throw new Error('Email OTP is not configured for this business');
      if (!email) throw new Error('Booking has no email address for OTP delivery');
      return { channel: 'EMAIL', destination: email };
    }
    if (configured === 'SMS') {
      if (!sms) throw new Error('SMS OTP is not configured for this business');
      if (!phone) throw new Error('Booking has no phone number for OTP delivery');
      return { channel: 'SMS', destination: phone };
    }
    // EITHER: prefer email when available + configured, else SMS
    if (smtp && email) return { channel: 'EMAIL', destination: email };
    if (sms && phone) return { channel: 'SMS', destination: phone };
    throw new Error('No OTP delivery channel is available for this booking');
  }

  /** Request an OTP for a token-authorized booking. */
  async requestOtp(business: any, booking: any, ip: string | null): Promise<{ maskedDestination: string; expiresInMinutes: number }> {
    const now = new Date();
    const activeCount = await prisma.bookingManagementOtp.count({
      where: { bookingId: booking.id, consumedAt: null, expiresAt: { gt: now } },
    });
    if (activeCount >= OTP_MAX_RESENDS) {
      const err: any = new Error('Too many OTP requests. Please try again later.');
      err.status = 429;
      throw err;
    }
    if (ip) {
      const ipCount = await prisma.bookingManagementOtp.count({
        where: { bookingId: booking.id, consumedAt: null, expiresAt: { gt: now }, requesterIp: ip },
      });
      if (ipCount >= OTP_MAX_PER_IP) {
        const err: any = new Error('Too many OTP requests from this device.');
        err.status = 429;
        throw err;
      }
    }

    const { channel, destination } = this.resolveOtpTarget(business, booking);
    const code = this.generateOtpCode();

    try {
      if (channel === 'EMAIL') await notificationService.sendOtpEmail(destination, code, business.name, business);
      else await notificationService.sendOtpSms(destination, code, business.name, business);
    } catch {
      // Never leak whether delivery succeeded/failed to unauthenticated callers
      // beyond a generic error; the token is already verified so this is fine.
      throw new Error('Unable to deliver OTP. Please try again later.');
    }

    await prisma.bookingManagementOtp.create({
      data: {
        businessId: business.id,
        bookingId: booking.id,
        channel,
        destinationHash: this.hash(destination.toLowerCase()),
        codeHash: this.hash(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        maxAttempts: OTP_MAX_ATTEMPTS,
        requesterIp: ip || null,
      },
    });

    return { maskedDestination: this.maskDestination(channel, destination), expiresInMinutes: OTP_TTL_MS / 60000 };
  }

  /** Verify an OTP for a token-authorized booking and issue a session. */
  async verifyOtp(business: any, booking: any, code: string, ip: string | null): Promise<{ sessionToken: string }> {
    const otp = await prisma.bookingManagementOtp.findFirst({
      where: { bookingId: booking.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      const err: any = new Error('No active OTP. Request a new code.');
      err.status = 400;
      throw err;
    }
    if (otp.expiresAt < new Date()) {
      throw new Error('OTP expired. Request a new code.');
    }
    if (otp.attempts >= otp.maxAttempts) {
      await prisma.bookingManagementOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw new Error('Too many incorrect attempts. Request a new code.');
    }

    const providedHash = this.hash(String(code));
    if (!this.safeEqual(providedHash, otp.codeHash)) {
      await prisma.bookingManagementOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      const err: any = new Error('Incorrect verification code');
      err.status = 400;
      throw err;
    }

    // Single-use: consume the OTP before issuing the session
    await prisma.bookingManagementOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    void ip;

    const { sessionToken } = await this.createSession(business.id, booking);
    return { sessionToken };
  }

  smtpConfigured(business?: any): boolean {
    return smtpReady(business);
  }

  twilioSmsConfigured(business?: any): boolean {
    return smsReady(business);
  }
}

export const bookingManagementService = new BookingManagementService();
export default bookingManagementService;
