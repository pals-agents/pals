// Small crypto helpers on node:crypto only (no extra deps).
import crypto from 'node:crypto';
import {cfg} from './config.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58MAP = Object.fromEntries([...B58].map((c, i) => [c, i]));

export function b58decode(str) {
  if (typeof str !== 'string' || !str.length) throw new Error('empty base58');
  let bytes = [0];
  for (const ch of str) {
    const v = B58MAP[ch];
    if (v === undefined) throw new Error('invalid base58');
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of str) { if (ch === '1') bytes.push(0); else break; }
  return Buffer.from(bytes.reverse());
}
export function b58encode(buf) {
  const bytes = [...buf];
  let digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const b of bytes) { if (b === 0) out += '1'; else break; }
  return out + digits.reverse().map(d => B58[d]).join('');
}
export const isWallet = w => typeof w === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w) && (() => { try { return b58decode(w).length === 32; } catch { return false; } })();

// Verify an ed25519 signature from a Solana wallet (Phantom/Solflare signMessage).
export function verifyWalletSignature(wallet, message, signatureB64) {
  const pub = b58decode(wallet);
  if (pub.length !== 32) return false;
  const key = crypto.createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url')}, format: 'jwk'});
  const sig = Buffer.from(signatureB64, 'base64');
  if (sig.length !== 64) return false;
  return crypto.verify(null, Buffer.from(message, 'utf8'), key, sig);
}

// Signed session tokens (HMAC-SHA256), stored in an HttpOnly cookie.
export function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest('base64url');
  return body + '.' + mac;
}
export function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}

// AES-256-GCM for memories at rest. Without a key (local dev) text is stored as-is.
export function seal(text) {
  if (!cfg.memoryKey) return 'plain:' + text;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(cfg.memoryKey, 'hex'), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return 'gcm:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function open(blob) {
  if (blob.startsWith('plain:')) return blob.slice(6);
  if (!blob.startsWith('gcm:') || !cfg.memoryKey) return '[encrypted]';
  const raw = Buffer.from(blob.slice(4), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cfg.memoryKey, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
export const randomId = (p = '') => p + crypto.randomBytes(9).toString('base64url');
export const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');
