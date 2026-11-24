/* Cryptographically secure identifiers. QR tokens carry 128 bits of entropy and
   never contain participant data. */

const HEX = "0123456789abcdef";

function randomBytes(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function secureToken() {
  return Array.from(randomBytes(16), (b) => HEX[b >> 4] + HEX[b & 15]).join("");
}

export function newTransactionId() {
  return crypto.randomUUID();
}

export function newEventId() {
  return "ev_" + crypto.randomUUID();
}

export function newParticipantId(prefix = "SP") {
  const bytes = randomBytes(3);
  const body = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${prefix}-${body}`;
}

export function isWellFormedToken(value) {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}