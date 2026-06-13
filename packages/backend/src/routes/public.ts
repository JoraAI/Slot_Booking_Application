import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { availabilityService } from '../services/AvailabilityService';
import { bookingService } from '../services/BookingService';
import { waitlistService } from '../services/WaitlistService';
import { recurringService } from '../services/RecurringService';
import { paymentService } from '../services/PaymentService';
import { notificationService } from '../services/NotificationService';
import { featureGuard } from '../services/FeatureGuard';

export const publicRouter = Router();

/**
 * @openapi
 * /{slug}/config:
 *   get:
 *     tags: [Public]
 *     summary: Get business configuration
 *     description: Returns the public configuration for a business including working hours, form fields, and active staff.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *         description: Business slug (e.g. "demo-salon")
 *     responses:
 *       200:
 *         description: Business config with working hours, form fields, and staff
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BusinessConfig' }
 *       404:
 *         description: Business not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
publicRouter.get('/:slug/config', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const business = await prisma.business.findUnique({
      where: { slug },
      include: {
        workingHours: { orderBy: { dayOfWeek: 'asc' } },
        formFields: { where: { visible: true }, orderBy: { order: 'asc' } },
        staff: { where: { isActive: true } },
      },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Don't expose sensitive fields
    const { ownerPassword, razorpayKeySecret, ...safeConfig } = business;

    res.json(safeConfig);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /{slug}/availability:
 *   get:
 *     tags: [Public]
 *     summary: Get slot availability for a date
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *         description: Date in YYYY-MM-DD format
 *       - in: query
 *         name: staffId
 *         schema: { type: string }
 *         description: Optional staff ID to filter availability
 *     responses:
 *       200:
 *         description: List of time slots with availability info
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/TimeSlot' }
 *       400:
 *         description: Missing date parameter
 *       404:
 *         description: Business not found
 */
publicRouter.get('/:slug/availability', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { date, staffId } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const result = await availabilityService.getAvailability(
      slug,
      date as string,
      staffId as string | undefined
    );

    res.json(result.slots);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /{slug}/bookings:
 *   post:
 *     tags: [Public]
 *     summary: Create a new booking
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, startTime, endTime, customerName, customerPhone, formData]
 *             properties:
 *               date: { type: string, format: date }
 *               startTime: { type: string, example: "09:00" }
 *               endTime: { type: string, example: "09:30" }
 *               customerName: { type: string }
 *               customerPhone: { type: string }
 *               customerEmail: { type: string }
 *               staffId: { type: string }
 *               formData: { type: object }
 *               isRecurring: { type: boolean }
 *               recurringRule: { type: string }
 *     responses:
 *       201:
 *         description: Booking created successfully
 *       400:
 *         description: Invalid request or slot unavailable
 */
publicRouter.post('/:slug/bookings', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const booking = await bookingService.createBooking(slug, req.body);

    // Send notification
    await notificationService.sendBookingConfirmation(booking, booking.business);

    res.status(201).json(booking);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get booking
publicRouter.get('/:slug/bookings/:id', async (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params;
    const booking = await bookingService.getBooking(slug, id);

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json(booking);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update booking
publicRouter.put('/:slug/bookings/:id', async (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params;
    const booking = await bookingService.updateBooking(slug, id, req.body);

    const business = await prisma.business.findUnique({ where: { slug } });
    if (business) {
      await notificationService.sendBookingUpdate(booking, business, req.body);
    }

    res.json(booking);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Cancel booking
publicRouter.delete('/:slug/bookings/:id', async (req: Request, res: Response) => {
  try {
    const { slug, id } = req.params;
    const booking = await bookingService.cancelBooking(slug, id);

    const business = await prisma.business.findUnique({ where: { slug } });
    if (business) {
      await notificationService.sendBookingCancellation(booking, business);

      // Trigger waitlist notification
      if (business.enableWaitlist) {
        const dateStr = new Date(booking.date).toISOString().split('T')[0];
        await waitlistService.notifyNext(business.id, dateStr, booking.startTime);
      }
    }

    res.json(booking);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Waitlist routes (feature-gated)
publicRouter.post('/:slug/waitlist', featureGuard('waitlist'), async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const entry = await waitlistService.addToWaitlist(slug, req.body);
    res.status(201).json(entry);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

publicRouter.delete('/:slug/waitlist/:id', featureGuard('waitlist'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const business = await prisma.business.findFirst({
      where: { slug: req.params.slug },
    });
    if (!business) return res.status(404).json({ error: 'Business not found' });

    await waitlistService.removeEntry(business.id, id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Payment routes (feature-gated)
publicRouter.post('/:slug/payments/initiate', featureGuard('payments'), async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const business = await prisma.business.findUnique({ where: { slug } });
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const { amount, customerName, customerPhone, customerEmail, date, startTime } = req.body;

    const receipt = `rcpt_${Date.now()}`;
    const order = await paymentService.createOrder(amount, 'INR', receipt, business.id);

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: business.razorpayKeyId || process.env.RAZORPAY_KEY_ID,
      name: business.name,
      prefill: {
        name: customerName,
        contact: customerPhone,
        email: customerEmail,
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

publicRouter.post('/:slug/payments/verify', featureGuard('payments'), async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingData,
    } = req.body;

    const business = await prisma.business.findUnique({ where: { slug } });
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const isValid = await paymentService.verifyPayment(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      business.id
    );

    if (!isValid) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Create the booking with payment info
    const booking = await bookingService.createBooking(slug, {
      ...bookingData,
      paymentStatus: 'paid',
      paymentAmount: bookingData.amount,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
    });

    await notificationService.sendBookingConfirmation(booking, booking.business);
    await notificationService.sendPaymentReceipt(booking, business);

    res.json({ success: true, booking });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Recurring booking route (feature-gated)
publicRouter.post('/:slug/recurring', featureGuard('recurring'), async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const result = await recurringService.createRecurringBooking(slug, req.body);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});