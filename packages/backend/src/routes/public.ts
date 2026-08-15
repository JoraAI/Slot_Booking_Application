import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { availabilityService } from '../services/AvailabilityService';
import { bookingService } from '../services/BookingService';
import { waitlistService } from '../services/WaitlistService';
import { recurringService } from '../services/RecurringService';
import { paymentService } from '../services/PaymentService';
import { paymentFlowService } from '../services/PaymentFlowService';
import { refundService } from '../services/RefundService';
import { notificationService } from '../services/NotificationService';
import { reminderService } from '../services/ReminderService';
import { featureGuard } from '../services/FeatureGuard';
import { pricingService } from '../services/PricingService';
import { timeService } from './../services/TimeService';
import { businessResolver } from '../services/BusinessResolver';
import { locationInfo } from '../services/LocationService';
import { bookingManagementService } from '../services/BookingManagementService';

export const publicRouter = Router();

/**
 * Embed-origin enforcement. Only applies when the embedding allowlist is
 * configured (non-empty). An empty allowlist preserves the historical permissive
 * behavior. Requests without an Origin header (direct navigation, server-to-server,
 * QR scans) are never blocked. The platform's own FRONTEND_URL is always allowed
 * so standalone/direct booking keeps working.
 */
async function embedOriginGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return next();
    // `router.use` middleware sees no `:identifier` param yet; parse it from the path.
    const segments = req.path.split('/').filter(Boolean);
    const identifier = segments[0];
    if (!identifier || identifier === 'signup' || identifier.startsWith('owner') || identifier.startsWith('internal')) {
      return next();
    }
    const business = await businessResolver.resolve(identifier);
    if (!business) return next(); // let the route produce the 404
    const allowlist = business.embedAllowedOrigins || [];
    if (allowlist.length === 0) return next(); // permissive when unconfigured
    const frontendOrigin = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const matches = (o: string) => {
      const trimmed = o.replace(/\/$/, '');
      return trimmed === origin.replace(/\/$/, '');
    };
    if (frontendOrigin && matches(frontendOrigin)) return next();
    if (allowlist.some(matches)) return next();
    return res.status(403).json({ error: 'Embedding is not allowed for this origin' });
  } catch (e) {
    return next(); // never block on guard errors; the route handles resolution
  }
}

publicRouter.use(embedOriginGuard);

// ---------- Zod validation schemas ----------

const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().email(),
  ownerPassword: z.string().min(8).max(72),
  timezone: z.string().optional(),
  ownerWhatsapp: z.string().optional().nullable(),
});

const bookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format'),
  serviceId: z.string().min(1),
  staffId: z.string().optional().nullable(),
  customerName: z.string().trim().min(1),
  customerPhone: z.string().trim().min(7),
  customerEmail: z.string().trim().email().optional().nullable(),
  formData: z.record(z.any()).optional(),
  isRecurring: z.boolean().optional(),
  recurringRule: z.string().optional().nullable(),
  recurringGroupId: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
});

const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  serviceId: z.string().min(1).optional(),
  staffId: z.string().optional(),
});

const waitlistSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  customerName: z.string().trim().min(1),
  customerPhone: z.string().trim().min(7),
  customerEmail: z.string().trim().email().optional().nullable(),
  staffId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  durationMinutes: z.number().int().positive().optional(),
  source: z.string().optional().nullable(),
  formData: z.record(z.any()).optional(),
});

const recurringSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  serviceId: z.string().min(1),
  staffId: z.string().optional().nullable(),
  customerName: z.string().trim().min(1),
  customerPhone: z.string().trim().min(7),
  customerEmail: z.string().trim().email().optional().nullable(),
  formData: z.record(z.any()).optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  count: z.number().int().min(1).max(52),
  skipDates: z.array(z.string()).optional(),
  source: z.string().optional().nullable(),
});

const paymentInitiateSchema = z.object({
  serviceId: z.string().min(1),
  staffId: z.string().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format'),
  customerName: z.string().trim().min(1),
  customerPhone: z.string().trim().min(7),
  customerEmail: z.string().trim().email().optional().nullable(),
  formData: z.record(z.any()).optional(),
  source: z.string().optional().nullable(),
}).strict(); // reject client-supplied amount/finalPrice/duration/endTime/paymentMode

const paymentVerifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

// ---------- Signup (public) ----------

/**
 * Create a new business workspace. Generates a unique slug and an opaque
 * public code. The owner receives a JWT immediately.
 */
publicRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const parsed = signupSchema.parse(req.body);

    const existing = await prisma.business.findFirst({
      where: { ownerEmail: parsed.ownerEmail },
    });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }

    const tz = parsed.timezone || 'Asia/Kolkata';
    if (!timeService.isValidTimezone(tz)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Unique slug
    let base = parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!base) base = 'business';
    let slug = base;
    let suffix = 2;
    while (await prisma.business.findUnique({ where: { slug } })) {
      slug = `${base}-${suffix++}`;
    }

    // Opaque public code (96+ bits entropy, URL-safe)
    let publicCode = '';
    for (let i = 0; i < 10; i++) {
      const candidate = require('crypto').randomBytes(16).toString('base64url');
      if (!(await prisma.business.findUnique({ where: { publicCode: candidate } }))) {
        publicCode = candidate;
        break;
      }
    }
    if (!publicCode) return res.status(500).json({ error: 'Could not generate a unique public code' });

    const hashedPassword = await bcrypt.hash(parsed.ownerPassword, 10);

    const business = await prisma.business.create({
      data: {
        name: parsed.name.trim(),
        slug,
        publicCode,
        timezone: tz,
        ownerEmail: parsed.ownerEmail,
        ownerWhatsapp: parsed.ownerWhatsapp || null,
        ownerPassword: hashedPassword,
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

    const token = jwt.sign(
      { businessId: business.id, email: business.ownerEmail },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any
    );

    res.status(201).json({
      token,
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        publicCode: business.publicCode,
        email: business.ownerEmail,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(400).json({ error: error.message });
  }
});

// ---------- Public config ----------

/**
 * Safe public business config. Explicit DTO — never returns owner secrets or
 * inactive/hidden content.
 */
publicRouter.get('/:identifier/config', async (req: Request, res: Response) => {
  try {
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const tz = business.timezone || 'Asia/Kolkata';
    const now = timeService.toUtc(tz, timeService.todayStr(tz), timeService.toTimeStr(new Date(), tz));

    const [serviceCategories, services, pageSections, workingHours, staff, formFields] = await Promise.all([
      prisma.serviceCategory.findMany({
        where: { businessId: business.id, isActive: true },
        orderBy: { displayOrder: 'asc' },
      }),
      prisma.service.findMany({
        where: { businessId: business.id, isActive: true },
        orderBy: [{ displayOrder: 'asc' }],
        include: { staff: true, workingHours: true },
      }),
      prisma.pageSection.findMany({
        where: { businessId: business.id, isVisible: true },
        orderBy: { displayOrder: 'asc' },
      }),
      prisma.workingHour.findMany({
        where: { businessId: business.id },
        orderBy: { dayOfWeek: 'asc' },
      }),
      prisma.staff.findMany({
        where: { businessId: business.id, isActive: true },
      }),
      prisma.formField.findMany({
        where: { businessId: business.id, visible: true },
        orderBy: { order: 'asc' },
      }),
    ]);

    // Public service payload with authoritative pricing
    const publicServices = services.map((s) => {
      const pricing = pricingService.computePricing(s, now);
      const { staff, workingHours, ...safe } = s;
      void workingHours;
      return {
        ...safe,
        displayedPricing: pricing,
        assignedStaffIds: staff.map((x) => x.staffId),
        workingHours: workingHours.map((w) => ({ dayOfWeek: w.dayOfWeek, openTime: w.openTime, closeTime: w.closeTime, isOpen: w.isOpen })),
      };
    });

    res.json({
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        publicCode: business.publicCode,
        timezone: business.timezone,
        description: business.description,
        bookingWindowDays: business.bookingWindowDays,
        showAvailableCount: business.showAvailableCount,
        branding: {
          logoUrl: business.logoUrl,
          coverImageUrl: business.coverImageUrl,
          primaryColor: business.primaryColor,
          secondaryColor: business.secondaryColor,
          accentColor: business.accentColor,
        },
        // Batch 4 — owner-consented salon location + server-generated directions.
        location: locationInfo(business),
      },
      serviceCategories,
      services: publicServices,
      pageSections,
      workingHours,
      staff,
      formFields,
      featureFlags: {
        waitlist: business.enableWaitlist,
        recurring: business.enableRecurring,
        payments: business.enablePayments,
        multiStaff: business.enableMultiStaff,
      },
      payment: {
        mode: business.paymentMode,
        depositAmount: business.depositAmount,
        depositPercentage: business.depositPercentage,
        testMode: business.razorpayTestMode,
        refundPolicy: business.refundPolicy,
      },
    });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});

// ---------- Availability ----------

publicRouter.get('/:identifier/availability', async (req: Request, res: Response) => {
  try {
    const parsed = availabilityQuerySchema.parse(req.query);

    // If no serviceId is supplied, fall back to the legacy flow for compat.
    if (!parsed.serviceId) {
      const business = await businessResolver.resolveOrThrow(req.params.identifier);
      const result = await availabilityService.getLegacyAvailability(
        business.slug,
        parsed.date,
        parsed.staffId
      );
      return res.json(result.slots);
    }

    const result = await availabilityService.getAvailability(
      req.params.identifier,
      parsed.date,
      parsed.serviceId,
      parsed.staffId
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// ---------- Bookings ----------

publicRouter.post('/:identifier/bookings', async (req: Request, res: Response) => {
  try {
    const parsed = bookingSchema.parse(req.body);
    const booking = await bookingService.createBooking(req.params.identifier, {
      ...parsed,
      source: parsed.source || 'DIRECT',
    });

    await notificationService.sendBookingConfirmation(booking, booking.business);
    await reminderService.scheduleForBooking(booking.business, booking);

    res.status(201).json(booking);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});

/**
 * Legacy public booking-by-ID routes are disabled (Batch 2A, P0): a random
 * booking ID is not customer authorization, and the legacy DELETE cancelled
 * paid bookings without a refund. Use the management-token endpoints:
 * POST /:identifier/bookings/:id/manage/session, then GET/DELETE .../manage.
 */
publicRouter.get('/:identifier/bookings/:id', (_req: Request, res: Response) => {
  res.status(410).json({ error: 'This endpoint is deprecated and disabled. Use /bookings/:id/manage with a management token.' });
});

publicRouter.put('/:identifier/bookings/:id', (_req: Request, res: Response) => {
  res.status(410).json({ error: 'This endpoint is deprecated and disabled. Use /bookings/:id/manage with a management token.' });
});

publicRouter.delete('/:identifier/bookings/:id', (_req: Request, res: Response) => {
  res.status(410).json({ error: 'This endpoint is deprecated and disabled. Use /bookings/:id/manage with a management token.' });
});

// ---------- Waitlist ----------

publicRouter.post('/:identifier/waitlist', featureGuard('waitlist'), async (req: Request, res: Response) => {
  try {
    const parsed = waitlistSchema.parse(req.body);
    const entry = await waitlistService.addToWaitlist(req.params.identifier, parsed);
    res.status(201).json(entry);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});

publicRouter.delete('/:identifier/waitlist/:id', featureGuard('waitlist'), async (req: Request, res: Response) => {
  try {
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    await waitlistService.removeEntry(business.id, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// ---------- Payments ----------

publicRouter.post('/:identifier/payments/initiate', featureGuard('payments'), async (req: Request, res: Response) => {
  try {
    const parsed = paymentInitiateSchema.parse(req.body);
    const result = await paymentFlowService.initiate(req.params.identifier, parsed);
    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});

publicRouter.post('/:identifier/payments/verify', featureGuard('payments'), async (req: Request, res: Response) => {
  try {
    const parsed = paymentVerifySchema.parse(req.body);
    const result = await paymentFlowService.verify(req.params.identifier, parsed);
    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});

// ---------- Recurring ----------

publicRouter.post('/:identifier/recurring', featureGuard('recurring'), async (req: Request, res: Response) => {
  try {
    const parsed = recurringSchema.parse(req.body);
    const result = await recurringService.createRecurringBooking(req.params.identifier, parsed);
    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});

// ---------- Customer booking management (token + optional OTP) ----------
//
// New bookings are managed exclusively through these endpoints using a
// cryptographically random management token (and, when the owner enables it, a
// verified OTP). A booking ID alone never authorizes these endpoints.

const manageSessionSchema = z.object({ token: z.string().min(32) }).strict();
const manageOtpRequestSchema = z.object({ token: z.string().min(32) }).strict();
const manageOtpVerifySchema = z.object({
  token: z.string().min(32),
  code: z.string().regex(/^\d{6}$/, 'Invalid verification code'),
}).strict();
function sessionHeader(req: Request): string | null {
  const v = req.headers['x-booking-session'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Establish a management session. OTP-enabled businesses require OTP next. */
publicRouter.post('/:identifier/bookings/:id/manage/session', async (req: Request, res: Response) => {
  try {
    const parsed = manageSessionSchema.parse(req.body);
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const booking = await bookingManagementService.authorizeToken(business.id, req.params.id, parsed.token);
    if (business.bookingManagementOtpEnabled) {
      return res.json({ otpRequired: true });
    }
    const { sessionToken } = await bookingManagementService.createSession(business.id, booking);
    res.json({
      otpRequired: false,
      sessionToken,
      booking: bookingManagementService.customerBookingView(booking),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});

/** Request an OTP for a token-authorized booking (OTP-enabled businesses). */
publicRouter.post('/:identifier/bookings/:id/manage/otp/request', async (req: Request, res: Response) => {
  try {
    const parsed = manageOtpRequestSchema.parse(req.body);
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const booking = await bookingManagementService.authorizeToken(business.id, req.params.id, parsed.token);
    if (!business.bookingManagementOtpEnabled) {
      return res.status(400).json({ error: 'OTP is not required for this business' });
    }
    const result = await bookingManagementService.requestOtp(business, booking, req.ip || null);
    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});

/** Verify the OTP and issue a short-lived booking-scoped session. */
publicRouter.post('/:identifier/bookings/:id/manage/otp/verify', async (req: Request, res: Response) => {
  try {
    const parsed = manageOtpVerifySchema.parse(req.body);
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const booking = await bookingManagementService.authorizeToken(business.id, req.params.id, parsed.token);
    const { sessionToken } = await bookingManagementService.verifyOtp(business, booking, parsed.code, req.ip || null);
    res.json({
      sessionToken,
      booking: bookingManagementService.customerBookingView(booking),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});

/** View a booking with a valid management session. */
publicRouter.get('/:identifier/bookings/:id/manage', async (req: Request, res: Response) => {
  try {
    const sessionToken = sessionHeader(req);
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized' });
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const { booking } = await bookingManagementService.authorizeSession(sessionToken);
    if (booking.id !== req.params.id || booking.businessId !== business.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json({ booking: bookingManagementService.customerBookingView(booking) });
  } catch (error: any) {
    res.status(error.status || 401).json({ error: error.message });
  }
});

/** Customer management currently supports viewing and cancellation only. */
publicRouter.put('/:identifier/bookings/:id/manage', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Customer rescheduling is not available' });
});

/** Cancel a booking with a valid management session. */
publicRouter.delete('/:identifier/bookings/:id/manage', async (req: Request, res: Response) => {
  try {
    const sessionToken = sessionHeader(req);
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized' });
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const { booking } = await bookingManagementService.authorizeSession(sessionToken);
    if (booking.id !== req.params.id || booking.businessId !== business.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Atomic: cancel + durable refund intent commit in one DB transaction
    // BEFORE any external I/O (Batch 2A P0). Capacity frees immediately.
    const { booking: cancelled, refundIntent, createdIntent } =
      await refundService.cancelBookingWithRefundIntent(business, booking.id);

    if (business.enableWaitlist) {
      const dateStr = timeService.toDateStr(cancelled.date, business.timezone || 'Asia/Kolkata');
      await waitlistService.notifyNext(business.id, dateStr, cancelled.startTime, {
        serviceId: cancelled.serviceId,
        staffId: cancelled.staffId,
      });
    }

    // Post-commit: initiate (creator) or reconcile (idempotent) the refund.
    const refund = await refundService.initiateOrReconcileRefund(refundIntent, cancelled, { createdIntent });

    // ONE customer + ONE owner message branching on the durable refund state.
    await notificationService.sendBookingCancellation(cancelled, business, refund);

    res.json({
      success: true,
      booking: bookingManagementService.customerBookingView({ ...cancelled, staff: cancelled.staff }),
      refund,
    });
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
  }
});
