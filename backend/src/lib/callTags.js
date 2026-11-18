// Tags we attach to every Napster connection. Napster sends them back unchanged in each tool
// call's metadata, so a tool call can be tied to one of our calls. The signature binds the
// call ID to the player and level, so tags copied from one call don't validate for another
// player. It is keyed with TOOL_SECRET, so it adds nothing if that secret itself leaks.
import { createHmac, timingSafeEqual } from "node:crypto";

export const APP_TAG = "hack-the-receptionist";

const signature = (secret, callId, playerId, level) =>
  createHmac("sha256", secret).update(`call:${callId}:${playerId}:${level}`).digest("base64url").slice(0, 32);

export function buildCallTags(secret, { callId, playerId, level }) {
  return { app: APP_TAG, callId, level: String(level), sig: signature(secret, callId, playerId, level) };
}

// Returns { callId, level } if the tags are ours and correctly signed for this player.
export function verifyCallTags(secret, tags, playerId) {
  if (!tags || typeof tags !== "object") return null;
  const { callId, level, sig } = tags;
  if (typeof callId !== "string" || !/^[A-Za-z0-9_-]{8,40}$/.test(callId)) return null;
  if (typeof level !== "string" || !/^\d{1,2}$/.test(level) || typeof sig !== "string") return null;
  const expected = Buffer.from(signature(secret, callId, playerId, Number(level)));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { callId, level: Number(level) };
}
