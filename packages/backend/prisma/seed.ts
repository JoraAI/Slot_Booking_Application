import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { ensureServiceImages } from './serviceImages';

const prisma = new PrismaClient();

function generatePublicCode(): string {
  return crypto.randomBytes(16).toString('base64url');
}

function durationMinutesToBuffer(durationMinutes: number): number {
  return durationMinutes >= 60 ? 15 : 0;
}

type FormFieldSeed = {
  label: string;
  fieldType: string;
  required: boolean;
  visible: boolean;
  placeholder?: string;
  options?: string[];
};

/**
 * A business with no intake form cannot take bookings, so re-seeding restores
 * the defaults for businesses whose fields are missing.
 */
async function ensureFormFields(businessId: string, fields: FormFieldSeed[]): Promise<void> {
  const existing = await prisma.formField.count({ where: { businessId } });
  if (existing > 0) return;
  await prisma.formField.createMany({
    data: fields.map((field, order) => ({
      businessId,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      visible: field.visible,
      placeholder: field.placeholder ?? null,
      options: field.options ?? [],
      order,
    })),
  });
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
      ownerEmail: 'owner@demosalon.com',
      ownerPassword: hashedPassword,
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
      staff: {
        create: [
          { name: 'Priya Sharma', role: 'Senior Stylist', phone: '+919876543210', email: 'priya@demosalon.com', color: '#7C3AED', isActive: true },
          { name: 'Ravi Kumar', role: 'Color Specialist', phone: '+919876543211', email: 'ravi@demosalon.com', color: '#10B981', isActive: true },
          { name: 'Anita Desai', role: 'Spa Therapist', phone: '+919876543212', email: 'anita@demosalon.com', color: '#F59E0B', isActive: true },
        ],
      },
    },
  });

  await ensureFormFields(business.id, [
    { label: 'Full Name', fieldType: 'text', required: true, visible: true, placeholder: 'Enter your full name' },
    { label: 'Age', fieldType: 'number', required: false, visible: true, placeholder: 'Enter your age' },
    { label: 'Gender', fieldType: 'select', required: false, visible: true, options: ['Male', 'Female', 'Other', 'Prefer not to say'] },
    { label: 'Phone Number', fieldType: 'tel', required: false, visible: true, placeholder: 'Enter your phone number' },
    { label: 'Email Address', fieldType: 'email', required: false, visible: true, placeholder: 'Enter your email address' },
    { label: 'Notes / Special Requests', fieldType: 'textarea', required: false, visible: true, placeholder: 'Any special requests?' },
  ]);

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

  const eclat = await prisma.business.upsert({
    where: { slug: 'eclat-unisex-salon' },
    update: {
      name: 'Eclat Unisex Salon',
      timezone: 'Asia/Kolkata',
      description: 'Professional unisex hair, grooming, beauty, and bridal services in Kandivali West.',
      logoUrl: '/eclat-logo.jpeg',
      address: 'Shop No. 1, Vardhaman Kutir Building, Shankar Lane, opposite Jain Temple, Kandivali West, Mumbai, Maharashtra 400067',
      primaryColor: '#D72F68',
      secondaryColor: '#202020',
      accentColor: '#F2F2F2',
      enableMultiStaff: true,
      slotGranularityMinutes: 15,
      ownerEmail: 'owner@eclatunisexsalon.in',
      ownerPassword: hashedPassword,
    },
    create: {
      name: 'Eclat Unisex Salon',
      slug: 'eclat-unisex-salon',
      publicCode: generatePublicCode(),
      timezone: 'Asia/Kolkata',
      description: 'Professional unisex hair, grooming, beauty, and bridal services in Kandivali West.',
      logoUrl: '/eclat-logo.jpeg',
      address: 'Shop No. 1, Vardhaman Kutir Building, Shankar Lane, opposite Jain Temple, Kandivali West, Mumbai, Maharashtra 400067',
      primaryColor: '#D72F68',
      secondaryColor: '#202020',
      accentColor: '#F2F2F2',
      ownerEmail: 'owner@eclatunisexsalon.in',
      ownerPassword: hashedPassword,
      bookingWindowDays: 30,
      slotGranularityMinutes: 15,
      showAvailableCount: false,
      notifyOwnerEmail: false,
      notifyCustomerEmail: true,
      enableWaitlist: false,
      enableRecurring: false,
      enablePayments: false,
      enableMultiStaff: true,
      paymentMode: 'none',
      refundPolicy: 'Please cancel or reschedule at least 24 hours before your appointment.',
      workingHours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          openTime: '10:00',
          closeTime: '21:00',
          isOpen: true,
        })),
      },
      staff: {
        create: [
          { name: 'Riya Shah', role: 'Senior Hair Stylist', color: '#D72F68', isActive: true },
          { name: 'Arjun Mehta', role: 'Hair & Grooming Specialist', color: '#2563EB', isActive: true },
          { name: 'Neha Kapoor', role: 'Beauty & Bridal Artist', color: '#9333EA', isActive: true },
        ],
      },
    },
  });

  await ensureFormFields(eclat.id, [
    { label: 'Full Name', fieldType: 'text', required: true, visible: true, placeholder: 'Enter your full name' },
    { label: 'Phone Number', fieldType: 'tel', required: false, visible: true, placeholder: 'Enter your phone number' },
    { label: 'Email Address', fieldType: 'email', required: false, visible: true, placeholder: 'Enter your email address' },
    { label: 'Notes / Special Requests', fieldType: 'textarea', required: false, visible: true, placeholder: 'Hair length, preferred look, or special requests' },
  ]);

  const existingEclatCategories = await prisma.serviceCategory.count({ where: { businessId: eclat.id } });
  if (existingEclatCategories === 0) {
    const categoryDefinitions = [
      { name: 'Cuts & Styling', description: 'Cuts, styling, washing, and everyday grooming', displayOrder: 0 },
      { name: 'Color & Extensions', description: 'Professional color, highlights, gloss, and extensions', displayOrder: 1 },
      { name: 'Hair Treatments', description: 'Repair, hydration, texture, and smoothing treatments', displayOrder: 2 },
      { name: 'Beauty & Bridal', description: 'Threading, massage, and bridal-ready services', displayOrder: 3 },
    ];
    const createdCategories = await Promise.all(categoryDefinitions.map(category =>
      prisma.serviceCategory.create({ data: { businessId: eclat.id, ...category } })
    ));
    const categoryIds = Object.fromEntries(createdCategories.map(category => [category.name, category.id]));

    // Service names come from the salon's Google business listing. Prices are
    // realistic starting prices for this market; final quotes can vary by hair length.
    const serviceDefinitions = [
      { category: 'Cuts & Styling', name: 'Haircut', description: 'Consultation, precision cut, and finish', durationMinutes: 45, price: 500 },
      { category: 'Cuts & Styling', name: "Kids' Cut", description: 'Haircut for children aged 12 and under', durationMinutes: 30, price: 350 },
      { category: 'Cuts & Styling', name: 'Bang Trim', description: 'Fringe shaping and tidy-up', durationMinutes: 15, price: 200 },
      { category: 'Cuts & Styling', name: 'Hairstyling', description: 'Professional styling for your chosen look', durationMinutes: 60, price: 800 },
      { category: 'Cuts & Styling', name: 'Curly Hair Styling', description: 'Curl-focused shaping, definition, and finish', durationMinutes: 75, price: 1000 },
      { category: 'Cuts & Styling', name: 'Blowdry', description: 'Wash and professional blow-dry finish', durationMinutes: 45, price: 600 },
      { category: 'Cuts & Styling', name: 'Shampoo & Conditioning', description: 'Cleansing wash with conditioning care', durationMinutes: 30, price: 400 },
      { category: 'Cuts & Styling', name: 'Beard Trim', description: 'Beard shaping and clean finish', durationMinutes: 30, price: 300 },
      { category: 'Cuts & Styling', name: 'Shaving', description: 'Classic clean shave and finishing care', durationMinutes: 30, price: 250 },
      { category: 'Color & Extensions', name: 'Hair Coloring', description: 'Single-process professional hair color; starting price', durationMinutes: 120, price: 2500 },
      { category: 'Color & Extensions', name: 'Balayage', description: 'Hand-painted, natural-looking dimensional color; starting price', durationMinutes: 180, price: 4500 },
      { category: 'Color & Extensions', name: 'Ombre Hair Color', description: 'Graduated two-tone color application; starting price', durationMinutes: 180, price: 4500 },
      { category: 'Color & Extensions', name: 'Hair Highlighting', description: 'Dimensional highlights; starting price', durationMinutes: 150, price: 3000 },
      { category: 'Color & Extensions', name: 'Gloss or Glaze', description: 'Shine-enhancing translucent color finish', durationMinutes: 60, price: 1500 },
      { category: 'Color & Extensions', name: 'Hair Glazing', description: 'Semi-permanent glaze for tone and shine', durationMinutes: 60, price: 1500 },
      { category: 'Color & Extensions', name: 'Hair Glossing', description: 'Gloss treatment to refresh color and boost shine', durationMinutes: 60, price: 1500 },
      { category: 'Color & Extensions', name: 'Hair Extensions', description: 'Extension fitting consultation and installation; starting price', durationMinutes: 180, price: 5000 },
      { category: 'Hair Treatments', name: 'Hair Hydration Treatment', description: 'Deep hydration for dry or stressed hair', durationMinutes: 60, price: 1200 },
      { category: 'Hair Treatments', name: 'Hair Straightening', description: 'Long-lasting straightening treatment; starting price', durationMinutes: 180, price: 3500 },
      { category: 'Hair Treatments', name: 'Brazilian Hair Straightening', description: 'Brazilian smoothing and frizz-control treatment; starting price', durationMinutes: 240, price: 5500 },
      { category: 'Hair Treatments', name: 'Hair Treatment', description: 'Personalized repair treatment based on hair condition', durationMinutes: 75, price: 1500 },
      { category: 'Hair Treatments', name: 'Keratin Treatment', description: 'Keratin smoothing treatment; starting price', durationMinutes: 180, price: 4500 },
      { category: 'Hair Treatments', name: 'Perm', description: 'Professional texture and curl service; starting price', durationMinutes: 180, price: 3500 },
      { category: 'Beauty & Bridal', name: 'Eyebrow Threading', description: 'Precise eyebrow shaping with thread', durationMinutes: 15, price: 150 },
      { category: 'Beauty & Bridal', name: 'Massage', description: 'Relaxing head, neck, and shoulder massage', durationMinutes: 60, price: 1000 },
      { category: 'Beauty & Bridal', name: 'Bridal Services', description: 'Bridal hair and makeup package with consultation; starting price', durationMinutes: 180, price: 7500 },
    ];

    const createdServices = await Promise.all(serviceDefinitions.map((service, displayOrder) => {
      const { category, ...data } = service;
      return prisma.service.create({
        data: {
          businessId: eclat.id,
          categoryId: categoryIds[category],
          ...data,
          bufferMinutes: durationMinutesToBuffer(data.durationMinutes),
          resourceMode: 'STAFF_BASED',
          capacity: 1,
          displayOrder,
        },
      });
    }));

    const eclatStaff = await prisma.staff.findMany({ where: { businessId: eclat.id } });
    const staffByName = Object.fromEntries(eclatStaff.map(member => [member.name, member.id]));
    const beautyServices = new Set(['Eyebrow Threading', 'Massage', 'Bridal Services']);
    await prisma.staffService.createMany({
      data: createdServices.flatMap(service => {
        const staffNames = beautyServices.has(service.name)
          ? ['Neha Kapoor']
          : service.name === 'Beard Trim' || service.name === 'Shaving'
            ? ['Arjun Mehta']
            : ['Riya Shah', 'Arjun Mehta'];
        return staffNames.map(name => ({ businessId: eclat.id, serviceId: service.id, staffId: staffByName[name] }));
      }),
    });
  }

  const existingEclatSections = await prisma.pageSection.count({ where: { businessId: eclat.id } });
  if (existingEclatSections === 0) {
    await prisma.pageSection.createMany({ data: [
      { businessId: eclat.id, type: 'HERO', title: 'Style, care, and confidence—made for you', configuration: { subtitle: 'Book your next salon appointment online', ctaLabel: 'Book Now' }, displayOrder: 0, isVisible: true },
      { businessId: eclat.id, type: 'SERVICES', title: 'Our Services', configuration: {}, displayOrder: 1, isVisible: true },
      { businessId: eclat.id, type: 'BUSINESS_HOURS', title: 'Opening Hours', configuration: {}, displayOrder: 2, isVisible: true },
      { businessId: eclat.id, type: 'ABOUT', title: 'About Eclat', content: 'A modern unisex salon for precision cuts, color, smoothing treatments, grooming, and bridal styling.', configuration: {}, displayOrder: 3, isVisible: true },
      { businessId: eclat.id, type: 'CONTACT', title: 'Visit Us', configuration: {}, displayOrder: 4, isVisible: true },
    ] });
  }

  const eclatServices = await prisma.service.findMany({
    where: { businessId: eclat.id },
    select: { id: true, name: true, imageUrl: true },
  });
  const demoServices = await prisma.service.findMany({
    where: { businessId: business.id },
    select: { id: true, name: true, imageUrl: true },
  });
  const demoImages = await ensureServiceImages({
    businessId: business.id,
    services: demoServices,
    coverImageUrl: business.coverImageUrl,
    setCover: true,
  });
  const eclatImages = await ensureServiceImages({
    businessId: eclat.id,
    services: eclatServices,
    coverImageUrl: eclat.coverImageUrl,
    setCover: true,
  });

  console.log(`Seeded business: ${business.name} (${business.slug})`);
  console.log(`Public code: ${business.publicCode}`);
  console.log('Login: owner@demosalon.com / admin123');
  console.log(`Seeded business: ${eclat.name} (${eclat.slug})`);
  console.log(`Public code: ${eclat.publicCode}`);
  console.log('Login: owner@eclatunisexsalon.in / admin123');
  console.log(`Service images: demo +${demoImages.attached}${demoImages.cover ? ' (cover)' : ''}, eclat +${eclatImages.attached}${eclatImages.cover ? ' (cover)' : ''}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
