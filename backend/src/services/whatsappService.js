import { getConfig } from './configService.js';

// WhatsApp messages (reminders). WhatsApp only lets a business start a conversation with an approved message template, so a
// real provider (Gupshup, Interakt, Twilio, Meta Cloud API) has to be set up with templates approved first.
// A provider adapter is { send({ to, text, user }) -> 'sent' | throws } and is registered in PROVIDERS once the lender has one.
// Until then, outside production, "test" mode only records that the message would have gone out. In production with no
// provider the channel is simply off. Nothing is ever sent to a made-up address.

export const PROVIDERS = {};
export const providerName = () => getConfig('WHATSAPP_PROVIDER') || '';
const realProvider = () => PROVIDERS[providerName()] || null;
export const modeNow = () => (realProvider() ? 'live' : process.env.PAYMENT_MODE !== 'PRODUCTION' ? 'test' : 'unavailable');

// Returns 'sent', 'test' (recorded only), 'skipped' (no number or not available) or 'failed'
export async function sendWhatsapp(user, text) {
  if (!user?.phone) return 'skipped';
  const mode = modeNow();
  if (mode === 'unavailable') return 'skipped';
  if (mode === 'test') return 'test';
  try {
    await realProvider().send({ to: user.phone, text, user });
    return 'sent';
  } catch (e) {
    console.error('WhatsApp failed:', e.message);
    return 'failed';
  }
}

export default { sendWhatsapp, modeNow, PROVIDERS };
