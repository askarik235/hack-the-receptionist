// Caller ID spoofing (Level 4 on). NIGHTJAR's "caller ID kit" lets the player choose the number
// the person they call sees. The server stores that number on the call, tells the character
// what their screen shows, and checks it where it matters (e.g. "urgent payments only from
// the CEO's own mobile"), so no amount of talking can fake it.
import { formatNumber } from "../lib/phoneNumbers.js";

// The kit arrives with the first level that uses it, once that level is unlocked.
export function callerIdKitUnlocked(content, clearedLevels) {
  const cleared = new Set(clearedLevels);
  return content.levels.some((level) => level.callerId && (level.level === 1 || cleared.has(level.level - 1)));
}

// What the character's phone screen shows for this call.
export function callerIdLabel(content, callerId) {
  if (!callerId) return "Unknown number (no caller ID).";
  const person = content.staff.find((p) => p.phone === callerId);
  if (person) return `${person.name}, ${formatNumber(callerId)} (saved in your contacts).`;
  return `${formatNumber(callerId)} (not in your contacts).`;
}

// True if the call shows the number of the person the level's caller ID check trusts.
export function showsTrustedNumber(content, level, callerId) {
  const trusted = level.callerId && content.staffById.get(level.callerId.trustedStaffId);
  return Boolean(trusted?.phone) && trusted.phone === callerId;
}

// Some characters only pick up for one person (Emma, on holiday, only answers the CEO's
// mobile). Every other caller hears that the person is unavailable, and no call starts.
export function ignoresCaller(content, level, callerId) {
  return Boolean(level.callerId?.answersOnlyTrusted) && !showsTrustedNumber(content, level, callerId);
}
