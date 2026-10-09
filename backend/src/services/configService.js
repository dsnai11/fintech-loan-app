import Config from '../models/Config.js';

// In-memory cache so every request doesn't hit MongoDB
const cache = {};

export async function loadAllConfig(quiet = false) {
  try {
    const docs = await Config.find({});
    docs.forEach(d => { cache[d.key] = d.value; });
    if (!quiet) console.log(`Config loaded: ${docs.length} keys`);
  } catch (e) {
    console.error('Config load error:', e.message);
  }
}

// Get value: DB cache > process.env > defaultVal
export function getConfig(key, defaultVal = '') {
  return cache[key] ?? process.env[key] ?? defaultVal;
}

// Save one key
export async function setConfig(key, value, { isSecret = false, group = 'general', updatedBy = 'admin' } = {}) {
  cache[key] = value;
  await Config.findOneAndUpdate(
    { key },
    { value, isSecret, group, updatedBy },
    { upsert: true, new: true }
  );
}

// Save many keys at once: { KEY: { value, isSecret, group } }
export async function setManyConfig(obj, updatedBy = 'admin') {
  const ops = Object.entries(obj).map(([key, v]) => {
    const value = typeof v === 'string' ? v : v.value ?? '';
    const isSecret = typeof v === 'object' ? (v.isSecret ?? false) : false;
    const group = typeof v === 'object' ? (v.group ?? 'general') : 'general';
    cache[key] = value;
    return {
      updateOne: {
        filter: { key },
        update: { $set: { value, isSecret, group, updatedBy } },
        upsert: true,
      },
    };
  });
  if (ops.length) await Config.bulkWrite(ops);
}

// Get all config (mask secrets)
export async function getAllConfig(maskSecrets = true) {
  const docs = await Config.find({}).sort({ group: 1, key: 1 });
  return docs.map(d => ({
    key: d.key,
    value: (maskSecrets && d.isSecret && d.value)
      ? d.value.slice(0, 4) + '•'.repeat(Math.max(0, d.value.length - 4))
      : d.value,
    isSecret: d.isSecret,
    group: d.group,
    updatedAt: d.updatedAt,
    updatedBy: d.updatedBy,
    isEmpty: !d.value,
  }));
}

export default { loadAllConfig, getConfig, setConfig, setManyConfig, getAllConfig };
