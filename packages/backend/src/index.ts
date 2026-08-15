import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { publicRouter } from './routes/public';
import { ownerRouter } from './routes/owner';
import { internalRouter } from './routes/internal';

const app = express();
const PORT = process.env.PORT || 3001;

// Root route — health check + API info
app.get('/', (_req, res) => {
  res.json({
    name: 'Slot Booking Microservice',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      docs: '/api-docs',
      config: '/api/:slug/config',
      availability: '/api/:slug/availability?date=YYYY-MM-DD',
      bookings: '/api/:slug/bookings',
      ownerLogin: '/api/owner/login',
    },
  });
});

// Swagger setup
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Slot Booking Microservice API',
      version: '1.0.0',
      description: 'Universal Slot Booking SaaS Microservice — Salon-First, Industry-Agnostic. Supports multi-staff, waitlist, recurring bookings, payments (Razorpay), and embeddable booking widgets.',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Development server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        BusinessConfig: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            bookingWindowDays: { type: 'integer', default: 7 },
            showAvailableCount: { type: 'boolean' },
            enableWaitlist: { type: 'boolean' },
            enableRecurring: { type: 'boolean' },
            enablePayments: { type: 'boolean' },
            enableMultiStaff: { type: 'boolean' },
            paymentMode: { type: 'string', enum: ['full', 'deposit', 'none'] },
            workingHours: { type: 'array', items: { $ref: '#/components/schemas/WorkingHour' } },
            formFields: { type: 'array', items: { $ref: '#/components/schemas/FormField' } },
            staff: { type: 'array', items: { $ref: '#/components/schemas/Staff' } },
          },
        },
        WorkingHour: {
          type: 'object',
          properties: {
            dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
            openTime: { type: 'string', example: '09:00' },
            closeTime: { type: 'string', example: '18:00' },
            isOpen: { type: 'boolean' },
          },
        },
        FormField: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            fieldType: { type: 'string', enum: ['text', 'number', 'select', 'checkbox', 'tel', 'email', 'textarea'] },
            required: { type: 'boolean' },
            options: { type: 'array', items: { type: 'string' } },
            placeholder: { type: 'string' },
            order: { type: 'integer' },
            visible: { type: 'boolean' },
          },
        },
        Staff: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            color: { type: 'string' },
            isActive: { type: 'boolean' },
          },
        },
        TimeSlot: {
          type: 'object',
          properties: {
            time: { type: 'string', example: '09:00' },
            endTime: { type: 'string', example: '09:30' },
            isAvailable: { type: 'boolean' },
            availableSeats: { type: 'integer' },
            isBlocked: { type: 'boolean' },
            waitlistCount: { type: 'integer' },
          },
        },
        Booking: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            businessId: { type: 'string' },
            staffId: { type: 'string' },
            date: { type: 'string', format: 'date-time' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
            status: { type: 'string', enum: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED', 'COMPLETED', 'NO_SHOW'] },
            customerName: { type: 'string' },
            customerPhone: { type: 'string' },
            customerEmail: { type: 'string' },
            formData: { type: 'object' },
            isRecurring: { type: 'boolean' },
            recurringRule: { type: 'string' },
            recurringGroupId: { type: 'string' },
            paymentStatus: { type: 'string', enum: ['pending', 'partial', 'paid', 'refunded'] },
            paymentAmount: { type: 'number' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        WaitlistEntry: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            date: { type: 'string', format: 'date-time' },
            startTime: { type: 'string' },
            customerName: { type: 'string' },
            customerPhone: { type: 'string' },
            customerEmail: { type: 'string' },
            notified: { type: 'boolean' },
            expired: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        BlockedSlot: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            date: { type: 'string', format: 'date-time' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
            reason: { type: 'string' },
            staffId: { type: 'string' },
          },
        },
        AnalyticsData: {
          type: 'object',
          properties: {
            totalBookings: { type: 'integer' },
            cancellationRate: { type: 'number' },
            peakHour: { type: 'string' },
            busiestDay: { type: 'string' },
            statusBreakdown: { type: 'object', additionalProperties: { type: 'integer' } },
            heatmap: { type: 'array', items: { type: 'object', properties: { day: { type: 'integer' }, hour: { type: 'integer' }, count: { type: 'integer' } } } },
            trend: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, count: { type: 'integer' } } } },
            waitlistMetrics: { type: 'object', nullable: true },
            recurringMetrics: { type: 'object', nullable: true },
            staffPerformance: { type: 'array', nullable: true, items: { type: 'object' } },
            paymentMetrics: { type: 'object', nullable: true },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
    tags: [
      { name: 'Public', description: 'Customer-facing endpoints (no auth required)' },
      { name: 'Owner - Auth', description: 'Owner authentication' },
      { name: 'Owner - Bookings', description: 'Booking management' },
      { name: 'Owner - Block Slots', description: 'Slot blocking management' },
      { name: 'Owner - Config', description: 'Business configuration' },
      { name: 'Owner - Waitlist', description: 'Waitlist management (feature-gated)' },
      { name: 'Owner - Staff', description: 'Staff management (feature-gated)' },
      { name: 'Owner - Payments', description: 'Payment management (feature-gated)' },
      { name: 'Owner - Analytics', description: 'Analytics and reporting' },
      { name: 'Owner - Notifications', description: 'Notification management' },
    ],
  },
  apis: ['./src/routes/*.ts'],
});

// JSON spec endpoint - must be BEFORE swagger-ui middleware
app.get('/swagger.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Slot Booking API Docs',
}));

// Middleware
app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:5173'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes. Owner + internal namespaces are mounted BEFORE the public router so
// the public `/:identifier/...` routes can never shadow `/api/owner/...` or
// `/api/internal/...` (e.g. identifier="owner" must not capture owner routes).
app.use('/api/owner', ownerRouter);
app.use('/api/internal', internalRouter);
app.use('/api', publicRouter);

// Serve frontend static files in production (single-service deployment)
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// SPA fallback: serve index.html for any non-API, non-static routes
app.get('*', (_req, res, next) => {
  // Skip API and docs routes
  if (_req.path.startsWith('/api') || _req.path.startsWith('/api-docs') || _req.path.startsWith('/swagger.json')) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'), (err) => {
    if (err) {
      // Frontend not built — skip to 404
      next();
    }
  });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Bind 0.0.0.0 so container hosts (Fly.io, Docker) can reach the process.
const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Kill the existing process or use a different port (set PORT env var).`);
    console.error(`   Run: fuser -k ${PORT}/tcp`);
    process.exit(1);
  } else {
    throw err;
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => process.exit(0));
});

export default app;