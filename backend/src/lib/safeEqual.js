// Constant-time string comparison. Both sides are hashed first, so their lengths always match
// and the comparison time says nothing about the expected value.
import { createHash, timingSafeEqual } from "node:crypto";

export function safeEqual(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
