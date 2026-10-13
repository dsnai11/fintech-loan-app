import { getConfig } from './configService.js';
import { getSettings as appSettings } from './appSettings.js';
import { sendWhatsapp, modeNow as whatsappMode } from './whatsappService.js';

// Sends one SMS through whichever provider is set up in the admin configuration (Fast2SMS, MSG91 or Twilio).
// Returns { sent, provider, configured }. `configured` is false when no real provider is set up.

export const smsConfigured = () => {
  const provider = getConfig('SMS_PROVIDER');
  if (provider === 'fast2sms' || provider === 'msg91') return !!getConfig('SMS_API_KEY');
  if (provider === 'twilio') return !!getConfig('TWILIO_ACCOUNT_SID');
  return false;
};

const tenDigits = phone => String(phone).replace(/\D/g, '').slice(-10);

// `otp` is only needed by MSG91, whose approved template carries the code itself.
export async function sendSms(phone, text, { otp } = {}) {
  const provider = getConfig('SMS_PROVIDER');
  const number = tenDigits(phone);
  try {
    if (provider === 'fast2sms' && getConfig('SMS_API_KEY')) {
      const sender = getConfig('SMS_SENDER_ID', 'LIFINC');
      const r = await fetch(`https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(getConfig('SMS_API_KEY'))}&sender_id=${encodeURIComponent(sender)}&message=${encodeURIComponent(text)}&language=english&route=q&numbers=${number}`).then(x => x.json());
      return { sent: r?.return === true, provider, configured: true };
    }
    if (provider === 'msg91' && getConfig('SMS_API_KEY')) {
      const r = await fetch('https://api.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: { authkey: getConfig('SMS_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: getConfig('MSG91_TEMPLATE_ID'), mobile: `91${number}`, otp }),
      }).then(x => x.json());
      return { sent: r?.type === 'success', provider, configured: true };
    }
    if (provider === 'twilio' && getConfig('TWILIO_ACCOUNT_SID')) {
      const sid = getConfig('TWILIO_ACCOUNT_SID');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${getConfig('TWILIO_AUTH_TOKEN')}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: `+91${number}`, From: getConfig('TWILIO_PHONE'), Body: text }),
      }).then(x => x.json());
      return { sent: !!r?.sid, provider, configured: true };
    }
  } catch (e) {
    console.error('SMS provider error:', e.message);
    return { sent: false, provider, configured: true };
  }
  return { sent: false, provider: provider || 'none', configured: false };
}

// Whether a code can go out on WhatsApp right now: the company chose it, and a real WhatsApp provider is connected.
// In test mode or with no provider, WhatsApp is never claimed: the code goes by SMS.
export const whatsappFirst = () => appSettings().security.otpChannel === 'whatsapp_first' && whatsappMode() === 'live';

// A one-time code: on WhatsApp when the company chose that and it is connected, otherwise (or when the customer asks for SMS
// instead, or WhatsApp fails) by SMS. `via` says which was used, so the app can tell the customer the truth.
export async function sendOtpMessage(phone, text, { otp, channel } = {}) {
  if (channel !== 'sms' && whatsappFirst()) {
    const r = await sendWhatsapp({ phone }, text);
    if (r === 'sent') return { sent: true, via: 'whatsapp', provider: 'whatsapp', configured: true };
  }
  const r = await sendSms(phone, text, { otp });
  return { ...r, via: 'sms' };
}

export default { sendSms, smsConfigured, sendOtpMessage };
