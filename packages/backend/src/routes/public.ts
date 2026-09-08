import { Router, Request, Response, NextFunction } from 'express';
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
import { invoiceService } from '../services/InvoiceService';
import { ensurePhoneAndEmailFields } from '../services/FormContactFields';
import { subscriptionService } from '../services/SubscriptionService';
import { serveMediaAsset } from '../services/MediaService';
import { ownerAuthOtpService } from '../services/OwnerAuthOtpService';
import { googleTokenVerifier } from '../services/GoogleTokenVerifier';
import { orgAuthService } from '../services/OrgAuthService';
import { hashOwnerPassword } from '../services/OwnerPassword';

export const publicRouter = Router();

publicRouter.get('/media/:id', (req, res) => {
  void serveMediaAsset(req, res);
});

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
    if (!identifier || identifier === 'signup' || identifier === 'auth' || identifier === 'media' || identifier.startsWith('owner') || identifier.startsWith('internal')) {
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
  signupToken: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  ownerPassword: z.string().min(8).max(72),
  timezone: z.string().optional(),
  ownerWhatsapp: z.string().optional().nullable(),
});

const requiredCustomerPhone = z.preprocess(
  (value) => (value == null ? '' : String(value).trim()),
  z.string().min(7, 'Phone number is required').max(30)
);
const optionalCustomerPhone = z.preprocess(
  (value) => (value == null ? '' : String(value).trim()),
  z.union([z.literal(''), z.string().min(7, 'Enter a valid phone number').max(30)])
);
const optionalCustomerEmail = z.preprocess(
  (value) => {
    const trimmed = value == null ? '' : String(value).trim();
    return trimmed === '' ? null : trimmed;
  },
  z.string().email().max(254).nullable()
);

const bookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format'),
  serviceId: z.string().min(1),
  staffId: z.string().optional().nullable(),
  customerName: z.string().trim().min(1),
  customerPhone: requiredCustomerPhone,
  customerEmail: optionalCustomerEmail,
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
  customerPhone: optionalCustomerPhone,
  customerEmail: optionalCustomerEmail,
  staffId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  durationMinutes: z.number().int().positive().optional(),
  source: z.string().optional().nullable(),
  formData: z.record(z.any()).optional(),
}).refine((value) => !!(value.customerPhone || value.customerEmail), {
  message: 'Add a phone number or email so we can notify you',
});

const recurringSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  serviceId: z.string().min(1),
  staffId: z.string().optional().nullable(),
  customerName: z.string().trim().min(1),
  customerPhone: requiredCustomerPhone,
  customerEmail: optionalCustomerEmail,
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
  customerPhone: requiredCustomerPhone,
  customerEmail: optionalCustomerEmail,
  formData: z.record(z.any()).optional(),
  source: z.string().optional().nullable(),
}).strict(); // reject client-supplied amount/finalPrice/duration/endTime/paymentMode

const paymentVerifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

// ---------- Signup (public) ----------

/** Map a service error (may carry .status) to an HTTP response. */
function mapAuthError(error: any, res: Response) {
  const status = typeof error?.status === 'number' ? error.status : 400;
  res.status(status).json({ error: error?.message || 'Request failed' });
}

/**
 * POST /auth/signup/request-otp { email } — starts verified signup
 * (email → OTP). 409 if the email is already registered.
 */
publicRouter.post('/auth/signup/request-otp', async (req: Request, res: Response) => {
  try {
    const { email } = z.object({ email: z.string().trim().email() }).parse(req.body);
    const existingUser = await orgAuthService.findUserByEmail(email);
    const existingBusiness = existingUser
      ? null
      : await prisma.business.findFirst({
          where: { ownerEmail: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
    if (existingUser || existingBusiness) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }
    await ownerAuthOtpService.requestOtp(email, 'SIGNUP', req.ip || null);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'A valid email is required' });
    mapAuthError(error, res);
  }
});

/**
 * POST /auth/signup/verify-otp { email, code } → { signupToken }
 */
publicRouter.post('/auth/signup/verify-otp', async (req: Request, res: Response) => {
  try {
    const { email, code } = z.object({ email: z.string().trim().email(), code: z.string().trim().min(1).max(10) }).parse(req.body);
    await ownerAuthOtpService.verifyOtp(email, 'SIGNUP', code);
    const signupToken = ownerAuthOtpService.issueToken('SIGNUP', email);
    res.json({ ok: true, signupToken });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'A valid email and code are required' });
    mapAuthError(error, res);
  }
});

/**

 * Create a new business workspace. Generates a unique slug and an opaque
 * public code. The owner receives a JWT immediately.
 */
publicRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const parsed = signupSchema.parse(req.body);
    const email = ownerAuthOtpService.verifyToken(parsed.signupToken, 'owner_signup');

    const existingUser = await orgAuthService.findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }

    const tz = parsed.timezone || 'Asia/Kolkata';
    if (!timeService.isValidTimezone(tz)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    const { user, org, business } = await orgAuthService.createOwnerWorkspace({
      name: parsed.name,
      email,
      timezone: tz,
      password: parsed.ownerPassword,
      emailVerifiedAt: new Date(),
    });

    res.status(201).json(
      orgAuthService.sessionPayload({
        userId: user.id,
        orgId: org.id,
        business,
        role: 'OWNER',
      })
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    mapAuthError(error, res);
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
    const subView = await subscriptionService.getSubscriptionView(business.id, new Date());
    const bookingWindowDays = subView.isActive ? business.bookingWindowDays : 0;

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
        select: {
          id: true, name: true, role: true, phone: true, email: true, color: true, isActive: true,
          // salary intentionally excluded — never exposed publicly.
        },
      }),
      prisma.formField.findMany({
        where: { businessId: business.id },
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
        bookingWindowDays,
        minBookingNoticeHours: business.minBookingNoticeHours ?? 0,
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
      formFields: ensurePhoneAndEmailFields(formFields)
        .filter((field) => field.visible)
        .map((field, index) => ({
          ...field,
          id: field.id || (field.fieldType === 'tel' ? 'contact-phone' : field.fieldType === 'email' ? 'contact-email' : `field-${index}`),
        })),
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
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const subView = await subscriptionService.getSubscriptionView(business.id, new Date());
    if (!subView.isActive) {
      if (!parsed.serviceId) return res.json([]);
      return res.json({
        date: parsed.date,
        serviceId: parsed.serviceId,
        durationMinutes: 0,
        bufferMinutes: 0,
        timezone: business.timezone || 'Asia/Kolkata',
        slots: [],
        nextAvailable: null,
      });
    }

    // If no serviceId is supplied, fall back to the legacy flow for compat.
    if (!parsed.serviceId) {
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

/**
 * POST /auth/forgot/request-otp { email } — generic response either way
 * (no account enumeration). OTP is only sent when an account exists.
 */
publicRouter.post('/auth/forgot/request-otp', async (req: Request, res: Response) => {
  try {
    const { email } = z.object({ email: z.string().trim().email() }).parse(req.body);
    const existing = await prisma.business.findFirst({
      where: { ownerEmail: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      try {
        await ownerAuthOtpService.requestOtp(email, 'PASSWORD_RESET', req.ip || null);
      } catch (e: any) {
        if (e?.status === 429) return res.status(429).json({ error: e.message });
      }
    }
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'A valid email is required' });
    mapAuthError(error, res);
  }
});

/**
 * POST /auth/forgot/verify-otp { email, code } → { resetToken }
 */
publicRouter.post('/auth/forgot/verify-otp', async (req: Request, res: Response) => {
  try {
    const { email, code } = z.object({ email: z.string().trim().email(), code: z.string().trim().min(1).max(10) }).parse(req.body);
    await ownerAuthOtpService.verifyOtp(email, 'PASSWORD_RESET', code);
    const resetToken = ownerAuthOtpService.issueToken('PASSWORD_RESET', email);
    res.json({ ok: true, resetToken });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'A valid email and code are required' });
    mapAuthError(error, res);
  }
});

/**
 * POST /auth/forgot/reset { resetToken, newPassword } — set a new password
 * (works for Google-linked accounts too).
 */
publicRouter.post('/auth/forgot/reset', async (req: Request, res: Response) => {
  try {
    const { resetToken, newPassword } = z.object({
      resetToken: z.string().min(1),
      newPassword: z.string().min(8).max(72),
    }).parse(req.body);
    const email = ownerAuthOtpService.verifyToken(resetToken, 'owner_password_reset');
    const user = await orgAuthService.findUserByEmail(email);
    const business = user
      ? true
      : await prisma.business.findFirst({
          where: { ownerEmail: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
    if (!user && !business) {
      return res.status(400).json({ error: 'Account not found' });
    }
    await orgAuthService.setPasswordForEmail(email, await hashOwnerPassword(newPassword));
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'A valid token and new password are required' });
    mapAuthError(error, res);
  }
});


/**
 * POST /auth/google { credential } — verify the GIS ID token server-side.
 * Existing same-email account → auto-link + owner JWT.
 * New email → { needsSignupCompletion: true, googleSignupToken }.
 */
publicRouter.post('/auth/google', async (req: Request, res: Response) => {
  try {
    const { credential } = z.object({ credential: z.string().min(1) }).parse(req.body);
    const googleUser = await googleTokenVerifier.verifyCredential(credential);
    const email = googleUser.email.trim().toLowerCase();

    let user = await orgAuthService.findUserByEmail(email);
    if (!user) {
      const existingBiz = await prisma.business.findFirst({
        where: { ownerEmail: { equals: email, mode: 'insensitive' } },
      });
      if (existingBiz) {
        await orgAuthService.ensureOrgForBusiness(existingBiz.id);
        user = await orgAuthService.findUserByEmail(email);
      }
    }

    if (user) {
      if (!user.googleSub) {
        await prisma.user.update({
          where: { id: user.id },
          data: { googleSub: googleUser.sub, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
        });
        await prisma.business.updateMany({
          where: { ownerEmail: { equals: email, mode: 'insensitive' } },
          data: { googleSub: googleUser.sub, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
        });
      } else if (user.googleSub !== googleUser.sub) {
        return res.status(409).json({
          error: 'This email is already linked to a different Google account. Sign in with email and password, or use Forgot password.',
        });
      }

      const shop = await orgAuthService.resolveLoginShop(user.id);
      if (!shop) {
        return res.status(401).json({ error: 'No shop access for this account' });
      }
      return res.json({
        needsSignupCompletion: false,
        ...orgAuthService.sessionPayload({
          userId: user.id,
          orgId: shop.orgId,
          business: shop.business,
          role: shop.role,
        }),
      });
    }

    const googleSignupToken = jwt.sign(
      { typ: 'owner_google_signup', email, sub: googleUser.sub },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: 30 * 60 } as any
    );
    res.json({
      needsSignupCompletion: true,
      googleSignupToken,
      email,
      name: googleUser.name || '',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Missing Google credential' });
    const status = /not configured/i.test(error?.message || '') ? 503 : 400;
    res.status(status).json({ error: error?.message || 'Google sign-in failed' });
  }
});

/**
 * POST /auth/google/complete { googleSignupToken, name, timezone } — finish a
 * new Google signup (no password required; ownerPassword stays null until the
 * owner sets one in Settings).
 */
publicRouter.post('/auth/google/complete', async (req: Request, res: Response) => {
  try {
    const parsed = z.object({
      googleSignupToken: z.string().min(1),
      name: z.string().trim().min(2).max(120),
      timezone: z.string().optional(),
    }).parse(req.body);

    const decoded = jwt.verify(parsed.googleSignupToken, process.env.JWT_SECRET || 'fallback-secret') as any;
    if (decoded?.typ !== 'owner_google_signup' || !decoded?.email || !decoded?.sub) {
      return res.status(400).json({ error: 'Invalid or expired Google signup token' });
    }
    const email: string = String(decoded.email).trim().toLowerCase();

    const tz = parsed.timezone || 'Asia/Kolkata';
    if (!timeService.isValidTimezone(tz)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    const existingUser = await orgAuthService.findUserByEmail(email);
    if (existingUser) {
      const shop = await orgAuthService.resolveLoginShop(existingUser.id);
      if (!shop) {
        return res.status(401).json({ error: 'No shop access for this account' });
      }
      return res.json(
        orgAuthService.sessionPayload({
          userId: existingUser.id,
          orgId: shop.orgId,
          business: shop.business,
          role: shop.role,
        })
      );
    }

    const { user, org, business } = await orgAuthService.createOwnerWorkspace({
      name: parsed.name,
      email,
      timezone: tz,
      googleSub: decoded.sub,
      emailVerifiedAt: new Date(),
    });

    res.status(201).json(
      orgAuthService.sessionPayload({
        userId: user.id,
        orgId: org.id,
        business,
        role: 'OWNER',
      })
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(400).json({ error: 'Invalid or expired Google signup token' });
    }
    mapAuthError(error, res);
  }
});


// ---------- Bookings ----------

publicRouter.post('/:identifier/bookings', async (req: Request, res: Response) => {
  try {
    const parsed = bookingSchema.parse(req.body);
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const subView = await subscriptionService.getSubscriptionView(business.id, new Date());
    if (!subView.isActive) {
      return res.status(402).json({ error: 'Subscription required. Your booking services are currently paused.' });
    }
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
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const subView = await subscriptionService.getSubscriptionView(business.id, new Date());
    if (!subView.isActive) return res.status(402).json({ error: 'Subscription required. Waitlist is paused.' });
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
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const subView = await subscriptionService.getSubscriptionView(business.id, new Date());
    if (!subView.isActive) {
      return res.status(402).json({ error: 'Subscription required. Recurring booking is paused.' });
    }
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

/** Download or view invoice HTML for a paid booking (management session required). */
publicRouter.get('/:identifier/bookings/:id/manage/invoice', async (req: Request, res: Response) => {
  try {
    const sessionToken = sessionHeader(req);
    if (!sessionToken) return res.status(401).json({ error: 'Unauthorized' });
    const business = await businessResolver.resolveOrThrow(req.params.identifier);
    const { booking } = await bookingManagementService.authorizeSession(sessionToken);
    if (booking.id !== req.params.id || booking.businessId !== business.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!invoiceService.bookingHasInvoiceAccess(booking)) {
      return res.status(403).json({ error: 'Invoice is only available for paid bookings' });
    }
    const invoice = await invoiceService.getOrCreatePaidBookingInvoice(business.id, booking.id);
    const html = await invoiceService.renderInvoiceHtmlAsync({ ...invoice, booking }, business);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber}.html"`);
    res.send(html);
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
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

    if (!business.allowCustomerCancel) {
      return res.status(403).json({ error: 'Online cancellation is not available for this business. Please contact the salon.' });
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
