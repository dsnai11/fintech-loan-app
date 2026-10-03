import User from '../models/User.js';
import { audit } from './auditService.js';

// If ADMIN_RESET_PASSWORD is set, the admin account (ADMIN_EMAIL) is created, or its password is
// set to that value, when the server starts. It exists so you can get into a fresh deployment
// without shell access. Set it in the Railway dashboard, sign in, then delete the variable.
export async function ensureAdmin() {
  const password = process.env.ADMIN_RESET_PASSWORD;
  if (!password) return;

  const email = (process.env.ADMIN_EMAIL || 'admin@lifc.in').toLowerCase();
  if (password.length < 10) {
    console.warn('ADMIN_RESET_PASSWORD ignored: it must be at least 10 characters.');
    return;
  }

  try {
    let admin = await User.findOne({ email });
    const created = !admin;
    if (!admin) {
      admin = new User({
        firstName: 'Admin',
        lastName: 'User',
        email,
        phone: `admin-${Date.now()}`,
        password,
      });
    } else {
      admin.password = password;
      admin.status = 'active';
    }
    await admin.save();
    await audit('system', created ? 'ADMIN_CREATED' : 'ADMIN_PASSWORD_RESET', { type: 'User', id: admin._id }, { via: 'ADMIN_RESET_PASSWORD' });
    console.warn(`Admin account ${email} was ${created ? 'created' : 'updated'} from ADMIN_RESET_PASSWORD. Remove that variable now.`);
  } catch (e) {
    console.error('Admin bootstrap failed:', e.message);
  }
}

export default { ensureAdmin };
