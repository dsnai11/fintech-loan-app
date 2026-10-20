import fs from 'fs';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';
import jpeg from 'jpeg-js';

// A face engine that runs on our own server, with no outside account. It uses the open-source "Human" library (models are
// shipped inside the package) on the WebAssembly backend, so it needs no native add-ons.
//
// It does three things with a picture: finds the faces, makes a numeric fingerprint of each face (so two faces can be compared),
// and gives two "is this a real, live person rather than a photo of a photo or a screen" scores from a single image
// (anti-spoof and liveness). This is weaker than a certified face-matching service, so its marks are conservative and anything in doubt
// goes to a person. The marks need to be tuned on real customer photos by risk and compliance.

const require = createRequire(import.meta.url);
const MAX_SIDE = 1600;

let humanPromise = null;
let chain = Promise.resolve();

// The folder a package is installed in. (These packages do not let you ask for their package.json, so walk up from the main file.)
export function packageRoot(name) {
  let dir = path.dirname(require.resolve(name));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`${name} is not installed`);
    dir = up;
  }
  return dir;
}
function locations() {
  const base = packageRoot('@vladmandic/human');
  const wasm = packageRoot('@tensorflow/tfjs-backend-wasm');
  return { base, models: path.join(base, 'models'), wasm: path.join(wasm, 'dist') + path.sep };
}

// The models are served to the library from a tiny web server that only listens on this machine, because the library
// loads model files over HTTP. It serves nothing but the model files.
async function startModelServer(dir) {
  const server = http.createServer((req, res) => {
    const name = path.basename(String(req.url || '').split('?')[0]);
    if (!/^[A-Za-z0-9_.-]+\.(json|bin)$/.test(name)) { res.statusCode = 404; return res.end(); }
    fs.readFile(path.join(dir, name), (e, data) => {
      if (e) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.end(data);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref();
  return server;
}

async function init() {
  const { base, models, wasm } = locations();
  const { Human } = require(path.join(base, 'dist', 'human.node-wasm.js'));
  const server = await startModelServer(models);
  const human = new Human({
    backend: 'wasm', wasmPath: wasm, modelBasePath: `http://127.0.0.1:${server.address().port}/`, debug: false,
    face: { enabled: true, detector: { rotation: false, maxDetected: 6, minConfidence: 0.25 }, mesh: { enabled: true }, iris: { enabled: false }, description: { enabled: true }, emotion: { enabled: false }, antispoof: { enabled: true }, liveness: { enabled: true } },
    body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false }, filter: { enabled: false },
  });
  await human.load();
  return human;
}
const getHuman = () => (humanPromise ||= init().catch(e => { humanPromise = null; throw e; }));

// One picture at a time: the engine holds one model in memory, and two requests at once would only slow each other down
const queued = work => { const run = chain.then(work, work); chain = run.catch(() => {}); return run; };

// Reads a JPEG into RGB, shrinking it when it is bigger than needed (a phone photo can be 12 megapixels)
export function decode(buffer) {
  const img = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 600 });
  const { width, height, data } = img;
  const longest = Math.max(width, height);
  if (longest <= MAX_SIDE) return { width, height, rgb: Buffer.from(data.buffer, data.byteOffset, data.length) };
  const f = MAX_SIDE / longest;
  const w = Math.max(1, Math.round(width * f)), h = Math.max(1, Math.round(height * f));
  const block = Math.max(1, Math.ceil(1 / f));
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / f));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / f));
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < block && sy + dy < height; dy++) for (let dx = 0; dx < block && sx + dx < width; dx++) { const i = ((sy + dy) * width + (sx + dx)) * 3; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      const o = (y * w + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { width: w, height: h, rgb: out };
}

// Every face in the picture, biggest first: { score, box: [x, y, w, h], size, real, live, embedding }
export function analyse(buffer) {
  return queued(async () => {
    const human = await getHuman();
    const img = decode(buffer);
    const tensor = human.tf.tensor3d(img.rgb, [img.height, img.width, 3], 'int32');
    try {
      const r = await human.detect(tensor);
      return r.face.map(f => ({ score: f.score, box: f.box.map(Math.round), size: Math.round(Math.min(f.box[2], f.box[3])), real: f.real ?? null, live: f.live ?? null, embedding: f.embedding }))
        .sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
    } finally { tensor.dispose(); }
  });
}

export async function similarity(a, b) {
  const human = await getHuman();
  return Math.round(human.match.similarity(a, b) * 1000) / 10; // 0 to 100
}

// How big a face has to be (the shorter side, in pixels) to give a fingerprint worth trusting
export const MIN_SELFIE_FACE = 90;
export const MIN_CARD_FACE = 40;

// Compares a selfie with an Aadhaar card photo.
// Returns { ok: true, similarity, liveness: { real, live }, faces: { selfie, card } }
//     or { ok: false, reason: 'no_face_in_selfie' | 'selfie_face_small' | 'several_faces_in_selfie' | 'no_face_on_card' | 'card_face_small' | 'error', detail }
export async function compareLocal(selfieBytes, cardBytes) {
  let selfie, card;
  try { [selfie, card] = [await analyse(selfieBytes), await analyse(cardBytes)]; } catch (e) { return { ok: false, reason: 'error', detail: String(e.message).slice(0, 160) }; }
  const mine = selfie.filter(f => f.score >= 0.5);
  if (!mine.length) return { ok: false, reason: 'no_face_in_selfie', detail: 'No face found in the selfie' };
  // Another person in the picture is a reason to ask again: we could not tell whose face to use
  if (mine.length > 1 && mine[1].size >= 0.5 * mine[0].size) return { ok: false, reason: 'several_faces_in_selfie', detail: `${mine.length} faces found in the selfie` };
  if (mine[0].size < MIN_SELFIE_FACE) return { ok: false, reason: 'selfie_face_small', detail: `The face is only ${mine[0].size} pixels wide` };
  const onCard = card.filter(f => f.score >= 0.4);
  if (!onCard.length) return { ok: false, reason: 'no_face_on_card', detail: 'No face found on the card photo' };
  const big = onCard.filter(f => f.size >= MIN_CARD_FACE);
  if (!big.length) return { ok: false, reason: 'card_face_small', detail: `The face on the card is only ${onCard[0].size} pixels wide` };
  let best = 0;
  for (const f of big) best = Math.max(best, await similarity(mine[0].embedding, f.embedding));
  return { ok: true, similarity: best, liveness: { real: mine[0].real, live: mine[0].live }, faces: { selfie: mine.length, card: onCard.length } };
}

export const available = () => { try { locations(); return true; } catch { return false; } };

export default { packageRoot, analyse, similarity, compareLocal, decode, available, MIN_SELFIE_FACE, MIN_CARD_FACE };
