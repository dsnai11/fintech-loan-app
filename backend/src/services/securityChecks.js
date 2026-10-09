import { getConfig } from './configService.js';

// A self-check of how this deployment is set up, shown on the System health page. It cannot prove the platform is secure (that takes
// an outside tester), but it catches the settings that are most often left wrong. `critical` ones should be fixed before real customers.
export const isProduction = () => process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID;

const WEAK = ['secret', 'jwt_secret', 'changeme', 'change-me', 'test-secret', 'your-secret-key', 'password', '123456'];

export function securityChecks() {
  const out = [];
  const add = (key, label, ok, severity, fix) => out.push({ key, label, ok: !!ok, severity, fix: ok ? '' : fix });
  const secret = process.env.JWT_SECRET || '';
  add('jwt', 'Sign-in secret (JWT_SECRET) is long and not a common word', secret.length >= 32 && !WEAK.includes(secret.toLowerCase()), 'critical', 'Set JWT_SECRET in Railway to a random string of at least 32 characters. Everyone is signed out when you change it.');
  add('origins', 'Only your own web addresses may call the API (ALLOWED_ORIGINS)', !!process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS !== '*', 'warning', 'Set ALLOWED_ORIGINS in Railway to the addresses of your portal and web app, separated by commas.');
  add('staff2fa', 'Two-step sign-in is required for staff', process.env.STAFF_REQUIRE_2FA !== 'false', 'critical', 'Remove STAFF_REQUIRE_2FA=false from Railway.');
  add('reset', 'The admin reset password variable has been removed (ADMIN_RESET_PASSWORD)', !process.env.ADMIN_RESET_PASSWORD, 'critical', 'Delete ADMIN_RESET_PASSWORD from Railway once you have signed in. Anyone who can read the variables can take over the admin account.');
  const live = getConfig('PAYMENT_MODE', process.env.PAYMENT_MODE || '') === 'live' || (!!process.env.RAZORPAY_KEY_ID && !/test/i.test(process.env.RAZORPAY_KEY_ID));
  add('webhook', 'Payment notifications are checked with a secret (RAZORPAY_WEBHOOK_SECRET)', !live || !!(process.env.RAZORPAY_WEBHOOK_SECRET || getConfig('RAZORPAY_WEBHOOK_SECRET')), 'critical', 'Set RAZORPAY_WEBHOOK_SECRET so that nobody can fake a payment notification.');
  add('limits', 'Request limits are on', !(Number(process.env.API_RATE_LIMIT) > 100000) && !(Number(process.env.AUTH_RATE_LIMIT) > 1000), 'warning', 'Remove API_RATE_LIMIT and AUTH_RATE_LIMIT from Railway, or set normal values (200 and 20).');
  add('gates', 'Phone check, set-up check and terms are required before a loan', process.env.REQUIRE_PHONE_VERIFIED !== 'false' && process.env.REQUIRE_ONBOARDING !== 'false' && process.env.REQUIRE_TERMS !== 'false', 'warning', 'Remove REQUIRE_PHONE_VERIFIED, REQUIRE_ONBOARDING and REQUIRE_TERMS set to false from Railway.');
  const mongo = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || process.env.DATABASE_URL || '';
  add('db', 'The database needs a user name and password', /^mongodb(\+srv)?:\/\/[^/@]+:[^/@]+@/.test(mongo), 'critical', 'Use a MongoDB address that includes a user name and password, and keep the database private.');
  add('email', 'Email is set up (password resets and alerts)', !!(process.env.EMAIL_USER || getConfig('EMAIL_USER')), 'warning', 'Add the email settings in Configuration so customers can reset passwords and alerts can reach you.');
  return out;
}

export default { securityChecks, isProduction };
