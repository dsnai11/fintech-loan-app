import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './routes/auth.js';
import loanRoutes from './routes/loans.js';
import userRoutes from './routes/users.js';
import kycRoutes from './routes/kyc.js';
import adminRoutes from './routes/admin.js';
import configRoutes from './routes/config.js';
import appConfigRoutes from './routes/appConfig.js';
import loanManagementRoutes from './routes/loanManagement.js';
import paymentRoutes from './routes/payments.js';
import emiRoutes from './routes/emi.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import collectionsRoutes from './routes/collections.js';
import complianceRoutes from './routes/compliance.js';
import adminComplianceRoutes from './routes/adminCompliance.js';
import twoFactorRoutes from './routes/twoFactor.js';
import pricingRoutes from './routes/pricing.js';
import adminPricingRoutes from './routes/adminPricing.js';
import adminCustomersRoutes from './routes/adminCustomers.js';
import adminStaffRoutes from './routes/adminStaff.js';
import adminRolesRoutes from './routes/adminRoles.js';
import adminMeRoutes from './routes/adminMe.js';
import adminDecisionsRoutes from './routes/adminDecisions.js';
import adminChargesRoutes from './routes/adminCharges.js';
import onboardingRoutes from './routes/onboarding.js';
import digilockerRoutes from './routes/digilocker.js';
import supportRoutes from './routes/support.js';
import adminSupportRoutes from './routes/adminSupport.js';
import adminAnnouncementsRoutes from './routes/adminAnnouncements.js';
import adminApprovalsRoutes from './routes/adminApprovals.js';
import adminIntegrationsRoutes from './routes/adminIntegrations.js';
import adminDashboardRoutes from './routes/adminDashboard.js';
import referralsRoutes from './routes/referrals.js';
import adminReferralsRoutes from './routes/adminReferrals.js';
import pushRoutes from './routes/push.js';
import offersRoutes from './routes/offers.js';
import adminOffersRoutes from './routes/adminOffers.js';
import adminAssistantRoutes from './routes/adminAssistant.js';
import adminRegulatoryRoutes from './routes/adminRegulatory.js';
import incomeCheckRoutes from './routes/incomeCheck.js';
import adminRemindersRoutes from './routes/adminReminders.js';
import settlementsRoutes from './routes/settlements.js';
import adminNudgesRoutes from './routes/adminNudges.js';
import mandatesRoutes from './routes/mandates.js';
import adminMandatesRoutes from './routes/adminMandates.js';
import appHomeRoutes from './routes/appHome.js';
import appSettingsRoutes from './routes/appSettings.js';
import phoneRoutes from './routes/phone.js';
import termsRoutes from './routes/terms.js';
import { ensureRoles } from './services/permissions.js';
import { startScheduler } from './services/notificationService.js';
import { ensureAdmin } from './services/adminBootstrap.js';
import { loadAllConfig } from './services/configService.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// Railway puts exactly one proxy in front of the app. Without this every visitor looks like the
// proxy, so all users would share one rate limit and every logged IP would be the proxy's.
app.set('trust proxy', 1);

// The portal pages use inline scripts and handlers, so those stay allowed. Everything else is locked
// down: no other origins for scripts, styles or connections, no plugins, no framing, no <base> tricks.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.AUTH_RATE_LIMIT) || 20, message: { error: 'Too many attempts, try again in 15 minutes' } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.API_RATE_LIMIT) || 200 });

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

app.use(express.json({
  limit: '5mb',
  verify: (req, res, buf) => {
    if (req.originalUrl.includes('/webhook/')) req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

const PORT = process.env.PORT || 5000;

const mongoUrl = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || process.env.DATABASE_URL || 'mongodb://localhost:27017/fintech-loan';
console.log('Connecting to MongoDB:', mongoUrl.replace(/:\/\/.*@/, '://***@'));
mongoose.connect(mongoUrl)
  .then(async () => {
    console.log('MongoDB connected');
    await loadAllConfig(); // load API keys from DB into memory
    await ensureAdmin();
    await ensureRoles(true);
    if (process.env.DISABLE_SCHEDULER !== '1') startScheduler();
  })
  .catch(err => console.log('MongoDB connection error:', err));

app.use('/api', (req, res, next) => ensureRoles().then(() => next(), next));
app.use('/api/pricing', pricingRoutes);
app.use('/api/auth/2fa', twoFactorRoutes);
app.use('/api/auth/phone', phoneRoutes);
app.use('/api', termsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/users', userRoutes);
app.use('/api/kyc/digilocker', digilockerRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin/reports', reportRoutes);
app.use('/api/admin/pricing', adminPricingRoutes);
app.use('/api/admin/customers', adminCustomersRoutes);
app.use('/api/admin/staff', adminStaffRoutes);
app.use('/api/admin/roles', adminRolesRoutes);
app.use('/api/admin/me', adminMeRoutes);
app.use('/api/admin/decisions', adminDecisionsRoutes);
app.use('/api/admin/charges', adminChargesRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/admin/support', adminSupportRoutes);
app.use('/api/admin/announcements', adminAnnouncementsRoutes);
app.use('/api/app-settings', appSettingsRoutes);
app.use('/api/app-home', appHomeRoutes);
app.use('/api/admin/assistant', adminAssistantRoutes);
app.use('/api/admin/regulatory', adminRegulatoryRoutes);
app.use('/api/income-check', incomeCheckRoutes);
app.use('/api/admin/reminders', adminRemindersRoutes);
app.use('/api/settlements', settlementsRoutes);
app.use('/api/admin/nudges', adminNudgesRoutes);
app.use('/api/mandates', mandatesRoutes);
app.use('/api/admin/mandates', adminMandatesRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api/admin/offers', adminOffersRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/referrals', referralsRoutes);
app.use('/api/admin/referrals', adminReferralsRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/integrations', adminIntegrationsRoutes);
app.use('/api/admin/approvals', adminApprovalsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin/collections', collectionsRoutes);
app.use('/api/admin/compliance', adminComplianceRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/config', configRoutes);
app.use('/api/admin/loans', loanManagementRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/emi', emiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/app-config', appConfigRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Pages and scripts are re-checked on every load, so a new deploy shows up on the next reload.
app.use(express.static(join(__dirname, '..', 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

app.get('/status', (req, res) => {
  res.json({ status: 'FintechLoan API is running', version: '1.0.0' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
