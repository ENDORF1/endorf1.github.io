// Compatible with the previous admin: SHA-256 password hash in `_pw_hash`,
// AES-GCM token in `gh_token_enc` as "b64(iv):b64(ciphertext)", key from PBKDF2.

export const DEFAULT_PW_HASH = 'aaffebecec560fec66e75f24062224ffa4e07696d2ae9a1fee3707c3f8fd9373';
const SALT = 'gh-token-salt-v1';
const ITERATIONS = 200000;

const enc = new TextEncoder();

function b64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function keyFrom(password) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptToken(token, password) {
  const key = await keyFrom(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  return `${b64(iv)}:${b64(ct)}`;
}

export async function decryptToken(stored, password) {
  if (!stored || !stored.includes(':')) return null;
  const [ivB64, ctB64] = stored.split(':');
  const key = await keyFrom(password);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(ctB64));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export function passwordHash() {
  return localStorage.getItem('_pw_hash') || DEFAULT_PW_HASH;
}

export async function checkPassword(pw) {
  return (await sha256Hex(pw)) === passwordHash();
}

/** Changes the password and re-encrypts the stored token with it. */
export async function changePassword(oldPw, newPw) {
  if (!(await checkPassword(oldPw))) throw new Error('当前密码不正确');
  const stored = localStorage.getItem('gh_token_enc');
  let token = null;
  if (stored) token = await decryptToken(stored, oldPw);
  localStorage.setItem('_pw_hash', await sha256Hex(newPw));
  if (token) localStorage.setItem('gh_token_enc', await encryptToken(token, newPw));
}

export async function saveToken(token, password) {
  if (!token) {
    localStorage.removeItem('gh_token_enc');
    return;
  }
  localStorage.setItem('gh_token_enc', await encryptToken(token, password));
}

export async function loadToken(password) {
  const stored = localStorage.getItem('gh_token_enc');
  if (stored) return decryptToken(stored, password);
  const legacy = localStorage.getItem('gh_token');
  return legacy || null;
}

export async function gitBlobSha(bytes) {
  const header = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header, 0);
  all.set(bytes, header.length);
  const buf = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export { b64 as bytesToBase64, unb64 as base64ToBytes };
