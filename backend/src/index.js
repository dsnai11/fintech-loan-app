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
import { startScheduler } from './services/notificationService.js';
import { loadAllConfig } from './services/configService.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(helmet({ contentSecurityPolicy: false })); // admin portal pages use inline scripts/styles
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts, try again in 15 minutes' } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

const PORT = process.env.PORT || 5000;

const mongoUrl = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || process.env.DATABASE_URL || 'mongodb://localhost:27017/fintech-loan';
console.log('Connecting to MongoDB:', mongoUrl.replace(/:\/\/.*@/, '://***@'));
mongoose.connect(mongoUrl)
  .then(async () => {
    console.log('MongoDB connected');
    await loadAllConfig(); // load API keys from DB into memory
    startScheduler();
  })
  .catch(err => console.log('MongoDB connection error:', err));

app.use('/api/auth', authRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/users', userRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin/reports', reportRoutes);
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

app.use(express.static(join(__dirname, '..', 'public')));

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
