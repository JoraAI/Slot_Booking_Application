import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 10);

  // Create demo business
  const business = await prisma.business.upsert({
    where: { slug: 'demo-salon' },
    update: {},
    create: {
      name: 'Demo Salon & Spa',
      slug: 'demo-salon',
      ownerEmail: 'owner@demosalon.com',
      ownerPassword: hashedPassword,
      bookingWindowDays: 14,
      parallelSeats: 1,
      slotDurationMinutes: 30,
      showAvailableCount: false,
      notifyOwnerEmail: true,
      notifyCustomerEmail: true,
      enableWaitlist: false,
      enableRecurring: false,
      enablePayments: false,
      enableMultiStaff: false,
      paymentMode: 'none',
      servicePrice: 500,
      refundPolicy: 'Full refund if cancelled 24 hours before the appointment.',
      workingHours: {
        create: [
          { dayOfWeek: 0, openTime: '10:00', closeTime: '18:00', isOpen: true },
          { dayOfWeek: 1, openTime: '09:00', closeTime: '20:00', isOpen: true },
          { dayOfWeek: 2, openTime: '09:00', closeTime: '20:00', isOpen: true },
          { dayOfWeek: 3, openTime: '09:00', closeTime: '20:00', isOpen: true },
          { dayOfWeek: 4, openTime: '09:00', closeTime: '20:00', isOpen: true },
          { dayOfWeek: 5, openTime: '09:00', closeTime: '20:00', isOpen: true },
          { dayOfWeek: 6, openTime: '09:00', closeTime: '18:00', isOpen: true },
        ],
      },
      formFields: {
        create: [
          { label: 'Full Name', fieldType: 'text', required: true, order: 1, visible: true, placeholder: 'Enter your full name' },
          { label: 'Age', fieldType: 'number', required: false, order: 2, visible: true, placeholder: 'Enter your age' },
          { label: 'Gender', fieldType: 'select', required: false, order: 3, visible: true, options: ['Male', 'Female', 'Other', 'Prefer not to say'] },
          { label: 'Phone Number', fieldType: 'tel', required: true, order: 4, visible: true, placeholder: 'Enter your phone number' },
          { label: 'Email Address', fieldType: 'email', required: false, order: 5, visible: true, placeholder: 'Enter your email address' },
          { label: 'Notes / Special Requests', fieldType: 'textarea', required: false, order: 6, visible: true, placeholder: 'Any special requests?' },
        ],
      },
      staff: {
        create: [
          { name: 'Priya Sharma', role: 'Senior Stylist', phone: '+919876543210', email: 'priya@demosalon.com', color: '#7C3AED', isActive: true },
          { name: 'Ravi Kumar', role: 'Color Specialist', phone: '+919876543211', email: 'ravi@demosalon.com', color: '#10B981', isActive: true },
          { name: 'Anita Desai', role: 'Spa Therapist', phone: '+919876543212', email: 'anita@demosalon.com', color: '#F59E0B', isActive: true },
        ],
      },
    },
  });

  console.log(`Seeded business: ${business.name} (${business.slug})`);
  console.log('Login: owner@demosalon.com / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });