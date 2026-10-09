// Protections that apply to every request.

// 1. Operator injection. A client that sends {"email": {"$gt": ""}} instead of a string can turn a lookup into "match anyone".
//    Keys that start with "$", or that contain a dot, have no business in our JSON, so they are removed before any route sees them.
function clean(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) { value.forEach((v, i) => { value[i] = clean(v, depth + 1); }); return value; }
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) delete value[key];
    else value[key] = clean(value[key], depth + 1);
  }
  return value;
}
export function sanitizeInput(req, res, next) {
  if (req.body) clean(req.body);
  if (req.query) clean(req.query);
  if (req.params) clean(req.params);
  next();
}

// 2. Answers that hold personal or account data must not be kept by a browser or a proxy. A route that wants caching sets its own header.
export function noStoreApi(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

// 3. Many routes answer a failure with the raw error text (a database error names collections and fields). Whatever route
//    sends it, an unexpected-error (500) answer is replaced here with a plain message and a reference; the real text goes to the log.
export function maskServerErrors(req, res, next) {
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode === 500 && body && typeof body === 'object' && typeof body.error === 'string' && !body.requestId) {
      console.error(JSON.stringify({ level: 'error', msg: 'server error answer', id: req.id, method: req.method, path: String(req.originalUrl || '').split('?')[0], status: res.statusCode, error: body.error.slice(0, 300) }));
      return json({ error: 'Something went wrong on our side. Please try again. If it keeps happening, quote this reference to support.', requestId: req.id || '' });
    }
    return json(body);
  };
  next();
}

// 4. Errors. The person gets a plain message and a reference; the detail goes to the log with the same reference. Without this a
//    database or code error would show its raw text (collection names, field names) to whoever caused it.
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  const id = req.id || '';
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request could not be read. It must be valid JSON.', requestId: id });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.', requestId: id });
  const status = Number(err?.status || err?.statusCode) >= 400 && Number(err.status || err.statusCode) < 600 ? Number(err.status || err.statusCode) : 500;
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled error', id, path: String(req.originalUrl || '').split('?')[0], error: String(err?.message || err).slice(0, 300), stack: process.env.NODE_ENV === 'production' ? undefined : String(err?.stack || '').split('\n').slice(0, 4).join(' | ') }));
  if (status < 500) return res.status(status).json({ error: err.message || 'Request refused', requestId: id });
  res.status(500).json({ error: 'Something went wrong on our side. Please try again. If it keeps happening, quote this reference to support.', requestId: id });
}
