// Shared crypto helpers – used by the browser app AND the Node build/verify scripts.
// Only relies on globalThis.crypto (WebCrypto), TextEncoder/TextDecoder, btoa/atob.
//
// Model:
//   * Every step of a team's route has a 256-bit content key. The step's payload
//     (riddle text, image, ...) is AES-GCM encrypted with it.
//   * A "lock" guards the way to a step. It holds one slot per accepted answer.
//     slot = AES-GCM( PBKDF2(prevKeyHex + "|" + normalize(answer), salt), contentKey )
//   * Opening a lock = derive once from the typed answer, try every slot.

export const KDF_ITERATIONS = 100000;
export const SLOT_COUNT = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle() {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('WebCrypto unavailable (page must be served over https)');
  return s;
}

export function hasWebCrypto() {
  return !!(globalThis.crypto && globalThis.crypto.subtle);
}

/** Make typed answers comparable: case, accents, spaces, punctuation and a leading "the" don't matter. */
export function normalize(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// ---------- encoding helpers ----------

export function toB64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

// ---------- primitives ----------

export async function deriveWrapKey(prevKeyHex, answer, saltB64, iterations = KDF_ITERATIONS) {
  const material = await subtle().importKey(
    'raw',
    enc.encode(prevKeyHex + '|' + normalize(answer)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function importAesKey(raw) {
  return subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptBytes(key, box) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return new Uint8Array(pt);
}

export async function encryptJson(rawKey, obj) {
  return encryptBytes(await importAesKey(rawKey), enc.encode(JSON.stringify(obj)));
}

export async function decryptJson(rawKey, box) {
  const bytes = await decryptBytes(await importAesKey(rawKey), box);
  return JSON.parse(dec.decode(bytes));
}

export function encodeText(s) {
  return enc.encode(s);
}

export function decodeText(bytes) {
  return dec.decode(bytes);
}

// ---------- locks ----------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build-time: create a lock.
 * entries: [{ answer, secret: Uint8Array }] – each answer unlocks its own secret
 * (for real locks all secrets are the same content key; for the troll lock they differ).
 * The slot list is padded with random junk so the number of variants is not visible.
 */
export async function createLock(prevKeyHex, entries, { slotCount = SLOT_COUNT, iterations = KDF_ITERATIONS } = {}) {
  const salt = toB64(randomBytes(16));
  const seen = new Set();
  const slots = [];
  for (const { answer, secret } of entries) {
    const n = normalize(answer);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const wk = await deriveWrapKey(prevKeyHex, n, salt, iterations);
    slots.push(await encryptBytes(wk, secret));
  }
  if (slots.length > slotCount) {
    throw new Error(`Too many answer variants (${slots.length} > ${slotCount})`);
  }
  const lengths = slots.map((s) => fromB64(s.ct).length);
  while (slots.length < slotCount) {
    const len = lengths[Math.floor(Math.random() * lengths.length)] || 48;
    slots.push({ iv: toB64(randomBytes(12)), ct: toB64(randomBytes(len)) });
  }
  return { salt, slots: shuffle(slots) };
}

/** Runtime: try to open a lock. Returns the secret bytes or null. */
export async function openLock(lock, prevKeyHex, answer, iterations = KDF_ITERATIONS) {
  const n = normalize(answer);
  if (!n) return null;
  const wk = await deriveWrapKey(prevKeyHex, n, lock.salt, iterations);
  for (const slot of lock.slots) {
    try {
      return await decryptBytes(wk, slot);
    } catch {
      // wrong slot – keep trying
    }
  }
  return null;
}

/** Prefix used for the decoy ("troll") lock instead of a previous key. */
export const TROLL_PREFIX = 'troll';
