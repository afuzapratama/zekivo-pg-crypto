import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
function encryptionKey(hex: string) {
  if (!/^[a-f0-9]{64}$/i.test(hex))
    throw new Error("Webhook encryption key must be 32 bytes hex");
  return Buffer.from(hex, "hex");
}
export function encryptSecret(secret: string, key: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}
export function decryptSecret(envelope: string, key: string) {
  const [version, iv, tag, ciphertext] = envelope.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("Invalid encrypted webhook secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(key),
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
export function signWebhook(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  return {
    timestamp: String(timestamp),
    signature: createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex"),
  };
}
export function verifyWebhook(
  body: string,
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  now = Math.floor(Date.now() / 1000),
) {
  if (
    !timestamp ||
    !/^\d{1,12}$/.test(timestamp) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    Math.abs(now - Number(timestamp)) > 300
  )
    return false;
  const expected = signWebhook(body, secret, Number(timestamp)).signature;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );
}
