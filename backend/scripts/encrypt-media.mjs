// Seals the selfies and Aadhaar card photos that were stored before DATA_ENCRYPTION_KEY was set.
//
//   node scripts/encrypt-media.mjs            shows how many files would be sealed (changes nothing)
//   node scripts/encrypt-media.mjs --apply    seals them
//
// Needs the same database address and DATA_ENCRYPTION_KEY as the server (MONGO_URI or MONGODB_URI in the environment).
// Safe to run again: files that are already sealed are skipped. TAKE A DATABASE BACKUP FIRST, and keep the key safe: without it
// the sealed files cannot be read.
import mongoose from 'mongoose';
import { encryptBuffer, isEncrypted, encryptionOn } from '../src/services/dataCrypto.js';

const apply = process.argv.includes('--apply');
const url = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set MONGO_URI (the database address) first.'); process.exit(1); }
if (!encryptionOn()) { console.error('Set DATA_ENCRYPTION_KEY first (32 random bytes: 64 hex characters, or base64).'); process.exit(1); }

await mongoose.connect(url);
const col = mongoose.connection.collection('kycmedias');
let seen = 0, sealed = 0, already = 0;
for await (const doc of col.find({}, { projection: { data: 1 } })) {
  seen++;
  const raw = doc.data?.buffer ? Buffer.from(doc.data.buffer) : Buffer.isBuffer(doc.data) ? doc.data : null;
  if (!raw) continue;
  if (isEncrypted(raw)) { already++; continue; }
  sealed++;
  if (apply) await col.updateOne({ _id: doc._id }, { $set: { data: encryptBuffer(raw) } });
}
console.log(`${seen} files found: ${already} already sealed, ${sealed} ${apply ? 'sealed now' : 'to seal (run again with --apply)'}`);
await mongoose.disconnect();
