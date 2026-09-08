import crypto from 'node:crypto';

/**
 * Envelope encryption for customer-supplied API keys.
 *
 * AES-256-GCM. The ciphertext carries its own IV and auth tag, so a row is
 * self-describing and a rotated key can be detected (decrypt throws) rather
 * than silently returning garbage.
 *
 * Format:  v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 *
 * APP_ENCRYPTION_KEY must be 32 bytes, base64 or hex. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

const VERSION = 'v1';

function masterKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'APP_ENCRYPTION_KEY is not set. Generate one with '
      + '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` '
      + 'and add it to .env.local and Vercel before saving API keys.',
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error(`APP_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(blob: string): string {
  const [version, ivB64, tagB64, ctB64] = blob.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Stored secret is not in the expected format.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/** True when APP_ENCRYPTION_KEY is present and usable — checked before offering BYO keys in the UI. */
export function encryptionReady(): boolean {
  try { masterKey(); return true; } catch { return false; }
}

/**
 * What the browser is allowed to see: enough to recognise which key is saved,
 * never enough to use it.
 */
export function maskSecret(plain: string): string {
  const s = plain.trim();
  if (s.length <= 10) return '••••••••';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
