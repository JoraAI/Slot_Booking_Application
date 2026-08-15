import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

function generatePublicCode(): string {
  return crypto.randomBytes(16).toString('base64url');
}

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 10);

  const business = await prisma.business.upsert({
    where: { slug: 'demo-salon' },
    update: {
      name: 'Demo Salon & Spa',
      timezone: 'Asia/Kolkata',
      description: 'Premium salon and spa services for hair, nails, skin, and relaxation.',
      primaryColor: '#7C3AED',
      secondaryColor: '#10B981',
      accentColor: '#F59E0B',
      enableMultiStaff: true,
      slotGranularityMinutes: 15,
    },
    create: {
      name: 'Demo Salon & Spa',
      slug: 'demo-salon',
      publicCode: generatePublicCode(),
      timezone: 'Asia/Kolkata',
      description: 'Premium salon and spa services for hair, nails, skin, and relaxation.',
      primaryColor: '#7C3AED',
      secondaryColor: '#10B981',
      accentColor: '#F59E0B',
      ownerEmail: 'owner@demosalon.com',
      ownerPassword: hashedPassword,
      bookingWindowDays: 14,
      slotGranularityMinutes: 15,
      showAvailableCount: false,
      notifyOwnerEmail: true,
      notifyCustomerEmail: true,
      enableWaitlist: false,
      enableRecurring: false,
      enablePayments: false,
      enableMultiStaff: true,
      paymentMode: 'none',
      refundPolicy: 'Full refund if cancelled 24 hours before the appointment.',
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

  const existingCategories = await prisma.serviceCategory.count({ where: { businessId: business.id } });
  if (existingCategories === 0) {
    const hair = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Hair', description: 'Hair styling, cutting, and color', displayOrder: 0 } });
    const spa = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Spa & Wellness', description: 'Massage and relaxation therapies', displayOrder: 1 } });
    const nails = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Nails', description: 'Manicure and pedicure services', displayOrder: 2 } });

    const staffMembers = await prisma.staff.findMany({ where: { businessId: business.id } });
    const priya = staffMembers.find(s => s.name === 'Priya Sharma');
    const ravi = staffMembers.find(s => s.name === 'Ravi Kumar');
    const anita = staffMembers.find(s => s.name === 'Anita Desai');

    const hairCut = await prisma.service.create({ data: { businessId: business.id, categoryId: hair.id, name: 'Haircut & Style', description: 'Wash, cut, and finish', durationMinutes: 60, bufferMinutes: 15, price: 500, resourceMode: 'STAFF_BASED', capacity: 1, displayOrder: 0, discountType: 'PERCENTAGE', discountValue: 10, discountLabel: 'Intro Offer', discountActive: true } });
    const color = await prisma.service.create({ data: { businessId: business.id, categoryId: hair.id, name: 'Hair Color', description: 'Full color application', durationMinutes: 120, bufferMinutes: 15, price: 1500, resourceMode: 'STAFF_BASED', capacity: 1, displayOrder: 1 } });
    const massage = await prisma.service.create({ data: { businessId: business.id, categoryId: spa.id, name: 'Swedish Massage', description: 'Full-body relaxation massage', durationMinutes: 90, bufferMinutes: 15, price: 1200, resourceMode: 'STAFF_BASED', capacity: 1, displayOrder: 0 } });
    const facial = await prisma.service.create({ data: { businessId: business.id, categoryId: spa.id, name: 'Signature Facial', description: 'Deep cleansing facial treatment', durationMinutes: 60, bufferMinutes: 10, price: 900, resourceMode: 'POOLED', capacity: 2, displayOrder: 1 } });
    const manicure = await prisma.service.create({ data: { businessId: business.id, categoryId: nails.id, name: 'Classic Manicure', description: 'Nail shaping and polish', durationMinutes: 45, bufferMinutes: 0, price: 350, resourceMode: 'POOLED', capacity: 3, displayOrder: 0 } });

    if (priya && ravi && anita) {
      await prisma.staffService.createMany({ data: [
        { staffId: priya.id, serviceId: hairCut.id, businessId: business.id },
        { staffId: priya.id, serviceId: color.id, businessId: business.id },
        { staffId: ravi.id, serviceId: hairCut.id, businessId: business.id },
        { staffId: ravi.id, serviceId: color.id, businessId: business.id },
        { staffId: anita.id, serviceId: massage.id, businessId: business.id },
      ] });
    }
  }

  const existingSections = await prisma.pageSection.count({ where: { businessId: business.id } });
  if (existingSections === 0) {
    await prisma.pageSection.createMany({ data: [
      { businessId: business.id, type: 'HERO', title: business.description, configuration: { subtitle: 'Book your appointment in seconds', ctaLabel: 'Book Now' }, displayOrder: 0, isVisible: true },
      { businessId: business.id, type: 'SERVICES', title: 'Our Services', configuration: {}, displayOrder: 1, isVisible: true },
      { businessId: business.id, type: 'BUSINESS_HOURS', title: 'Business Hours', configuration: {}, displayOrder: 2, isVisible: true },
      { businessId: business.id, type: 'ABOUT', title: 'About Us', content: 'We provide premium salon and spa services tailored to you.', configuration: {}, displayOrder: 3, isVisible: true },
    ] });
  }

  console.log(`Seeded business: ${business.name} (${business.slug})`);
  console.log(`Public code: ${business.publicCode}`);
  console.log('Login: owner@demosalon.com / admin123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
