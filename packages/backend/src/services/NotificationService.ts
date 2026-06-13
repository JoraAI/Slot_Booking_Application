import nodemailer from 'nodemailer';
import prisma from '../lib/prisma';

class NotificationService {
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
    return this.transporter;
  }

  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      const transporter = this.getTransporter();
      await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'Slot Booking'}" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html,
      });
      console.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      console.error('Email sending failed:', error);
    }
  }

  private async sendWhatsApp(to: string, message: string): Promise<void> {
    // Twilio WhatsApp API integration stub
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_WHATSAPP_FROM;

      if (!accountSid || !authToken || !from) {
        console.log('WhatsApp: Missing Twilio config, skipping');
        return;
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: from,
          To: `whatsapp:${to}`,
          Body: message,
        }),
      });

      if (!response.ok) {
        console.error('WhatsApp sending failed:', await response.text());
      } else {
        console.log(`WhatsApp sent to ${to}`);
      }
    } catch (error) {
      console.error('WhatsApp sending failed:', error);
    }
  }

  async sendBookingConfirmation(booking: any, business: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const html = `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7C3AED;">Booking Confirmed!</h2>
        <p>Hi ${booking.customerName},</p>
        <p>Your appointment at <strong>${business.name}</strong> has been confirmed.</p>
        <div style="background: #F9FAFB; padding: 16px; border-radius: 12px; margin: 16px 0;">
          <p><strong>Date:</strong> ${dateStr}</p>
          <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>
          ${booking.staff ? `<p><strong>Staff:</strong> ${booking.staff.name}</p>` : ''}
        </div>
        <p style="color: #6B7280; font-size: 14px;">Booking ID: ${booking.id}</p>
      </div>
    `;

    // Notify customer
    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Booking Confirmed - ${business.name}`, html);
    }
    if (business.notifyCustomerWhatsapp && booking.customerPhone) {
      await this.sendWhatsApp(booking.customerPhone,
        `✅ Booking Confirmed!\n\n${business.name}\n📅 ${dateStr}\n🕐 ${booking.startTime} - ${booking.endTime}\n${booking.staff ? `👤 ${booking.staff.name}\n` : ''}Booking ID: ${booking.id}`
      );
    }

    // Notify owner
    if (business.notifyOwnerEmail) {
      await this.sendEmail(business.ownerEmail, `New Booking - ${booking.customerName}`,
        `<h2>New Booking at ${business.name}</h2>
        <p><strong>Customer:</strong> ${booking.customerName}</p>
        <p><strong>Phone:</strong> ${booking.customerPhone}</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>
        ${booking.staff ? `<p><strong>Staff:</strong> ${booking.staff.name}</p>` : ''}`
      );
    }
    if (business.notifyOwnerWhatsapp && business.ownerWhatsapp) {
      await this.sendWhatsApp(business.ownerWhatsapp,
        `📅 New Booking!\n\n${booking.customerName}\n📞 ${booking.customerPhone}\n🕐 ${dateStr} ${booking.startTime}-${booking.endTime}`
      );
    }
  }

  async sendBookingCancellation(booking: any, business: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Booking Cancelled - ${business.name}`,
        `<h2 style="color: #EF4444;">Booking Cancelled</h2>
        <p>Hi ${booking.customerName},</p>
        <p>Your appointment at <strong>${business.name}</strong> on ${dateStr} at ${booking.startTime} has been cancelled.</p>
        <p>Booking ID: ${booking.id}</p>`
      );
    }
    if (business.notifyOwnerEmail) {
      await this.sendEmail(business.ownerEmail, `Booking Cancelled - ${booking.customerName}`,
        `<h2>Booking Cancelled</h2>
        <p>${booking.customerName}'s booking on ${dateStr} at ${booking.startTime} has been cancelled.</p>`
      );
    }
  }

  async sendBookingUpdate(booking: any, business: any, changes: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Booking Updated - ${business.name}`,
        `<h2>Booking Updated</h2>
        <p>Hi ${booking.customerName},</p>
        <p>Your booking at <strong>${business.name}</strong> has been updated.</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>`
      );
    }
  }

  async sendWaitlistJoined(entry: any, business: any): Promise<void> {
    if (entry.customerEmail) {
      await this.sendEmail(entry.customerEmail, `Added to Waitlist - ${business.name}`,
        `<h2>You're on the Waitlist!</h2>
        <p>Hi ${entry.customerName},</p>
        <p>You've been added to the waitlist for ${business.name}.</p>
        <p>We'll notify you if a slot opens up.</p>`
      );
    }
  }

  async sendWaitlistOpened(entry: any, business: any, bookingLink: string): Promise<void> {
    const dateStr = new Date(entry.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (entry.customerEmail) {
      await this.sendEmail(entry.customerEmail, `Slot Available! - ${business.name}`,
        `<h2 style="color: #10B981;">A Slot Just Opened!</h2>
        <p>Hi ${entry.customerName},</p>
        <p>A slot is now available at <strong>${business.name}</strong> on ${dateStr} at ${entry.startTime}.</p>
        <p>You have <strong>30 minutes</strong> to book this slot.</p>
        <a href="${bookingLink}" style="background: #7C3AED; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Book Now</a>`
      );
    }
    if (entry.customerPhone) {
      await this.sendWhatsApp(entry.customerPhone,
        `🎉 A slot just opened!\n\n${business.name}\n📅 ${dateStr}\n🕐 ${entry.startTime}\n\nBook within 30 minutes:\n${bookingLink}`
      );
    }
  }

  async sendWaitlistExpired(entry: any, business: any): Promise<void> {
    if (entry.customerEmail) {
      await this.sendEmail(entry.customerEmail, `Waitlist Expired - ${business.name}`,
        `<h2>Waitlist Slot Expired</h2>
        <p>The slot that opened up at ${business.name} has expired. You've been removed from the waitlist.</p>`
      );
    }
  }

  async sendRecurringSeriesConfirmation(bookings: any[], business: any): Promise<void> {
    if (bookings.length === 0) return;
    const first = bookings[0];
    const dates = bookings.map(b => new Date(b.date).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })).join(', ');

    if (business.notifyCustomerEmail && first.customerEmail) {
      await this.sendEmail(first.customerEmail, `Recurring Booking Confirmed - ${business.name}`,
        `<h2>Recurring Booking Confirmed! 🔄</h2>
        <p>Hi ${first.customerName},</p>
        <p>Your recurring booking at <strong>${business.name}</strong> has been confirmed for ${bookings.length} sessions.</p>
        <p><strong>Dates:</strong> ${dates}</p>
        <p><strong>Time:</strong> ${first.startTime} - ${first.endTime}</p>`
      );
    }
  }

  async sendRecurringSeriesCancellation(bookings: any[], business: any): Promise<void> {
    if (bookings.length === 0) return;
    const first = bookings[0];

    if (business.notifyCustomerEmail && first.customerEmail) {
      await this.sendEmail(first.customerEmail, `Recurring Booking Cancelled - ${business.name}`,
        `<h2>Recurring Booking Cancelled</h2>
        <p>Hi ${first.customerName},</p>
        <p>Your recurring booking series at <strong>${business.name}</strong> (${bookings.length} sessions) has been cancelled.</p>`
      );
    }
  }

  async sendRecurringReminder(booking: any, business: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Reminder: Appointment Tomorrow - ${business.name}`,
        `<h2>Appointment Reminder 🔔</h2>
        <p>Hi ${booking.customerName},</p>
        <p>This is a reminder for your appointment at <strong>${business.name}</strong> tomorrow.</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>`
      );
    }
  }

  async sendPaymentReceipt(booking: any, business: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Payment Receipt - ${business.name}`,
        `<h2>Payment Receipt 💳</h2>
        <p>Hi ${booking.customerName},</p>
        <p>Payment received for your appointment at <strong>${business.name}</strong>.</p>
        <div style="background: #F9FAFB; padding: 16px; border-radius: 12px; margin: 16px 0;">
          <p><strong>Amount:</strong> ₹${booking.paymentAmount}</p>
          <p><strong>Date:</strong> ${dateStr}</p>
          <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>
          <p><strong>Transaction ID:</strong> ${booking.razorpayPaymentId}</p>
        </div>`
      );
    }
  }

  async sendPaymentRefundConfirmation(booking: any, business: any): Promise<void> {
    if (booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Refund Processed - ${business.name}`,
        `<h2>Refund Processed</h2>
        <p>Hi ${booking.customerName},</p>
        <p>A refund of ₹${booking.paymentAmount} has been processed for your cancelled booking at <strong>${business.name}</strong>.</p>
        <p>The refund will be credited to your original payment method within 5-7 business days.</p>`
      );
    }
  }

  async sendTestNotification(businessId: string): Promise<{ email: boolean; whatsapp: boolean }> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');

    let emailSent = false;
    let whatsappSent = false;

    try {
      await this.sendEmail(business.ownerEmail, `Test Notification - ${business.name}`,
        `<h2>Test Notification ✅</h2><p>Your notification system is working correctly!</p>`
      );
      emailSent = true;
    } catch (e) { /* already logged */ }

    if (business.ownerWhatsapp) {
      try {
        await this.sendWhatsApp(business.ownerWhatsapp, `✅ Test notification from ${business.name}. Your notification system is working!`);
        whatsappSent = true;
      } catch (e) { /* already logged */ }
    }

    return { email: emailSent, whatsapp: whatsappSent };
  }
}

export const notificationService = new NotificationService();