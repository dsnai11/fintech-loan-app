import express from 'express';
import AppConfiguration from '../models/AppConfiguration.js';
import { adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET all app configuration (public - for mobile apps)
router.get('/', async (req, res) => {
  try {
    let config = await AppConfiguration.findOne({});
    if (!config) {
      config = await AppConfiguration.create({});
    }
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET specific configuration section
router.get('/:section', async (req, res) => {
  try {
    const { section } = req.params;
    const config = await AppConfiguration.findOne({});
    if (!config) return res.status(404).json({ error: 'Configuration not found' });

    if (section === 'loanProducts') {
      return res.json({ loanProducts: config.loanProducts });
    }
    if (section === 'kycVerifications') {
      return res.json({ kycVerifications: config.kycVerifications });
    }
    if (section === 'providers') {
      return res.json({ providers: config.providers });
    }
    if (section === 'uiConfig') {
      return res.json({ uiConfig: config.uiConfig });
    }
    if (section === 'features') {
      return res.json({ features: config.features });
    }

    res.status(404).json({ error: 'Section not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== ADMIN ENDPOINTS (require auth) ==========

// UPDATE loan product
router.put('/admin/loan-products/:productId', adminMiddleware, async (req, res) => {
  try {
    let config = await AppConfiguration.findOne({});
    if (!config) config = await AppConfiguration.create({});

    const { productId } = req.params;
    const productIndex = config.loanProducts.findIndex(p => p.id === productId);

    if (productIndex === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    config.loanProducts[productIndex] = { ...config.loanProducts[productIndex], ...req.body };
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.json({ message: 'Product updated', product: config.loanProducts[productIndex] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ADD new loan product
router.post('/admin/loan-products', adminMiddleware, async (req, res) => {
  try {
    let config = await AppConfiguration.findOne({});
    if (!config) config = await AppConfiguration.create({});

    const newProduct = { ...req.body, id: `product-${Date.now()}` };
    config.loanProducts.push(newProduct);
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.status(201).json({ message: 'Product added', product: newProduct });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE loan product
router.delete('/admin/loan-products/:productId', adminMiddleware, async (req, res) => {
  try {
    const config = await AppConfiguration.findOne({});
    if (!config) return res.status(404).json({ error: 'Configuration not found' });

    config.loanProducts = config.loanProducts.filter(p => p.id !== req.params.productId);
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.json({ message: 'Product deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE KYC verification step
router.put('/admin/kyc-verifications/:verificationId', adminMiddleware, async (req, res) => {
  try {
    let config = await AppConfiguration.findOne({});
    if (!config) config = await AppConfiguration.create({});

    const { verificationId } = req.params;
    const index = config.kycVerifications.findIndex(v => v.id === verificationId);

    if (index === -1) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    config.kycVerifications[index] = { ...config.kycVerifications[index], ...req.body };
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.json({ message: 'Verification updated', verification: config.kycVerifications[index] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ADD new KYC verification step
router.post('/admin/kyc-verifications', adminMiddleware, async (req, res) => {
  try {
    let config = await AppConfiguration.findOne({});
    if (!config) config = await AppConfiguration.create({});

    const newVerification = { ...req.body, id: `kyc-${Date.now()}` };
    config.kycVerifications.push(newVerification);
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.status(201).json({ message: 'Verification added', verification: newVerification });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE KYC verification step
router.delete('/admin/kyc-verifications/:verificationId', adminMiddleware, async (req, res) => {
  try {
    const config = await AppConfiguration.findOne({});
    if (!config) return res.status(404).json({ error: 'Configuration not found' });

    config.kycVerifications = config.kycVerifications.filter(v => v.id !== req.params.verificationId);
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.json({ message: 'Verification deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE provider configuration
router.put('/admin/providers', adminMiddleware, async (req, res) => {
  try {
    let config = await AppConfiguration.findOne({});
    if (!config) config = await AppConfiguration.create({});

    config.providers = { ...config.providers, ...req.body };
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.json({ message: 'Providers updated', providers: config.providers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE UI configuration
router.put('/admin/ui-config', adminMiddleware, async (req, res) => {
  try {
    let config = await AppConfiguration.findOne({});
    if (!config) config = await AppConfiguration.create({});

    config.uiConfig = { ...config.uiConfig, ...req.body };
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.json({ message: 'UI configuration updated', uiConfig: config.uiConfig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE feature flags
router.put('/admin/features', adminMiddleware, async (req, res) => {
  try {
    let config = await AppConfiguration.findOne({});
    if (!config) config = await AppConfiguration.create({});

    config.features = { ...config.features, ...req.body };
    config.version += 1;
    config.updatedBy = req.user.email;
    await config.save();

    res.json({ message: 'Features updated', features: config.features });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET configuration version (for cache busting)
router.get('/admin/version', adminMiddleware, async (req, res) => {
  try {
    const config = await AppConfiguration.findOne({});
    res.json({ version: config?.version || 0, updatedAt: config?.updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
