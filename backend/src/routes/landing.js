import express from 'express';
import { getConfigObj, findPage, renderPage, renderIndex, sitemap } from '../services/landingPages.js';

// The public loan pages, the site map and robots.txt. Nothing is served until the company switches the website pages on.
const router = express.Router();
const baseOf = (req, config) => config.baseUrl || `${req.protocol}://${req.get('host')}`;
const html = (res, body) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=300'); res.send(body); };

router.get('/loan', (req, res, next) => {
  const config = getConfigObj();
  if (!config.enabled) return next();
  html(res, renderIndex({ config }, baseOf(req, config)));
});

router.get('/loan/:slug', (req, res, next) => {
  const found = findPage(String(req.params.slug).toLowerCase());
  if (!found) return next();
  html(res, renderPage(found, baseOf(req, found.config)));
});

router.get('/sitemap.xml', (req, res, next) => {
  const config = getConfigObj();
  if (!config.enabled) return next();
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(sitemap(config, baseOf(req, config)));
});

router.get('/robots.txt', (req, res, next) => {
  const config = getConfigObj();
  if (!config.enabled) return next();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`User-agent: *\nAllow: /loan\nDisallow: /api/\nSitemap: ${baseOf(req, config)}/sitemap.xml\n`);
});

export default router;
