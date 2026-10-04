import crypto from 'crypto';

// Razorpay signs the exact bytes it sends, using the webhook secret you set in its dashboard
// (not your API key secret). Re-serialising parsed JSON changes the bytes, so we verify against
// the raw body captured in index.js. With no secret configured the webhook is switched off.
export function verifyRazorpayWebhook(req) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return { ok: false, status: 503, error: 'Webhook is not configured' };

  const signature = req.headers['x-razorpay-signature'];
  if (typeof signature !== 'string' || !req.rawBody) return { ok: false, status: 401, error: 'Invalid signature' };

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'Invalid signature' };
  return { ok: true };
}

export default { verifyRazorpayWebhook };
