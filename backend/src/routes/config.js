import express from 'express';
import { adminMiddleware } from '../middleware/auth.js';
import { getAllConfig, setManyConfig, getConfig } from '../services/configService.js';
import { audit } from '../services/auditService.js';

const router = express.Router();

// GET /api/admin/config  — return all config (secrets masked)
router.get('/', adminMiddleware, async (req, res) => {
  try {
    const all = await getAllConfig(true);
    // Group by group field
    const grouped = {};
    all.forEach(c => {
      if (!grouped[c.group]) grouped[c.group] = [];
      grouped[c.group].push(c);
    });
    res.json({ config: all, grouped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/config  — save config keys
// Body: { keys: { KEY_NAME: { value, isSecret, group } } }
router.put('/', adminMiddleware, async (req, res) => {
  try {
    const { keys } = req.body;
    if (!keys || typeof keys !== 'object') {
      return res.status(400).json({ error: 'keys object required' });
    }
    const adminEmail = req.user?.email || 'admin';
    // Only save keys that have a non-empty value (don't wipe existing values with empty)
    const toSave = {};
    Object.entries(keys).forEach(([k, v]) => {
      const val = typeof v === 'string' ? v : v.value;
      if (val !== undefined) toSave[k] = v; // save even empty to allow clearing
    });
    await setManyConfig(toSave, adminEmail);
    await audit(req.user, 'CONFIG_UPDATED', { type: 'Config' }, { keys: Object.keys(toSave) }, req);
    res.json({ message: 'Config saved', saved: Object.keys(toSave).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/config/test/:integration  — test a specific integration
router.post('/test/:integration', adminMiddleware, async (req, res) => {
  const { integration } = req.params;
  try {
    const result = await testIntegration(integration, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

async function testIntegration(integration, body = {}) {
  switch (integration) {

    case 'pan': {
      const provider = getConfig('PAN_PROVIDER');
      const apiKey = getConfig('PAN_API_KEY');
      if (!provider || provider === 'sandbox') return { ok: true, mode: 'sandbox', message: 'Sandbox mode — no API call made. PAN format validation only.' };
      if (!apiKey) return { ok: false, error: 'PAN_API_KEY is not set' };
      if (provider === 'karza') {
        const r = await fetch('https://testapi.karza.in/v2/pan-verify', {
          method: 'POST',
          headers: { 'x-karza-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pan: 'ABCDE1234F', consent: 'Y' }),
        }).then(x => x.json()).catch(e => ({ error: e.message }));
        return { ok: r.statusCode === 101 || r.status === 'success', provider, response: r };
      }
      return { ok: false, error: `No test handler for provider: ${provider}` };
    }

    case 'sms': {
      const provider = getConfig('SMS_PROVIDER');
      const apiKey = getConfig('SMS_API_KEY');
      const phone = body.phone || '9999999999';
      if (!provider || provider === 'sandbox') return { ok: true, mode: 'sandbox', message: 'Sandbox mode — OTP returned in API response, no SMS sent.' };
      if (!apiKey) return { ok: false, error: 'SMS_API_KEY is not set' };
      if (provider === 'fast2sms') {
        const r = await fetch(`https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&sender_id=${getConfig('SMS_SENDER_ID','LIFINC')}&message=LIFC+test+OTP:+123456&language=english&route=q&numbers=${phone}`)
          .then(x => x.json()).catch(e => ({ error: e.message }));
        return { ok: r.return === true, provider, response: r };
      }
      return { ok: false, error: `No test handler for provider: ${provider}` };
    }

    case 'bank': {
      const provider = getConfig('BANK_VERIFY_PROVIDER');
      if (!provider || provider === 'sandbox') {
        // Test the free IFSC lookup
        const r = await fetch('https://ifsc.razorpay.com/SBIN0001234').then(x => x.json()).catch(() => null);
        return { ok: !!r, mode: 'sandbox', message: 'IFSC lookup working: '+( r?.BANK || 'no response'), bank: r?.BANK };
      }
      return { ok: false, error: `No test handler for provider: ${provider}` };
    }

    case 'bureau': {
      const provider = getConfig('BUREAU_PROVIDER');
      if (!provider || provider === 'sandbox') return { ok: true, mode: 'sandbox', message: 'Sandbox mode — mock credit score 720 returned for all requests.' };
      return { ok: false, error: `Real bureau test requires registered NBFC. Provider: ${provider}` };
    }

    case 'backend': {
      return { ok: true, message: 'Backend is reachable', timestamp: new Date() };
    }

    default:
      return { ok: false, error: `Unknown integration: ${integration}` };
  }
}

export default router;
