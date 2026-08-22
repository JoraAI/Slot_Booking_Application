import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { bookingService } from '../services/BookingService';
import { waitlistService } from '../services/WaitlistService';
import { recurringService } from '../services/RecurringService';
import { refundService } from '../services/RefundService';
import { notificationService } from '../services/NotificationService';
import { reminderService } from '../services/ReminderService';
import { analyticsService } from '../services/AnalyticsService';
import { ownerFeatureGuard } from '../services/FeatureGuard';
import { timeService } from '../services/TimeService';
import { subscriptionService } from '../services/SubscriptionService';
import { walletService } from '../services/WalletService';
import { whatsappPricingService } from '../services/WhatsAppPricingService';
import { validateLocation } from '../services/LocationService';
import { encryptSecret } from '../services/secretCrypto';
import { toOwnerConfig } from '../services/ownerDto';
import { ensurePhoneAndEmailFields } from '../services/FormContactFields';
import {
  platformWhatsappConfigured,
  smtpConfigured,
  tenantWhatsappOptedIn,
} from '../services/notificationCredentials';
import {
  customerService,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
} from '../services/CustomerService';
import { hashOwnerPassword, isHashedOwnerPassword, verifyOwnerPassword } from '../services/OwnerPassword';
import { createMediaAsset, decodeImageBase64 } from '../services/MediaService';
import { attributeKeyFromLabel, attributesFromFormData, contactMatchesFilters } from '../services/CustomerAttributes';

export const ownerRouter = Router();

const optionalImageUrl = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.union([
    z.null(),
    z.string().trim().url().max(2000),
    z.string().trim().regex(/^\/api\/media\/[a-zA-Z0-9_-]+$/, 'Invalid media image URL'),
  ]).optional()
);

/**
 * @openapi
 * /owner/login:
 *   post:
 *     tags: [Owner - Auth]
 *     summary: Owner login
 *     description: Authenticate business owner with email and password. Returns a JWT token.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: "owner@demosalon.com" }
 *               password: { type: string, example: "admin123" }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 business:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string }
 *                     slug: { type: string }
 *                     email: { type: string }
 *       400:
 *         description: Missing email or password
 *       401:
 *         description: Invalid credentials
 */
ownerRouter.post('/login', async (req, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const business = await prisma.business.findFirst({
      where: { ownerEmail: { equals: String(email).trim(), mode: 'insensitive' } },
    });

    if (!business) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await verifyOwnerPassword(business.ownerPassword, password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!isHashedOwnerPassword(business.ownerPassword)) {
      await prisma.business.update({
        where: { id: business.id },
        data: { ownerPassword: await hashOwnerPassword(password) },
      });
    }

    const token = jwt.sign(
      { businessId: business.id, email: business.ownerEmail },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" } as any
    );

    res.json({
      token,
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        email: business.ownerEmail,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// All routes below require authentication
ownerRouter.use(authMiddleware);

/**
 * @openapi
 * /owner/me:
 *   get:
 *     tags: [Owner - Config]
 *     summary: Get current business info
 *     description: Returns the authenticated business's full configuration including working hours, form fields, and staff.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Business configuration
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BusinessConfig' }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Business not found
 */
ownerRouter.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.owner!.businessId },
      include: {
        workingHours: { orderBy: { dayOfWeek: 'asc' } },
        formFields: { orderBy: { order: 'asc' } },
        staff: { orderBy: { createdAt: 'asc' } },
        serviceCategories: { orderBy: { displayOrder: 'asc' } },
        services: {
          orderBy: [{ displayOrder: 'asc' }],
          include: { staff: true, workingHours: true },
        },
        pageSections: { orderBy: { displayOrder: 'asc' } },
        staffWorkingHours: true,
      },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json(toOwnerConfig(business));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/password:
 *   put:
 *     tags: [Owner - Auth]
 *     summary: Update dashboard password
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8, maxLength: 72 }
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Invalid password
 *       401:
 *         description: Current password is wrong
 */
ownerRouter.put('/password', async (req: AuthRequest, res: Response) => {
  try {
    const input = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'New password must be at least 8 characters').max(72),
    }).parse(req.body);

    const business = await prisma.business.findUnique({
      where: { id: req.owner!.businessId },
      select: { id: true, ownerPassword: true },
    });
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const matches = await verifyOwnerPassword(business.ownerPassword, input.currentPassword);
    if (!matches) return res.status(401).json({ error: 'Current password is incorrect' });
    if (input.currentPassword === input.newPassword) {
      return res.status(400).json({ error: 'Choose a different new password' });
    }

    await prisma.business.update({
      where: { id: business.id },
      data: { ownerPassword: await hashOwnerPassword(input.newPassword) },
    });
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || 'Invalid password' });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/bookings:
 *   get:
 *     tags: [Owner - Bookings]
 *     summary: List all bookings
 *     description: Returns paginated bookings for the authenticated business.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [CONFIRMED, CANCELLED, RESCHEDULED, COMPLETED, NO_SHOW] }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: staffId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated list of bookings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bookings: { type: array, items: { $ref: '#/components/schemas/Booking' } }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 totalPages: { type: integer }
 *       401:
 *         description: Unauthorized
 */
ownerRouter.get('/bookings', async (req: AuthRequest, res: Response) => {
  try {
    const result = await bookingService.getOwnerBookings(
      req.owner!.businessId,
      req.query as any
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/bookings/{id}:
 *   get:
 *     tags: [Owner - Bookings]
 *     summary: Get booking by ID
 *     description: Returns a single booking with staff details.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Booking details
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Booking' }
 *       404:
 *         description: Booking not found
 */
ownerRouter.get('/bookings/:id', async (req: AuthRequest, res: Response) => {
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
      include: { staff: true },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json(booking);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/bookings/{id}:
 *   put:
 *     tags: [Owner - Bookings]
 *     summary: Update booking status
 *     description: Update a booking's status (e.g., mark as COMPLETED, NO_SHOW).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [CONFIRMED, CANCELLED, RESCHEDULED, COMPLETED, NO_SHOW] }
 *     responses:
 *       200:
 *         description: Updated booking
 *       400:
 *         description: Invalid status or update failed
 *       404:
 *         description: Booking not found
 */
ownerRouter.put('/bookings/:id', async (req: AuthRequest, res: Response) => {
  try {
    // Reschedule path: validate availability (excluding the moved booking) and
    // rebuild reminders only after success.
    if (req.body.date || req.body.startTime) {
      const business = await prisma.business.findUnique({
        where: { id: req.owner!.businessId },
        select: { id: true, publicCode: true, timezone: true, remindersEnabled: true, reminderOffsetsMinutes: true, notifyCustomerEmail: true, notifyCustomerWhatsapp: true },
      });
      if (!business) return res.status(404).json({ error: 'Business not found' });

      const updated = await bookingService.updateBooking(
        business.publicCode,
        req.params.id,
        { date: req.body.date, startTime: req.body.startTime, staffId: req.body.staffId },
        { excludeBookingId: req.params.id }
      );

      await reminderService.cancelForBooking(updated.id);
      await reminderService.scheduleForBooking(business as any, updated);
      await notificationService.sendBookingUpdate(updated, business as any, req.body);
      return res.json(updated);
    }

    if (req.body.status === 'CANCELLED') {
      // Batch 2A: owner cancellation routes through the same atomic
      // cancel + durable refund orchestration as customer cancels.
      const business = await prisma.business.findUnique({ where: { id: req.owner!.businessId } });
      if (!business) return res.status(404).json({ error: 'Business not found' });

      const { booking: cancelled, refundIntent, createdIntent } =
        await refundService.cancelBookingWithRefundIntent(business, req.params.id);

      if (business.enableWaitlist) {
        const dateStr = timeService.toDateStr(cancelled.date, business.timezone || 'Asia/Kolkata');
        await waitlistService.notifyNext(business.id, dateStr, cancelled.startTime, {
          serviceId: cancelled.serviceId,
          staffId: cancelled.staffId,
        });
      }

      const refund = await refundService.initiateOrReconcileRefund(refundIntent, cancelled, { createdIntent });
      await notificationService.sendBookingCancellation(cancelled, business, refund);
      return res.json({ ...cancelled, refund });
    }

    const booking = await bookingService.updateBookingStatus(
      req.owner!.businessId,
      req.params.id,
      req.body.status
    );
    res.json(booking);
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/bookings/{id}:
 *   delete:
 *     tags: [Owner - Bookings]
 *     summary: Cancel a booking
 *     description: Cancels a booking, sends cancellation notification, and triggers waitlist notification if enabled.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cancelled booking
 *       400:
 *         description: Cancellation failed
 *       404:
 *         description: Booking not found
 */
ownerRouter.delete('/bookings/:id', async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.owner!.businessId },
    });
    if (!business) return res.status(404).json({ error: 'Business not found' });

    // Batch 2A: route through the atomic cancel + durable refund orchestration.
    const { booking: cancelled, refundIntent, createdIntent } =
      await refundService.cancelBookingWithRefundIntent(business, req.params.id);

    if (business.enableWaitlist) {
      const dateStr = timeService.toDateStr(cancelled.date, business.timezone || 'Asia/Kolkata');
      await waitlistService.notifyNext(business.id, dateStr, cancelled.startTime, {
        serviceId: cancelled.serviceId,
        staffId: cancelled.staffId,
      });
    }

    const refund = await refundService.initiateOrReconcileRefund(refundIntent, cancelled, { createdIntent });
    await notificationService.sendBookingCancellation(cancelled, business, refund);

    res.json({ ...cancelled, refund });
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/block:
 *   post:
 *     tags: [Owner - Block Slots]
 *     summary: Block a time slot
 *     description: Block a time slot to prevent bookings. Optionally assign to a specific staff member.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, startTime, endTime]
 *             properties:
 *               date: { type: string, format: date, example: "2025-01-15" }
 *               startTime: { type: string, example: "09:00" }
 *               endTime: { type: string, example: "10:00" }
 *               staffId: { type: string, description: "Optional staff ID" }
 *               reason: { type: string, example: "Lunch break" }
 *     responses:
 *       201:
 *         description: Slot blocked successfully
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BlockedSlot' }
 *       400:
 *         description: Invalid request
 */
const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must be HH:mm').transform((v) => v.slice(0, 5))

const blockSlotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  startTime: hhmm,
  endTime: hhmm,
  staffId: z.string().min(1).nullable().optional(),
  reason: z.string().max(200).nullable().optional(),
});

async function resolveBlockStaffId(businessId: string, staffId: string | null | undefined): Promise<string | null> {
  if (!staffId) return null;
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, businessId, isActive: true },
    select: { id: true },
  });
  if (!staff) throw new Error('Staff member not found');
  return staff.id;
}

ownerRouter.post('/block', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = blockSlotSchema.parse(req.body);
    if (parsed.endTime <= parsed.startTime) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }
    const staffId = await resolveBlockStaffId(req.owner!.businessId, parsed.staffId);
    const block = await prisma.blockedSlot.create({
      data: {
        businessId: req.owner!.businessId,
        date: timeService.dateToUtcMidnight(parsed.date),
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        staffId,
        reason: parsed.reason?.trim() || null,
      },
      include: { staff: true },
    });
    res.status(201).json(block);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/block/{id}:
 *   put:
 *     tags: [Owner - Block Slots]
 *     summary: Update a blocked slot
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, startTime, endTime]
 *             properties:
 *               date: { type: string, format: date }
 *               startTime: { type: string }
 *               endTime: { type: string }
 *               staffId: { type: string, nullable: true }
 *               reason: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Block updated
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Block not found
 */
ownerRouter.put('/block/:id', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = blockSlotSchema.parse(req.body);
    if (parsed.endTime <= parsed.startTime) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }
    const existing = await prisma.blockedSlot.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Blocked slot not found' });

    const staffId = await resolveBlockStaffId(req.owner!.businessId, parsed.staffId);
    const block = await prisma.blockedSlot.update({
      where: { id: existing.id },
      data: {
        date: timeService.dateToUtcMidnight(parsed.date),
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        staffId,
        reason: parsed.reason?.trim() || null,
      },
      include: { staff: true },
    });
    res.json(block);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/block/{id}:
 *   delete:
 *     tags: [Owner - Block Slots]
 *     summary: Remove a blocked slot
 *     description: Remove a slot block to allow bookings again.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Block removed
 *       400:
 *         description: Removal failed
 */
ownerRouter.delete('/block/:id', async (req: AuthRequest, res: Response) => {
  try {
    const block = await prisma.blockedSlot.delete({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    res.json(block);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/blocks:
 *   get:
 *     tags: [Owner - Block Slots]
 *     summary: List blocked slots
 *     description: Returns all blocked slots for the business, optionally filtered by date range and staff.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: staffId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of blocked slots
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/BlockedSlot' }
 */
ownerRouter.get('/blocks', async (req: AuthRequest, res: Response) => {
  try {
    const { dateFrom, dateTo, staffId } = req.query as any;
    const where: any = { businessId: req.owner!.businessId };
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom + 'T00:00:00Z');
      if (dateTo) where.date.lte = new Date(dateTo + 'T23:59:59Z');
    }
    if (staffId) where.staffId = staffId;

    const blocks = await prisma.blockedSlot.findMany({
      where,
      include: { staff: true },
      orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
    });
    res.json(blocks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/config:
 *   put:
 *     tags: [Owner - Config]
 *     summary: Update business configuration
 *     description: Update business settings including feature flags, payment config, notification preferences, etc.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               bookingWindowDays: { type: integer }
 *               showAvailableCount: { type: boolean }
 *               notifyOwnerEmail: { type: boolean }
 *               notifyOwnerWhatsapp: { type: boolean }
 *               notifyCustomerEmail: { type: boolean }
 *               notifyCustomerWhatsapp: { type: boolean }
 *               ownerWhatsapp: { type: string }
 *               enableWaitlist: { type: boolean }
 *               enableRecurring: { type: boolean }
 *               enablePayments: { type: boolean }
 *               enableMultiStaff: { type: boolean }
 *               paymentMode: { type: string, enum: [full, deposit, none] }
 *               depositAmount: { type: number }
 *               depositPercentage: { type: number }
 *               razorpayKeyId: { type: string }
 *               razorpayTestMode: { type: boolean }
 *               refundPolicy: { type: string }
 *               embedAllowedOrigins: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Updated business configuration
 *       400:
 *         description: Update failed
 *       401:
 *         description: Session expired
 */
ownerRouter.put('/config', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.business.findUnique({
      where: { id: req.owner!.businessId },
    });
    if (!existing) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    const allowedFields = [
      'name', 'description', 'timezone', 'primaryColor', 'secondaryColor', 'accentColor',
      'logoUrl', 'logoPublicId', 'coverImageUrl', 'coverImagePublicId',
      'slotGranularityMinutes', 'remindersEnabled', 'reminderOffsetsMinutes',
      'bookingManagementOtpEnabled', 'bookingManagementOtpChannel',
      'bookingWindowDays', 'minBookingNoticeHours',
      'showAvailableCount', 'notifyOwnerEmail', 'notifyOwnerWhatsapp',
      'notifyCustomerEmail', 'notifyCustomerWhatsapp', 'ownerEmail', 'ownerWhatsapp',
      'enableWaitlist', 'enableRecurring', 'enablePayments', 'enableMultiStaff',
      'paymentMode', 'depositAmount', 'depositPercentage',
      'razorpayKeyId', 'refundPolicy', 'embedAllowedOrigins',
      'razorpayTestMode',
      'address', 'latitude', 'longitude',
      'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpFromName',
      // Shared-platform WhatsApp: owners do NOT supply Meta Phone Number ID / tokens.
    ];
    // Explicitly ignore any client-supplied DIY Meta credential fields.
    delete req.body.metaWhatsappPhoneNumberId;
    delete req.body.metaWhatsappBusinessAccountId;
    delete req.body.metaWhatsappTemplateUtility;
    delete req.body.metaWhatsappTemplateMarketing;
    delete req.body.metaWhatsappAccessToken;
    delete req.body.clearMetaWhatsappAccessToken;

    const updateData: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (updateData.ownerEmail !== undefined) {
      const parsedEmail = z.string().trim().email().max(254).safeParse(updateData.ownerEmail);
      if (!parsedEmail.success) return res.status(400).json({ error: 'Enter a valid owner email address' });
      updateData.ownerEmail = parsedEmail.data.toLowerCase();
      const duplicate = await prisma.business.findFirst({
        where: {
          id: { not: existing.id },
          ownerEmail: { equals: updateData.ownerEmail, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (duplicate) return res.status(409).json({ error: 'That owner email is already used by another business' });
    }
    if (updateData.ownerWhatsapp !== undefined) {
      updateData.ownerWhatsapp = normalizeCustomerPhone(updateData.ownerWhatsapp);
    }
    if (updateData.bookingWindowDays !== undefined) {
      const days = Number(updateData.bookingWindowDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Booking window must be between 1 and 365 days' });
      }
      updateData.bookingWindowDays = days;
    }
    if (updateData.minBookingNoticeHours !== undefined) {
      const hours = Number(updateData.minBookingNoticeHours);
      if (!Number.isInteger(hours) || hours < 0 || hours > 168) {
        return res.status(400).json({ error: 'Earliest booking notice must be between 0 and 168 hours' });
      }
      updateData.minBookingNoticeHours = hours;
    }
    // subscription is intentionally managed via dedicated subscription endpoints

    for (const field of [
      'smtpHost',
      'smtpUser',
      'smtpFromName',
    ] as const) {
      if (updateData[field] !== undefined) {
        const value = String(updateData[field] ?? '').trim();
        if (value.length > 255) return res.status(400).json({ error: `${field} is too long` });
        updateData[field] = value === '' ? null : value;
      }
    }
    if (updateData.smtpPort !== undefined) {
      if (updateData.smtpPort === null || updateData.smtpPort === '') {
        updateData.smtpPort = null;
      } else {
        const port = Number(updateData.smtpPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return res.status(400).json({ error: 'SMTP port must be between 1 and 65535' });
        }
        updateData.smtpPort = port;
      }
    }
    if (updateData.smtpSecure !== undefined) {
      updateData.smtpSecure = updateData.smtpSecure === true;
    }

    // Write-only secrets: never read back. Blank keeps the existing value.
    if (typeof req.body.smtpPass === 'string' && req.body.smtpPass.trim() !== '') {
      updateData.smtpPassEnc = encryptSecret(req.body.smtpPass.trim());
    } else if (req.body.clearSmtpPass === true) {
      updateData.smtpPassEnc = null;
    }

    // Razorpay secret is WRITE-ONLY: never read back, never echoed.
    // - a non-empty value replaces the stored secret
    // - blank/null is ignored (keeps the existing secret)
    // - clearRazorpayKeySecret === true is the explicit intentional clear
    if (typeof req.body.razorpayKeySecret === 'string' && req.body.razorpayKeySecret.trim() !== '') {
      updateData.razorpayKeySecret = req.body.razorpayKeySecret.trim();
    } else if (req.body.clearRazorpayKeySecret === true) {
      updateData.razorpayKeySecret = null;
    }

    // OTP is email-only and requires SMTP. Refuse enabling when SMTP is missing.
    if (updateData.bookingManagementOtpEnabled === true) {
      updateData.bookingManagementOtpChannel = 'EMAIL';
      const merged = { ...existing, ...updateData };
      if (!smtpConfigured(merged)) {
        return res.status(400).json({ error: 'Email OTP requires SMTP credentials in Settings (username and password).' });
      }
    } else if (updateData.bookingManagementOtpChannel !== undefined) {
      // Channel is fixed to email; ignore legacy SMS / EITHER values from older clients.
      updateData.bookingManagementOtpChannel = 'EMAIL';
    }

    // Batch 2 — live paid checkout requires usable Razorpay credentials.
    // Test mode keeps working with no real keys. Refuse enabling a live
    // (non-test) paid checkout when Key ID or Key Secret are missing.
    const livePayments = updateData.enablePayments !== undefined ? updateData.enablePayments : existing.enablePayments;
    const liveMode = updateData.razorpayTestMode !== undefined ? updateData.razorpayTestMode : existing.razorpayTestMode;
    const liveModeEnabled = !!livePayments && liveMode === false;
    const mode = updateData.paymentMode !== undefined ? updateData.paymentMode : existing.paymentMode;
    if (liveModeEnabled && mode !== 'none') {
      const keyId = updateData.razorpayKeyId !== undefined ? updateData.razorpayKeyId : existing.razorpayKeyId;
      const newSecret = typeof req.body.razorpayKeySecret === 'string' ? req.body.razorpayKeySecret.trim() : '';
      const hasNewSecret = updateData.razorpayKeySecret != null && newSecret !== '';
      const hasExistingSecret = req.body.clearRazorpayKeySecret !== true && !!existing.razorpayKeySecret;
      if (!keyId || !(hasNewSecret || hasExistingSecret)) {
        return res.status(400).json({
          error: 'Live payments require both a Razorpay Key ID and Key Secret. Add the credentials or keep Test Mode enabled.',
        });
      }
    }

    // Deposit configuration: exactly one of a fixed amount or a percentage,
    // both positive, percentage <= 100.
    const depositMode =
      (updateData.paymentMode !== undefined ? updateData.paymentMode : existing.paymentMode) === 'deposit';
    if (depositMode) {
      const amount = updateData.depositAmount !== undefined ? updateData.depositAmount : existing.depositAmount;
      const pct = updateData.depositPercentage !== undefined ? updateData.depositPercentage : existing.depositPercentage;
      const hasAmount = amount != null && amount > 0;
      const hasPct = pct != null && pct > 0;
      if (hasAmount && hasPct) {
        return res.status(400).json({ error: 'Choose exactly one of deposit amount or deposit percentage' });
      }
      if (!hasAmount && !hasPct) {
        return res.status(400).json({ error: 'Deposit mode requires a fixed amount or a percentage' });
      }
      if (hasPct && (pct <= 0 || pct > 100)) {
        return res.status(400).json({ error: 'Deposit percentage must be between 1 and 100' });
      }
      if (hasAmount && amount <= 0) {
        return res.status(400).json({ error: 'Deposit amount must be positive' });
      }
    }

    // Batch 4 — salon location validation (address ≤ 500; lat/lng pair; bounds).
    // Merge with existing so a partial save (e.g. address only) still validates the pair.
    if (typeof updateData.address === 'string') {
      updateData.address = updateData.address.trim() || null;
    }
    if (updateData.address === '') updateData.address = null;
    const locationError = validateLocation({
      address: updateData.address !== undefined ? updateData.address : existing.address,
      latitude: updateData.latitude !== undefined ? updateData.latitude : existing.latitude,
      longitude: updateData.longitude !== undefined ? updateData.longitude : existing.longitude,
    });
    if (locationError) {
      return res.status(400).json({ error: locationError });
    }

    // Batch 4 — notification prerequisites. Refuse ENABLING a channel when its
    // platform prerequisites fail (same pattern as the OTP channel guards).
    // A flag already true in the DB (legacy default) is left alone so unrelated
    // settings saves are not blocked; the readiness UI warns about it.
    const merged = { ...existing, ...updateData };
    const smtp = smtpConfigured(merged);
    const whatsappConfig = await prisma.whatsAppConfig.findUnique({ where: { businessId: req.owner!.businessId } });
    const platformWa = platformWhatsappConfigured();
    const optedIn = tenantWhatsappOptedIn(whatsappConfig);
    const enabling = (field: string) => updateData[field] === true && (existing as any)[field] !== true;
    if (enabling('notifyCustomerEmail') && !smtp) {
      return res.status(400).json({ error: 'Customer email notifications require SMTP credentials in Settings.' });
    }
    if (enabling('notifyCustomerWhatsapp')) {
      if (!platformWa) {
        return res.status(400).json({ error: 'WhatsApp is not available yet — Reservly platform WhatsApp is not configured. Contact support.' });
      }
      if (!optedIn) {
        return res.status(400).json({ error: 'Enable WhatsApp in Settings (Connect) before turning on customer WhatsApp notifications.' });
      }
      if (!updateData.ownerWhatsapp && !existing.ownerWhatsapp) {
        return res.status(400).json({ error: 'Customer WhatsApp notifications require the salon owner WhatsApp number (used as the customer contact).' });
      }
    }
    if (enabling('notifyOwnerWhatsapp')) {
      if (!platformWa) {
        return res.status(400).json({ error: 'WhatsApp is not available yet — Reservly platform WhatsApp is not configured. Contact support.' });
      }
      if (!optedIn) {
        return res.status(400).json({ error: 'Enable WhatsApp in Settings (Connect) before turning on owner WhatsApp notifications.' });
      }
      if (!updateData.ownerWhatsapp && !existing.ownerWhatsapp) {
        return res.status(400).json({ error: 'Owner WhatsApp notifications require an owner WhatsApp number.' });
      }
    }

    const business = await prisma.business.update({
      where: { id: req.owner!.businessId },
      data: updateData,
    });

    res.json(toOwnerConfig(business));
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/working-hours:
 *   put:
 *     tags: [Owner - Config]
 *     summary: Update working hours
 *     description: Replace all working hours for the business. Deletes existing and creates new.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workingHours]
 *             properties:
 *               workingHours:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [dayOfWeek, openTime, closeTime, isOpen]
 *                   properties:
 *                     dayOfWeek: { type: integer, minimum: 0, maximum: 6 }
 *                     openTime: { type: string, example: "09:00" }
 *                     closeTime: { type: string, example: "18:00" }
 *                     isOpen: { type: boolean }
 *     responses:
 *       200:
 *         description: Working hours updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer }
 *       400:
 *         description: Update failed
 */
ownerRouter.put('/working-hours', async (req: AuthRequest, res: Response) => {
  try {
    const { workingHours } = req.body;
    const businessId = req.owner!.businessId;

    await prisma.workingHour.deleteMany({ where: { businessId } });
    const created = await prisma.workingHour.createMany({
      data: workingHours.map((wh: any) => ({
        businessId,
        dayOfWeek: wh.dayOfWeek,
        openTime: wh.openTime,
        closeTime: wh.closeTime,
        isOpen: wh.isOpen,
      })),
    });

    res.json({ count: created.count });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/form-fields:
 *   put:
 *     tags: [Owner - Config]
 *     summary: Update form fields
 *     description: Replace all custom form fields for the business intake form.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [formFields]
 *             properties:
 *               formFields:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [label, fieldType]
 *                   properties:
 *                     label: { type: string }
 *                     fieldType: { type: string, enum: [text, number, select, checkbox, tel, email, textarea] }
 *                     required: { type: boolean }
 *                     options: { type: array, items: { type: string } }
 *                     placeholder: { type: string }
 *                     order: { type: integer }
 *                     visible: { type: boolean }
 *     responses:
 *       200:
 *         description: Form fields updated
 *       400:
 *         description: Update failed
 */
ownerRouter.put('/form-fields', async (req: AuthRequest, res: Response) => {
  try {
    const fieldSchema = z.object({
      label: z.string().trim().min(1).max(120),
      fieldType: z.enum(['text', 'number', 'select', 'checkbox', 'tel', 'email', 'textarea']),
      required: z.boolean().default(false),
      options: z.array(z.string().trim().min(1)).default([]),
      placeholder: z.string().trim().max(200).optional().nullable(),
      order: z.number().int().min(0).optional(),
      visible: z.boolean().default(true),
    });
    // `formFields` is the key the dashboard sends; `fields` is accepted for
    // older API clients.
    const schema = z.object({
      formFields: z.array(fieldSchema).max(50).optional(),
      fields: z.array(fieldSchema).max(50).optional(),
    }).refine((body) => body.formFields !== undefined || body.fields !== undefined, {
      message: 'formFields is required',
    });
    const parsed = schema.parse(req.body);
    const previous = await prisma.formField.findMany({
      where: { businessId: req.owner!.businessId },
      orderBy: { order: 'asc' },
    });
    const incoming = ensurePhoneAndEmailFields(
      parsed.formFields ?? parsed.fields ?? [],
      previous as Array<{ label: string; fieldType: string; required: boolean; options?: string[]; placeholder?: string | null; order?: number; visible: boolean }>
    );

    const invalidSelect = incoming.find((f) => f.fieldType === 'select' && f.options.length === 0);
    if (invalidSelect) {
      return res.status(400).json({ error: `Select field "${invalidSelect.label}" needs at least one option` });
    }

    const businessId = req.owner!.businessId;

    // Replace atomically: a failure must never leave the business with no
    // intake form, which would block every booking.
    const fields = await prisma.$transaction(async (tx) => {
      await tx.formField.deleteMany({ where: { businessId } });
      await tx.formField.createMany({
        data: incoming.map((f, index) => ({
          businessId,
          label: f.label,
          fieldType: f.fieldType,
          required: f.fieldType === 'tel' ? true : f.required,
          options: f.fieldType === 'select' ? f.options : [],
          placeholder: f.placeholder || null,
          order: f.order ?? index,
          visible: f.fieldType === 'tel' || f.fieldType === 'email' ? true : f.visible,
        })),
      });
      return tx.formField.findMany({ where: { businessId }, orderBy: { order: 'asc' } });
    });

    res.json({ count: fields.length, formFields: fields });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || 'Invalid form fields', issues: error.issues });
    }
    res.status(400).json({ error: error.message });
  }
});

// ---------- Customer phonebook ----------

const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().nullable(),
  lastServiceName: z.string().trim().max(160).optional().nullable().or(z.literal('')),
  lastBookedAt: z.string().trim().max(40).optional().nullable().or(z.literal('')),
}).refine((value) => !!(value.phone || value.email), {
  message: 'Add at least a phone number or email address',
});

function parseOwnerBookedAt(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (day) return new Date(`${day[1]}-${day[2]}-${day[3]}T12:00:00.000Z`);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new Error('Enter a valid last booked date');
  return parsed;
}

ownerRouter.get('/customers', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const query = String(req.query.q || '').trim();
    const businessId = req.owner!.businessId;
    const where: any = {
      businessId,
      ...(query ? {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
          { email: { contains: query, mode: 'insensitive' } },
          { lastServiceName: { contains: query, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const [customers, total] = await Promise.all([
      prisma.customerContact.findMany({
        where,
        orderBy: [{ lastBookedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.customerContact.count({ where }),
    ]);
    res.json({ customers, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.post('/customers', async (req: AuthRequest, res: Response) => {
  try {
    const input = customerInputSchema.parse(req.body);
    const customer = await customerService.upsertContact(req.owner!.businessId, {
      name: input.name,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      lastServiceName: input.lastServiceName || null,
      lastBookedAt: parseOwnerBookedAt(input.lastBookedAt ?? null),
    });
    res.status(201).json(customer);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || 'Invalid customer' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A customer with this phone or email already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.put('/customers/:id', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const existing = await prisma.customerContact.findFirst({
      where: { id: req.params.id, businessId },
    });
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    const input = customerInputSchema.parse({
      name: req.body.name ?? existing.name,
      phone: req.body.phone !== undefined ? req.body.phone : existing.phone,
      email: req.body.email !== undefined ? req.body.email : existing.email,
      notes: req.body.notes !== undefined ? req.body.notes : existing.notes,
      lastServiceName: req.body.lastServiceName !== undefined ? req.body.lastServiceName : existing.lastServiceName,
      lastBookedAt: req.body.lastBookedAt !== undefined
        ? req.body.lastBookedAt
        : (existing.lastBookedAt ? existing.lastBookedAt.toISOString() : ''),
    });
    const customer = await customerService.upsertContact(businessId, {
      name: input.name,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      lastServiceName: input.lastServiceName || null,
      lastBookedAt: parseOwnerBookedAt(input.lastBookedAt ?? null),
    }, { keepId: existing.id });
    res.json(customer);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || 'Invalid customer' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A customer with this phone or email already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.delete('/customers/:id', async (req: AuthRequest, res: Response) => {
  const result = await prisma.customerContact.deleteMany({
    where: { id: req.params.id, businessId: req.owner!.businessId },
  });
  if (result.count === 0) return res.status(404).json({ error: 'Customer not found' });
  res.status(204).send();
});

ownerRouter.post('/notifications/send', async (req: AuthRequest, res: Response) => {
  try {
    const input = z.object({
      customerId: z.string().trim().min(1).optional().nullable(),
      name: z.string().trim().max(120).optional().nullable(),
      phone: z.string().trim().max(30).optional().nullable(),
      email: z.string().trim().email().max(254).optional().nullable().or(z.literal('')),
      channels: z.array(z.enum(['email', 'whatsapp'])).min(1).max(2),
      subject: z.string().trim().min(1).max(160).default('Message from your salon'),
      message: z.string().trim().min(1).max(3000),
      messageHtml: z.string().trim().max(12000).optional().nullable(),
      imageUrl: optionalImageUrl,
    }).parse(req.body);

    const channels = [...new Set(input.channels)];
    if (channels.includes('email') && !String(input.email || '').trim()) {
      return res.status(400).json({ error: 'Enter the customer email address to send email' });
    }
    if (channels.includes('whatsapp') && !String(input.phone || '').trim()) {
      return res.status(400).json({ error: 'Enter the customer phone number to send WhatsApp' });
    }

    const customer = await customerService.findOrCreateForMessage(req.owner!.businessId, {
      id: input.customerId,
      name: input.name,
      phone: input.phone,
      email: input.email,
    });
    const results = await notificationService.sendCustomCustomerNotification(
      req.owner!.businessId,
      customer.id,
      channels,
      input.subject,
      input.message,
      input.messageHtml,
      (input.imageUrl as string | null | undefined) || null
    );
    res.json({ customer, results });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || 'Invalid notification' });
    }
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.post('/notifications/broadcast', async (req: AuthRequest, res: Response) => {
  try {
    const input = z.object({
      subject: z.string().trim().min(1).max(160).default('Message from your salon'),
      message: z.string().trim().min(1).max(3000),
      messageHtml: z.string().trim().max(12000).optional().nullable(),
      imageUrl: optionalImageUrl,
      channels: z.array(z.enum(['email', 'whatsapp'])).min(1).max(2).default(['email', 'whatsapp']),
      filters: z.object({
        service: z.string().trim().max(160).optional().nullable(),
        attributes: z.record(z.string().trim().max(120)).optional().nullable(),
      }).optional().nullable(),
    }).parse(req.body);
    const report = await notificationService.sendBroadcast(
      req.owner!.businessId,
      input.subject,
      input.message,
      input.filters,
      input.messageHtml,
      [...new Set(input.channels)],
      (input.imageUrl as string | null | undefined) || null
    );
    res.json(report);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || 'Invalid notification' });
    }
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.post('/customers/:id/notify', async (req: AuthRequest, res: Response) => {
  try {
    const input = z.object({
      channels: z.array(z.enum(['email', 'whatsapp'])).min(1).max(2),
      subject: z.string().trim().min(1).max(160).default('Message from your salon'),
      message: z.string().trim().min(1).max(3000),
      messageHtml: z.string().trim().max(12000).optional().nullable(),
      imageUrl: optionalImageUrl,
    }).parse(req.body);
    const results = await notificationService.sendCustomCustomerNotification(
      req.owner!.businessId,
      req.params.id,
      [...new Set(input.channels)],
      input.subject,
      input.message,
      input.messageHtml,
      (input.imageUrl as string | null | undefined) || null
    );
    res.json({ results });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || 'Invalid notification' });
    }
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.get('/customers/filters', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const [contacts, formFields] = await Promise.all([
      prisma.customerContact.findMany({
        where: { businessId },
        select: { id: true, phone: true, email: true, lastServiceName: true, attributes: true },
        take: 500,
      }),
      prisma.formField.findMany({
        where: { businessId },
        select: { id: true, label: true, fieldType: true, options: true },
        orderBy: { order: 'asc' },
      }),
    ]);

    // One-time-ish backfill: if contacts lack attributes, pull from latest matching bookings.
    const needsBackfill = contacts.filter((c) => {
      const attrs = c.attributes && typeof c.attributes === 'object' ? Object.keys(c.attributes as object) : [];
      return attrs.length === 0;
    });
    if (needsBackfill.length > 0) {
      const bookings = await prisma.booking.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 800,
        select: {
          customerPhone: true,
          customerEmail: true,
          formData: true,
          serviceNameSnapshot: true,
        },
      });
      for (const contact of needsBackfill) {
        const phone = normalizeCustomerPhone(contact.phone);
        const email = normalizeCustomerEmail(contact.email);
        const match = bookings.find((b) => {
          const bPhone = normalizeCustomerPhone(b.customerPhone);
          const bEmail = normalizeCustomerEmail(b.customerEmail);
          return (phone && bPhone && phone === bPhone) || (email && bEmail && email === bEmail);
        });
        if (!match) continue;
        const attrs = attributesFromFormData(formFields, match.formData as Record<string, unknown>);
        if (Object.keys(attrs).length === 0 && !match.serviceNameSnapshot) continue;
        await prisma.customerContact.update({
          where: { id: contact.id },
          data: {
            attributes: attrs,
            ...(match.serviceNameSnapshot && !contact.lastServiceName
              ? { lastServiceName: match.serviceNameSnapshot }
              : {}),
          },
        });
        contact.attributes = attrs;
        if (match.serviceNameSnapshot && !contact.lastServiceName) {
          contact.lastServiceName = match.serviceNameSnapshot;
        }
      }
    }

    const refreshed = needsBackfill.length
      ? await prisma.customerContact.findMany({
          where: { businessId },
          select: { lastServiceName: true, attributes: true },
          take: 500,
        })
      : contacts;

    const services = [...new Set(
      refreshed.map((c) => c.lastServiceName).filter((v): v is string => !!v && !!String(v).trim())
    )].sort((a, b) => a.localeCompare(b));

    const attributeValues: Record<string, string[]> = {};
    for (const contact of refreshed) {
      const attrs = contact.attributes && typeof contact.attributes === 'object' && !Array.isArray(contact.attributes)
        ? (contact.attributes as Record<string, string>)
        : {};
      for (const [key, value] of Object.entries(attrs)) {
        if (!value) continue;
        if (!attributeValues[key]) attributeValues[key] = [];
        if (!attributeValues[key].includes(value)) attributeValues[key].push(value);
      }
    }

    // Include select options from the intake form even before anyone has booked with them.
    const attributeFields = formFields
      .filter((f) => !['tel', 'email', 'textarea', 'checkbox'].includes(f.fieldType))
      .filter((f) => !(/\b(full\s*)?name\b/i.test(f.label) && f.fieldType === 'text'))
      .map((f) => {
        const key = attributeKeyFromLabel(f.label);
        const fromContacts = attributeValues[key] || [];
        const fromOptions = (f.options || []).filter(Boolean);
        const values = [...new Set([...fromOptions, ...fromContacts])].sort((a, b) => a.localeCompare(b));
        return { key, label: f.label, values };
      })
      .filter((f) => f.key && f.values.length > 0);

    // Keep orphan contact-only keys (not in current form) visible too.
    for (const [key, values] of Object.entries(attributeValues)) {
      if (attributeFields.some((f) => f.key === key)) continue;
      attributeFields.push({
        key,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        values: values.sort((a, b) => a.localeCompare(b)),
      });
    }

    res.json({
      services,
      attributes: attributeFields,
      totalCustomers: refreshed.length,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.get('/customers/preview', async (req: AuthRequest, res: Response) => {
  try {
    const service = String(req.query.service || '').trim() || null;
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (key === 'service') continue;
      if (typeof value === 'string' && value.trim()) attributes[key] = value.trim();
    }
    const contacts = await prisma.customerContact.findMany({
      where: { businessId: req.owner!.businessId },
      take: 500,
    });
    const matched = contacts.filter((c) => contactMatchesFilters(c, {
      service,
      attributes: Object.keys(attributes).length ? attributes : null,
    }));
    res.json({
      matched: matched.length,
      total: contacts.length,
      sample: matched.slice(0, 8).map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        lastServiceName: c.lastServiceName,
        attributes: c.attributes,
      })),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.get('/customer-notifications', async (req: AuthRequest, res: Response) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const notifications = await prisma.customerNotification.findMany({
    where: { businessId: req.owner!.businessId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(notifications);
});

/**
 * @openapi
 * /owner/analytics:
 *   get:
 *     tags: [Owner - Analytics]
 *     summary: Get analytics data
 *     description: Returns comprehensive analytics including booking metrics, heatmap, status breakdown, trends, and feature-specific metrics.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date }
 *         description: Start date (defaults to 30 days ago)
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date }
 *         description: End date (defaults to today + bookingWindowDays, so upcoming appointments are included)
 *       - in: query
 *         name: staffId
 *         schema: { type: string }
 *         description: Filter by staff member (requires multi-staff feature)
 *     responses:
 *       200:
 *         description: Analytics data
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AnalyticsData' }
 *       401:
 *         description: Unauthorized
 */
ownerRouter.get('/analytics', async (req: AuthRequest, res: Response) => {
  try {
    const { dateFrom, dateTo, staffId } = req.query as any;
    // Analytics are keyed on the appointment date, and most bookings are for
    // future dates. Defaulting `to` to today would hide every upcoming booking,
    // so the default window also spans the bookable horizon.
    const business = await prisma.business.findUnique({
      where: { id: req.owner!.businessId },
      select: { bookingWindowDays: true },
    });
    const dayMs = 24 * 60 * 60 * 1000;
    const upcomingDays = business?.bookingWindowDays ?? 7;
    const from = dateFrom || timeService.toDateStr(new Date(Date.now() - 30 * dayMs), 'UTC');
    const to = dateTo || timeService.toDateStr(new Date(Date.now() + upcomingDays * dayMs), 'UTC');

    const analytics = await analyticsService.getAnalytics(
      req.owner!.businessId,
      from,
      to,
      staffId
    );

    res.json(analytics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/notify/test:
 *   post:
 *     tags: [Owner - Notifications]
 *     summary: Send test notification
 *     description: Send a test notification to the business owner via configured channels (email/WhatsApp).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Test notification sent
 *       400:
 *         description: Failed to send
 */
ownerRouter.post('/notify/test', async (req: AuthRequest, res: Response) => {
  try {
    const result = await notificationService.sendTestNotification(req.owner!.businessId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/settings/status:
 *   get:
 *     tags: [Owner - Config]
 *     summary: Notification/location readiness status
 *     description: Reports platform prerequisites for email/WhatsApp channels and
 *       location completeness so the Settings UI can surface configuration errors.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Readiness flags
 */
ownerRouter.get('/settings/status', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const [business, whatsappConfig, wallet] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId } }),
      prisma.whatsAppConfig.findUnique({ where: { businessId } }),
      prisma.wallet.findUnique({ where: { businessId } }),
    ]);
    const frontendUrl = (process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || '').trim();
    const isHttpsAbsolute = /^https:\/\/[^\s]+$/i.test(frontendUrl);
    const threshold = wallet?.lowBalanceThresholdPaise ?? 50000;
    res.json({
      smtpConfigured: smtpConfigured(business),
      metaWhatsappConfigured: platformWhatsappConfigured(),
      smtpPassConfigured: !!business?.smtpPassEnc,
      metaWhatsappAccessTokenConfigured: false,
      frontendUrlConfigured: isHttpsAbsolute,
      locationComplete: !!(business && ((business.latitude != null && business.longitude != null) || (business.address && business.address.trim()))),
      ownerEmailPresent: !!business?.ownerEmail,
      ownerWhatsappPresent: !!business?.ownerWhatsapp,
      whatsappConnected: tenantWhatsappOptedIn(whatsappConfig) && platformWhatsappConfigured(),
      walletBalancePaise: wallet?.balancePaise ?? 0,
      walletLowBalance: wallet ? wallet.balancePaise <= threshold : true,
    });
  } catch (error: any) {
    const unreachable = /Can't reach database server|P1001|ECONNREFUSED|ETIMEDOUT/i.test(String(error?.message || error));
    console.error('settings/status failed:', error?.message || error);
    res.status(unreachable ? 503 : 500).json({
      error: unreachable
        ? 'Database temporarily unavailable. Wait a few seconds and refresh (Neon may be waking up).'
        : (error?.message || 'Failed to load settings status'),
    });
  }
});

/**
 * WhatsApp status (shared platform) + wallet summary. Never returns tokens.
 */
ownerRouter.get('/whatsapp/status', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const [config, pricing] = await Promise.all([
      prisma.whatsAppConfig.findUnique({ where: { businessId } }),
      whatsappPricingService.list(),
    ]);
    const utilityPrice = pricing.find((p) => p.category === 'UTILITY')?.pricePaise ?? null;
    const wallet = await walletService.getView(businessId, utilityPrice);
    const platformReady = platformWhatsappConfigured();
    const optedIn = tenantWhatsappOptedIn(config);
    res.json({
      connectionMode: 'SHARED',
      status: optedIn ? 'CONNECTED' : 'DISCONNECTED',
      displayPhone: process.env.META_WHATSAPP_DISPLAY_PHONE || config?.displayPhone || null,
      configured: platformReady,
      platformReady,
      optedIn,
      wallet,
      pricing,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /owner/whatsapp/connect — opt in to Reservly's shared Cloud API number.
 * Owners never supply Phone Number ID or access tokens.
 */
ownerRouter.post('/whatsapp/connect', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    if (!platformWhatsappConfigured()) {
      return res.status(503).json({
        error: 'Reservly WhatsApp is not configured yet. Contact support — salons do not add their own Meta API credentials.',
      });
    }
    await walletService.getOrCreate(businessId);
    await prisma.whatsAppConfig.upsert({
      where: { businessId },
      create: {
        businessId,
        phoneNumberId: null,
        accessTokenEnc: null,
        displayPhone: process.env.META_WHATSAPP_DISPLAY_PHONE || null,
        connectionMode: 'SHARED',
        status: 'CONNECTED',
        enabled: true,
      },
      update: {
        phoneNumberId: null,
        accessTokenEnc: null,
        displayPhone: process.env.META_WHATSAPP_DISPLAY_PHONE || null,
        connectionMode: 'SHARED',
        status: 'CONNECTED',
        enabled: true,
      },
    });
    res.json({ ok: true, connectionMode: 'SHARED', status: 'CONNECTED' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /owner/whatsapp/disconnect — opt out of WhatsApp sends (platform credentials unchanged).
 */
ownerRouter.post('/whatsapp/disconnect', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    await prisma.whatsAppConfig.upsert({
      where: { businessId },
      create: {
        businessId,
        status: 'DISCONNECTED',
        enabled: false,
        connectionMode: 'SHARED',
      },
      update: { status: 'DISCONNECTED', enabled: false, connectionMode: 'SHARED' },
    });
    res.json({ ok: true, status: 'DISCONNECTED' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /owner/whatsapp-wallet — balance + low-balance flag + usage estimate.
 */
ownerRouter.get('/whatsapp-wallet', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const pricing = await whatsappPricingService.list();
    const utilityPrice = pricing.find((p) => p.category === 'UTILITY')?.pricePaise ?? null;
    const wallet = await walletService.getView(businessId, utilityPrice);
    res.json({ ...wallet, pricing });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /owner/whatsapp-wallet/transactions — immutable ledger (recent).
 */
ownerRouter.get('/whatsapp-wallet/transactions', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const transactions = await walletService.transactions(req.owner!.businessId, limit);
    res.json({ transactions });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /owner/whatsapp-wallet/recharge — create a Razorpay order using the
 * platform Razorpay keys (mirror of /subscription/pay). Min recharge ₹100.
 */
ownerRouter.post('/whatsapp-wallet/recharge', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const schema = z.object({ amountPaise: z.number().int().min(10000) }); // ₹100
    const { amountPaise } = schema.parse(req.body);

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keyId || !keySecret) {
      return res.status(500).json({ error: 'Platform payment gateway not configured' });
    }

    const receipt = `ww_${businessId.slice(0, 8)}_${Date.now()}`;
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt,
        payment_capture: 1,
      }),
    });

    if (!response.ok) {
      const err: any = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.description || 'Failed to create payment order' });
    }

    const order: any = await response.json();
    res.json({
      orderId: order.id,
      amountPaise: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /owner/whatsapp-wallet/verify — HMAC signature + Razorpay order amount +
 * idempotent ledger credit keyed on the payment id. Never credits from the
 * frontend "success" alone.
 */
ownerRouter.post('/whatsapp-wallet/verify', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const schema = z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = schema.parse(req.body);

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keyId || !keySecret) {
      return res.status(500).json({ error: 'Platform payment gateway not configured' });
    }

    const crypto = await import('crypto');
    const expectedSig = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Amount comes from Razorpay (the order we created), never from the client.
    const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      },
    });
    if (!orderRes.ok) {
      return res.status(502).json({ error: 'Could not confirm order amount with payment provider' });
    }
    const order: any = await orderRes.json();
    const amountPaise = Number(order.amount);
    if (!Number.isInteger(amountPaise) || amountPaise < 10000) {
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    const result = await walletService.creditRecharge(businessId, razorpay_payment_id, amountPaise, {
      description: `WhatsApp wallet recharge ₹${(amountPaise / 100).toFixed(2)}`,
      referenceType: 'razorpay_order',
      referenceId: razorpay_order_id,
    });
    res.json({ ok: true, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /owner/whatsapp/messages — billable WhatsApp usage history (recent).
 */
ownerRouter.get('/whatsapp/messages', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const messages = await prisma.whatsAppMessageLog.findMany({
      where: { businessId: req.owner!.businessId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ messages });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Owner subscription status + billing info (platform-managed).
 */
ownerRouter.get('/subscription', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const view = await subscriptionService.getSubscriptionView(businessId);
    res.json(view);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.post('/subscription/select', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      plan: z.enum(['COMMISSION', 'MONTHLY_799', 'YEARLY_799']),
    });
    const parsed = schema.parse(req.body);
    await subscriptionService.selectPlan(req.owner!.businessId, parsed.plan as any);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.post('/subscription/pay', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const view = await subscriptionService.getSubscriptionView(businessId);
    if (view.dueInr <= 0) {
      return res.json({ alreadyPaid: true });
    }

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keyId || !keySecret) {
      return res.status(500).json({ error: 'Platform payment gateway not configured' });
    }

    const receipt = `sub_${businessId.slice(0, 8)}_${Date.now()}`;
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(view.dueInr * 100),
        currency: 'INR',
        receipt,
        payment_capture: 1,
      }),
    });

    if (!response.ok) {
      const err: any = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.description || 'Failed to create payment order' });
    }

    const order: any = await response.json();
    res.json({
      orderId: order.id,
      amountInr: view.dueInr,
      amountPaise: order.amount,
      currency: order.currency,
      keyId,
      plan: view.plan,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.post('/subscription/verify', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = schema.parse(req.body);

    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keySecret) {
      return res.status(500).json({ error: 'Platform payment gateway not configured' });
    }

    const crypto = await import('crypto');
    const expectedSig = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const businessId = req.owner!.businessId;
    const r = await subscriptionService.markPaid(businessId);
    res.json({ ok: true, ...r });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.post('/subscription/mark-paid', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.owner!.businessId;
    const r = await subscriptionService.markPaid(businessId);
    res.json({ ok: true, ...r });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/waitlist:
 *   get:
 *     tags: [Owner - Waitlist]
 *     summary: List waitlist entries
 *     description: Returns waitlist entries for the business. Requires waitlist feature to be enabled.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [waiting, notified, expired, converted] }
 *     responses:
 *       200:
 *         description: List of waitlist entries
 *       403:
 *         description: Feature not enabled
 */
ownerRouter.get('/waitlist', ownerFeatureGuard('waitlist'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await waitlistService.getWaitlistForBusiness(
      req.owner!.businessId,
      req.query as any
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/waitlist/{id}/notify:
 *   post:
 *     tags: [Owner - Waitlist]
 *     summary: Manually notify waitlist entry
 *     description: Send a slot-open notification to a specific waitlist entry.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification sent
 *       403:
 *         description: Feature not enabled
 *       404:
 *         description: Entry not found
 */
ownerRouter.post('/waitlist/:id/notify', ownerFeatureGuard('waitlist'), async (req: AuthRequest, res: Response) => {
  try {
    const entry = await waitlistService.manuallyNotify(req.owner!.businessId, req.params.id);
    res.json(entry);
  } catch (error: any) {
    const status = error.message === 'Waitlist entry not found' ? 404 : (error.status || 400);
    res.status(status).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/waitlist/{id}:
 *   delete:
 *     tags: [Owner - Waitlist]
 *     summary: Remove waitlist entry
 *     description: Remove a customer from the waitlist.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Entry removed
 *       403:
 *         description: Feature not enabled
 */
ownerRouter.delete('/waitlist/:id', ownerFeatureGuard('waitlist'), async (req: AuthRequest, res: Response) => {
  try {
    await waitlistService.removeEntry(req.owner!.businessId, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status || (error.code === 'P2025' ? 404 : 400)).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/staff:
 *   get:
 *     tags: [Owner - Staff]
 *     summary: List all staff members
 *     description: Returns all staff members for the business. Requires multi-staff feature.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of staff members
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Staff' }
 *       403:
 *         description: Feature not enabled
 */
ownerRouter.get('/staff', ownerFeatureGuard('multi-staff'), async (req: AuthRequest, res: Response) => {
  try {
    const staff = await prisma.staff.findMany({
      where: { businessId: req.owner!.businessId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(staff);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/staff:
 *   post:
 *     tags: [Owner - Staff]
 *     summary: Add a staff member
 *     description: Create a new staff member. Requires multi-staff feature.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Priya Sharma" }
 *               role: { type: string, example: "Senior Stylist" }
 *               phone: { type: string }
 *               email: { type: string }
 *               color: { type: string, example: "#7C3AED" }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Staff member created
 *       403:
 *         description: Feature not enabled
 */
ownerRouter.post('/staff', ownerFeatureGuard('multi-staff'), async (req: AuthRequest, res: Response) => {
  try {
    const staff = await prisma.staff.create({
      data: {
        businessId: req.owner!.businessId,
        name: req.body.name,
        role: req.body.role || null,
        phone: req.body.phone || null,
        email: req.body.email || null,
        color: req.body.color || '#7C3AED',
        isActive: req.body.isActive !== undefined ? req.body.isActive : true,
      },
    });
    res.status(201).json(staff);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/staff/{id}:
 *   put:
 *     tags: [Owner - Staff]
 *     summary: Update a staff member
 *     description: Update staff member details. Requires multi-staff feature.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               role: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               color: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Staff member updated
 *       403:
 *         description: Feature not enabled
 */
ownerRouter.put('/staff/:id', ownerFeatureGuard('multi-staff'), async (req: AuthRequest, res: Response) => {
  try {
    const staff = await prisma.staff.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    const updated = await prisma.staff.update({ where: { id: staff.id }, data: req.body });
    res.json(updated);
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/staff/{id}:
 *   delete:
 *     tags: [Owner - Staff]
 *     summary: Delete a staff member
 *     description: Remove a staff member from the business. Requires multi-staff feature.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Staff member deleted
 *       403:
 *         description: Feature not enabled
 */
ownerRouter.delete('/staff/:id', ownerFeatureGuard('multi-staff'), async (req: AuthRequest, res: Response) => {
  try {
    const staff = await prisma.staff.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    await prisma.staff.delete({ where: { id: staff.id } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/payments:
 *   get:
 *     tags: [Owner - Payments]
 *     summary: List payment transactions
 *     description: Returns paginated payment transactions. Requires payments feature.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, partial, paid, refunded] }
 *     responses:
 *       200:
 *         description: Paginated list of payment transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bookings: { type: array, items: { $ref: '#/components/schemas/Booking' } }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 totalPages: { type: integer }
 *       403:
 *         description: Feature not enabled
 */
ownerRouter.get('/payments', ownerFeatureGuard('payments'), async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '50', status } = req.query as any;
    const where: any = {
      businessId: req.owner!.businessId,
      paymentStatus: { not: null },
    };
    if (status) where.paymentStatus = status;

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: { staff: true, paymentRefund: true },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.booking.count({ where }),
    ]);

    res.json({ bookings, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/payments/{id}/refund:
 *   post:
 *     tags: [Owner - Payments]
 *     summary: Initiate a refund
 *     description: Refund a payment for a booking. Full refund by default. Requires payments feature.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Booking ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount: { type: number, description: "Refund amount (defaults to full payment amount)" }
 *     responses:
 *       200:
 *         description: Refund processed
 *       400:
 *         description: Refund failed
 *       403:
 *         description: Feature not enabled
 *       404:
 *         description: Booking not found
 */
ownerRouter.post('/payments/:id/refund', ownerFeatureGuard('payments'), async (req: AuthRequest, res: Response) => {
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!booking.razorpayPaymentId || !booking.paymentAmount || booking.paymentAmount <= 0) {
      return res.status(400).json({ error: 'No payment to refund' });
    }

    // Batch 2A: full-paid-amount only, through the durable idempotent pipeline.
    // `amount` (if provided) must be the full paid amount in integer minor units.
    const fullMinor = Math.round(booking.paymentAmount * 100);
    if (req.body?.amount != null && req.body.amount !== fullMinor) {
      return res.status(400).json({ error: 'This version refunds the full paid amount only' });
    }

    // Idempotent: creates or returns the single PaymentRefund intent. If an
    // automatic cancel already created/processed one, no duplicate is made.
    const { refundIntent, createdIntent } =
      await refundService.ensureRefundIntentForBooking(req.owner!.businessId, booking);

    const refund = await refundService.initiateOrReconcileRefund(refundIntent, booking, { createdIntent });

    const business = await prisma.business.findUnique({ where: { id: req.owner!.businessId } });
    if (business) {
      await notificationService.sendPaymentRefundConfirmation(booking, business, refund);
    }

    const freshBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    res.json({ refund, booking: freshBooking });
  } catch (error: any) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/recurring/{groupId}:
 *   get:
 *     tags: [Owner - Bookings]
 *     summary: Get recurring series bookings
 *     description: Returns all bookings in a recurring series by group ID.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of bookings in the series
 *       400:
 *         description: Failed to fetch
 */
ownerRouter.get('/recurring/:groupId', async (req: AuthRequest, res: Response) => {
  try {
    const bookings = await recurringService.getSeriesBookings(
      req.owner!.businessId,
      req.params.groupId
    );
    res.json(bookings);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /owner/recurring/{groupId}:
 *   delete:
 *     tags: [Owner - Bookings]
 *     summary: Cancel recurring series
 *     description: Cancel a recurring booking series. Optionally cancel only future bookings.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cancelFutureOnly: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Series cancelled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cancelledCount: { type: integer }
 *       400:
 *         description: Cancellation failed
 */
ownerRouter.delete('/recurring/:groupId', async (req: AuthRequest, res: Response) => {
  try {
    const count = await recurringService.cancelSeries(
      req.owner!.businessId,
      req.params.groupId,
      req.body.cancelFutureOnly !== false
    );
    res.json({ cancelledCount: count });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default ownerRouter;

// ---------- Service categories (owner CRUD) ----------

ownerRouter.get('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.serviceCategory.findMany({
      where: { businessId: req.owner!.businessId },
      orderBy: { displayOrder: 'asc' },
    });
    res.json(categories);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

ownerRouter.post('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, displayOrder, isActive } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const category = await prisma.serviceCategory.create({
      data: {
        businessId: req.owner!.businessId,
        name: name.trim(),
        description: description || null,
        displayOrder: Number(displayOrder) || 0,
        isActive: isActive !== false,
      },
    });
    res.status(201).json(category);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.put('/categories/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, displayOrder, isActive, imageUrl } = req.body;
    const category = await prisma.serviceCategory.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const updated = await prisma.serviceCategory.update({
      where: { id: category.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(displayOrder !== undefined ? { displayOrder: Number(displayOrder) } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
      },
    });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.delete('/categories/:id', async (req: AuthRequest, res: Response) => {
  try {
    const category = await prisma.serviceCategory.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const serviceCount = await prisma.service.count({ where: { categoryId: category.id } });
    if (serviceCount > 0) {
      return res.status(400).json({ error: 'Category has services. Move or delete them first.' });
    }
    await prisma.serviceCategory.delete({ where: { id: category.id } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ---------- Services (owner CRUD) ----------

ownerRouter.get('/services', async (req: AuthRequest, res: Response) => {
  try {
    const services = await prisma.service.findMany({
      where: { businessId: req.owner!.businessId },
      orderBy: [{ displayOrder: 'asc' }],
      include: { staff: true, workingHours: true, category: true },
    });
    res.json(services);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

ownerRouter.post('/services', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      categoryId: z.string().min(1),
      name: z.string().trim().min(1).max(120),
      description: z.string().optional().nullable(),
      durationMinutes: z.number().int().min(5).max(600),
      bufferMinutes: z.number().int().min(0).max(120).default(0),
      price: z.number().min(0),
      resourceMode: z.enum(['STAFF_BASED', 'POOLED']).default('POOLED'),
      capacity: z.number().int().min(1).max(100).default(1),
      isActive: z.boolean().default(true),
      displayOrder: z.number().int().default(0),
      imageUrl: z.string().optional().nullable(),
      assignedStaffIds: z.array(z.string()).optional(),
      discountType: z.enum(['PERCENTAGE', 'FLAT']).optional().nullable(),
      discountValue: z.number().min(0).optional().nullable(),
      discountLabel: z.string().optional().nullable(),
      discountActive: z.boolean().default(false),
      discountValidFrom: z.string().optional().nullable(),
      discountValidUntil: z.string().optional().nullable(),
    });
    const parsed = schema.parse(req.body);

    const category = await prisma.serviceCategory.findFirst({
      where: { id: parsed.categoryId, businessId: req.owner!.businessId },
    });
    if (!category) return res.status(400).json({ error: 'Category not found for this business' });

    const assignedStaffIds = parsed.resourceMode === 'STAFF_BASED' ? (parsed.assignedStaffIds || []) : [];
    if (parsed.resourceMode === 'STAFF_BASED' && assignedStaffIds.length === 0) {
      return res.status(400).json({ error: 'STAFF_BASED services require at least one assigned staff member' });
    }
    if (assignedStaffIds.length > 0) {
      const staffCount = await prisma.staff.count({
        where: { id: { in: assignedStaffIds }, businessId: req.owner!.businessId },
      });
      if (staffCount !== assignedStaffIds.length) {
        return res.status(400).json({ error: 'One or more staff members do not belong to this business' });
      }
    }

    const service = await prisma.service.create({
      data: {
        businessId: req.owner!.businessId,
        categoryId: parsed.categoryId,
        name: parsed.name,
        description: parsed.description || null,
        durationMinutes: parsed.durationMinutes,
        bufferMinutes: parsed.bufferMinutes,
        price: parsed.price,
        resourceMode: parsed.resourceMode,
        capacity: parsed.capacity,
        isActive: parsed.isActive,
        displayOrder: parsed.displayOrder,
        imageUrl: parsed.imageUrl || null,
        discountType: parsed.discountType || null,
        discountValue: parsed.discountValue ?? null,
        discountLabel: parsed.discountLabel || null,
        discountActive: parsed.discountActive,
        discountValidFrom: parsed.discountValidFrom ? new Date(parsed.discountValidFrom) : null,
        discountValidUntil: parsed.discountValidUntil ? new Date(parsed.discountValidUntil) : null,
        staff: assignedStaffIds.length > 0
          ? { create: assignedStaffIds.map((staffId) => ({ staffId, businessId: req.owner!.businessId })) }
          : undefined,
      },
      include: { staff: true, category: true },
    });
    res.status(201).json(service);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.put('/services/:id', async (req: AuthRequest, res: Response) => {
  try {
    const service = await prisma.service.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const { assignedStaffIds, ...fields } = req.body;
    const data: any = { ...fields };
    delete data.id;
    delete data.businessId;
    delete data.createdAt;
    delete data.updatedAt;
    delete data.category;
    delete data.staff;
    delete data.workingHours;

    if (data.discountValidFrom) data.discountValidFrom = new Date(data.discountValidFrom);
    if (data.discountValidUntil) data.discountValidUntil = new Date(data.discountValidUntil);

    const result = await prisma.$transaction(async (tx) => {
      if (Array.isArray(assignedStaffIds)) {
        const staffCount = await tx.staff.count({
          where: { id: { in: assignedStaffIds }, businessId: req.owner!.businessId },
        });
        if (staffCount !== assignedStaffIds.length) {
          throw new Error('One or more staff members do not belong to this business');
        }
        await tx.staffService.deleteMany({ where: { serviceId: service.id } });
        if (assignedStaffIds.length > 0) {
          await tx.staffService.createMany({
            data: assignedStaffIds.map((staffId: string) => ({ staffId, serviceId: service.id, businessId: req.owner!.businessId })),
          });
        }
      }
      return tx.service.update({
        where: { id: service.id },
        data,
        include: { staff: true, category: true, workingHours: true },
      });
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.delete('/services/:id', async (req: AuthRequest, res: Response) => {
  try {
    const service = await prisma.service.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const bookingCount = await prisma.booking.count({ where: { serviceId: service.id } });
    if (bookingCount > 0) {
      // Soft-delete: keep historical snapshots intact
      await prisma.service.update({ where: { id: service.id }, data: { isActive: false } });
      return res.json({ success: true, softDeleted: true });
    }
    await prisma.service.delete({ where: { id: service.id } });
    res.json({ success: true, softDeleted: false });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ---------- Service-specific working hours ----------

ownerRouter.get('/services/:id/hours', async (req: AuthRequest, res: Response) => {
  try {
    const service = await prisma.service.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });
    const hours = await prisma.serviceWorkingHour.findMany({
      where: { serviceId: service.id },
      orderBy: { dayOfWeek: 'asc' },
    });
    res.json(hours);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

ownerRouter.put('/services/:id/hours', async (req: AuthRequest, res: Response) => {
  try {
    const service = await prisma.service.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const hours: { dayOfWeek: number; openTime: string; closeTime: string; isOpen: boolean }[] = req.body.hours || [];
    await prisma.$transaction(async (tx) => {
      await tx.serviceWorkingHour.deleteMany({ where: { serviceId: service.id } });
      if (hours.length > 0) {
        await tx.serviceWorkingHour.createMany({
          data: hours.map((h) => ({
            businessId: req.owner!.businessId,
            serviceId: service.id,
            dayOfWeek: h.dayOfWeek,
            openTime: h.openTime,
            closeTime: h.closeTime,
            isOpen: h.isOpen,
          })),
        });
      }
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ---------- Staff-specific working hours ----------

ownerRouter.get('/staff/:id/hours', ownerFeatureGuard('multi-staff'), async (req: AuthRequest, res: Response) => {
  try {
    const staff = await prisma.staff.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    const hours = await prisma.staffWorkingHour.findMany({
      where: { staffId: staff.id },
      orderBy: { dayOfWeek: 'asc' },
    });
    res.json(hours);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

ownerRouter.put('/staff/:id/hours', ownerFeatureGuard('multi-staff'), async (req: AuthRequest, res: Response) => {
  try {
    const staff = await prisma.staff.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    const hours: { dayOfWeek: number; openTime: string; closeTime: string; isOpen: boolean }[] = req.body.hours || [];
    await prisma.$transaction(async (tx) => {
      await tx.staffWorkingHour.deleteMany({ where: { staffId: staff.id } });
      if (hours.length > 0) {
        await tx.staffWorkingHour.createMany({
          data: hours.map((h) => ({
            businessId: req.owner!.businessId,
            staffId: staff.id,
            dayOfWeek: h.dayOfWeek,
            openTime: h.openTime,
            closeTime: h.closeTime,
            isOpen: h.isOpen,
          })),
        });
      }
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ---------- Public page sections (owner CRUD) ----------

ownerRouter.get('/page-sections', async (req: AuthRequest, res: Response) => {
  try {
    const sections = await prisma.pageSection.findMany({
      where: { businessId: req.owner!.businessId },
      orderBy: { displayOrder: 'asc' },
    });
    res.json(sections);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

ownerRouter.post('/page-sections', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      type: z.enum(['HERO', 'OFFERS', 'GALLERY', 'ABOUT', 'SERVICES', 'BUSINESS_HOURS', 'WHY_CHOOSE_US', 'TESTIMONIALS', 'CONTACT', 'CUSTOM_TEXT']),
      title: z.string().optional().nullable(),
      content: z.string().optional().nullable(),
      configuration: z.record(z.any()).default({}),
      displayOrder: z.number().int().default(0),
      isVisible: z.boolean().default(true),
    });
    const parsed = schema.parse(req.body);
    const section = await prisma.pageSection.create({
      data: {
        businessId: req.owner!.businessId,
        ...parsed,
        configuration: parsed.configuration || {},
      },
    });
    res.status(201).json(section);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.put('/page-sections/:id', async (req: AuthRequest, res: Response) => {
  try {
    const section = await prisma.pageSection.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!section) return res.status(404).json({ error: 'Section not found' });

    const { id, businessId, createdAt, updatedAt, ...fields } = req.body;
    const updated = await prisma.pageSection.update({
      where: { id: section.id },
      data: fields,
    });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

ownerRouter.delete('/page-sections/:id', async (req: AuthRequest, res: Response) => {
  try {
    const section = await prisma.pageSection.findFirst({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    if (!section) return res.status(404).json({ error: 'Section not found' });
    await prisma.pageSection.delete({ where: { id: section.id } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ---------- QR code ----------

ownerRouter.get('/qr', async (req: AuthRequest, res: Response) => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.owner!.businessId },
      select: { slug: true, publicCode: true, name: true },
    });
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const baseUrl = (process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    res.json({
      url: `${baseUrl}/b/${business.publicCode}`,
      publicCode: business.publicCode,
      businessName: business.name,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- Media (Postgres BYTEA) ----------

ownerRouter.post('/media/upload', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = z.object({
      mimeType: z.string().optional(),
      dataBase64: z.string().min(1),
    }).parse(req.body);

    let bytes: Buffer;
    try {
      bytes = decodeImageBase64(parsed.dataBase64);
    } catch {
      return res.status(400).json({ error: 'Invalid image data' });
    }

    const asset = await createMediaAsset(req.owner!.businessId, bytes);
    const row = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
      select: { mimeType: true, data: true },
    });
    res.status(201).json({
      url: `data:${row.mimeType};base64,${Buffer.from(row.data).toString('base64')}`,
      publicId: asset.id,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request' });
    }
    res.status(error.status || 400).json({ error: error.message });
  }
});
