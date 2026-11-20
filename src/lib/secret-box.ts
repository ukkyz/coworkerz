/**
 * Envelope encryption for provider credentials at rest.
 *
 * A database file is the easiest artefact to copy out of a deployment (it is often a
 * volume, a backup or a support bundle). Phase 0 therefore stops storing a usable key
 * there: the secret is sealed with AES-256-GCM under a master key that lives in the
 * environment or a KMS, and the row keeps only a `v1:<iv>:<tag>:<ciphertext>` envelope
 * plus a 4-character hint for the operator.
 *
 * The master key must not live in the same place as the database. Rotating it means
 * re-sealing: decrypt with the old key, seal with the new one.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SECRET_KEY_ENV = "CW_SECRET_KEY";
export const SECRET_KEY_MIN_LENGTH = 32;

/** Identifiable prefix so a stored value is never mistaken for plaintext. */
const ENVELOPE_PREFIX = "v1";

export type SealResult = { sealed: string; last4: string };

export function masterKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const value = env[SECRET_KEY_ENV];
  if (typeof value !== "string" || value.length < SECRET_KEY_MIN_LENGTH) return null;
  // Accept any high-entropy string; derive a fixed 32-byte key so the operator is not
  // forced to produce exactly 32 bytes of base64 by hand.
  return createHash("sha256").update(value).digest();
}

export function isSealed(value: string): boolean {
  return value.startsWith(`${ENVELOPE_PREFIX}:`);
}

/** Last four characters, for UI confirmation only. Never enough to reconstruct a key. */
export function hint(plaintext: string): string {
  return plaintext.length <= 4 ? "" : plaintext.slice(-4);
}

export function seal(plaintext: string, env: NodeJS.ProcessEnv = process.env): SealResult {
  const key = masterKey(env);
  if (!key) {
    throw new Error(
      `${SECRET_KEY_ENV} is not configured (needs at least ${SECRET_KEY_MIN_LENGTH} characters). ` +
        "Refusing to store a provider credential in plaintext.",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    sealed: [ENVELOPE_PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":"),
    last4: hint(plaintext),
  };
}

/** Returns null when the envelope cannot be authenticated with the current master key. */
export function unseal(envelope: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isSealed(envelope)) return null;
  const key = masterKey(env);
  if (!key) return null;
  const parts = envelope.split(":");
  if (parts.length !== 4) return null;
  const [, ivPart, tagPart, dataPart] = parts;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong master key or tampered ciphertext. Treat as absent, never as valid.
    return null;
  }
}
