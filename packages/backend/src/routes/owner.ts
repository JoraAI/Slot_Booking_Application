import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { bookingService } from '../services/BookingService';
import { waitlistService } from '../services/WaitlistService';
import { recurringService } from '../services/RecurringService';
import { paymentService } from '../services/PaymentService';
import { notificationService } from '../services/NotificationService';
import { analyticsService } from '../services/AnalyticsService';
import { ownerFeatureGuard } from '../services/FeatureGuard';

export const ownerRouter = Router();

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
      where: { ownerEmail: email },
    });

    if (!business) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, business.ownerPassword);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
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
      },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const { ownerPassword, razorpayKeySecret, ...safeData } = business;
    res.json(safeData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
    const booking = await bookingService.updateBookingStatus(
      req.owner!.businessId,
      req.params.id,
      req.body.status
    );
    res.json(booking);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
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

    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, businessId: business.id },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: { staff: true, business: true },
    });

    await notificationService.sendBookingCancellation(updated, business);

    if (business.enableWaitlist) {
      const dateStr = new Date(booking.date).toISOString().split('T')[0];
      await waitlistService.notifyNext(business.id, dateStr, booking.startTime);
    }

    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
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
ownerRouter.post('/block', async (req: AuthRequest, res: Response) => {
  try {
    const { date, startTime, endTime, staffId, reason } = req.body;
    const block = await prisma.blockedSlot.create({
      data: {
        businessId: req.owner!.businessId,
        date: new Date(date),
        startTime,
        endTime,
        staffId: staffId || null,
        reason: reason || null,
      },
    });
    res.status(201).json(block);
  } catch (error: any) {
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
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }
    if (staffId) where.staffId = staffId;

    const blocks = await prisma.blockedSlot.findMany({
      where,
      include: { staff: true },
      orderBy: { date: 'asc' },
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
 *               parallelSeats: { type: integer }
 *               slotDurationMinutes: { type: integer }
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
 *               servicePrice: { type: number }
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
      'name', 'bookingWindowDays', 'parallelSeats', 'slotDurationMinutes',
      'showAvailableCount', 'notifyOwnerEmail', 'notifyOwnerWhatsapp',
      'notifyCustomerEmail', 'notifyCustomerWhatsapp', 'ownerWhatsapp',
      'enableWaitlist', 'enableRecurring', 'enablePayments', 'enableMultiStaff',
      'paymentMode', 'depositAmount', 'depositPercentage', 'servicePrice',
      'razorpayKeyId', 'razorpayKeySecret', 'refundPolicy', 'embedAllowedOrigins',
      'razorpayTestMode',
    ];

    const updateData: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    const business = await prisma.business.update({
      where: { id: req.owner!.businessId },
      data: updateData,
    });

    const { ownerPassword, ...safeData } = business;
    res.json(safeData);
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
 *             required: [fields]
 *             properties:
 *               fields:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [label, fieldType, required, order, visible]
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
    const { fields } = req.body;
    const businessId = req.owner!.businessId;

    await prisma.formField.deleteMany({ where: { businessId } });
    const created = await prisma.formField.createMany({
      data: fields.map((f: any) => ({
        businessId,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        options: f.options || [],
        placeholder: f.placeholder || null,
        order: f.order,
        visible: f.visible,
      })),
    });

    res.json({ count: created.count });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
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
 *         description: End date (defaults to today)
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
    const from = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = dateTo || new Date().toISOString().split('T')[0];

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
    res.status(400).json({ error: error.message });
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
    res.status(400).json({ error: error.message });
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
    const staff = await prisma.staff.update({
      where: { id: req.params.id, businessId: req.owner!.businessId },
      data: req.body,
    });
    res.json(staff);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
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
    await prisma.staff.delete({
      where: { id: req.params.id, businessId: req.owner!.businessId },
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
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
        include: { staff: true },
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
    if (!booking.razorpayPaymentId) return res.status(400).json({ error: 'No payment to refund' });

    const refundAmount = req.body.amount || booking.paymentAmount;
    const refund = await paymentService.initiateRefund(booking.razorpayPaymentId, refundAmount, req.owner!.businessId);

    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentStatus: 'refunded' },
    });

    const business = await prisma.business.findUnique({ where: { id: req.owner!.businessId } });
    if (business) {
      await notificationService.sendPaymentRefundConfirmation(
        { ...booking, paymentAmount: refundAmount },
        business
      );
    }

    res.json({ refund, booking });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
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