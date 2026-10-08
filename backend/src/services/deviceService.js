import DeviceBinding from '../models/DeviceBinding.js';
import User from '../models/User.js';
import { clientIp } from './auditService.js';
import { raise } from './amlService.js';
import { getConfig } from './configService.js';

// Fraud signals from the phone and the network. Each raises a review item in the compliance team's alert list; none of them
// blocks a customer by itself.
//   SHARED_DEVICE  - the same app installation is used by more than one account
//   SHARED_IP      - many different accounts came from one internet address in a day (could also be a shop or office wifi)
//   NEW_DEVICE     - an account that has used the app for a while applies for a loan from a phone it has not used before
// Not covered, because they need extra phone permissions and plugins: SIM binding, hardware ids, GPS location.

const DAY = 864e5;
const settings = () => ({
  sharedIpAccounts: Math.max(2, Number(getConfig('FRAUD_SHARED_IP_ACCOUNTS', '8')) || 8),
  newDeviceAfterDays: Math.max(1, Number(getConfig('FRAUD_NEW_DEVICE_AFTER_DAYS', '7')) || 7),
});

export const installIdOf = req => {
  const v = String(req.headers?.['x-install-id'] || '').trim();
  return /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null;
};

// Records that this account used this installation, and looks for the signals above. Never throws.
// event: 'login' | 'signup' | 'apply'
export async function recordDevice(req, userId, event) {
  try {
    const installId = installIdOf(req);
    if (!installId) return { known: false, signals: [] };
    const ip = clientIp(req) || '';
    const now = new Date();
    const existingBefore = await DeviceBinding.find({ userId }).lean();
    const seenBefore = existingBefore.find(b => b.installId === installId);
    await DeviceBinding.updateOne(
      { installId, userId },
      { $set: { lastSeenAt: now, lastIp: ip, platform: String(req.headers['x-platform'] || '').slice(0, 20), appVersion: String(req.headers['x-app-version'] || '').slice(0, 20) }, $inc: { events: 1 }, $setOnInsert: { firstSeenAt: now } },
      { upsert: true }
    );

    const user = await User.findById(userId);
    if (!user || user.role !== 'customer') return { known: true, signals: [] };
    const s = settings();
    const signals = [];

    const sameDevice = await DeviceBinding.find({ installId, userId: { $ne: userId } }).lean();
    if (sameDevice.length) {
      signals.push('SHARED_DEVICE');
      const others = await User.find({ _id: { $in: sameDevice.map(b => b.userId) } }).select('firstName lastName').lean();
      await raise('SHARED_DEVICE', 'HIGH', user, null, `The same phone was used by ${sameDevice.length + 1} accounts: this one and ${others.map(o => `${o.firstName} ${o.lastName}`).join(', ')}.`);
      for (const o of others) {
        const ou = await User.findById(o._id);
        if (ou && ou.role === 'customer') await raise('SHARED_DEVICE', 'HIGH', ou, null, `The same phone was also used by ${user.firstName} ${user.lastName}.`);
      }
    }

    if (ip) {
      const recent = await DeviceBinding.distinct('userId', { lastIp: ip, lastSeenAt: { $gte: new Date(+now - DAY) } });
      if (recent.length >= s.sharedIpAccounts) {
        signals.push('SHARED_IP');
        await raise('SHARED_IP', 'MEDIUM', user, null, `${recent.length} different accounts used the app from the same internet address (${ip}) in the last day.`);
      }
    }

    if (event === 'apply' && !seenBefore) {
      const oldest = existingBefore.length ? Math.min(...existingBefore.map(b => +new Date(b.firstSeenAt))) : null;
      if (oldest && now - oldest > s.newDeviceAfterDays * DAY) {
        signals.push('NEW_DEVICE');
        await raise('NEW_DEVICE', 'MEDIUM', user, null, `This account has used the app since ${new Date(oldest).toLocaleDateString('en-IN')} and is applying for a loan from a phone it has not used before.`);
      }
    }
    return { known: true, signals };
  } catch (e) {
    console.error('Device check failed:', e.message);
    return { known: false, signals: [] };
  }
}

// What staff see on a customer: the phones they used and who else used them
export async function devicesOf(userId) {
  const rows = await DeviceBinding.find({ userId }).sort({ lastSeenAt: -1 }).limit(10).lean();
  const out = [];
  for (const r of rows) {
    const others = await DeviceBinding.countDocuments({ installId: r.installId, userId: { $ne: userId } });
    out.push({ platform: r.platform, appVersion: r.appVersion, firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, lastIp: r.lastIp, otherAccounts: others, idEnds: r.installId.slice(-6) });
  }
  return out;
}

export default { recordDevice, devicesOf, installIdOf };
