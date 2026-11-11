// The "facts" lock of each level: who the code is meant for, and what they must say.
// Checked on the server when a character calls request_code, so the model's mood alone
// can't hand out a code.
import { nameMatches } from "./names.js";

// True if the text contains any of the (lowercase) keywords, ignoring case and extra spaces.
export function mentionsAny(text, keywords) {
  if (typeof text !== "string") return false;
  const said = text.toLowerCase().replace(/\s+/g, " ");
  return keywords.some((k) => said.includes(k));
}

// Names that count as "the right person to ask" at this level (used for the trust bonus and the debrief).
export function identityNames(level) {
  const rc = level.requestCode;
  if (rc.check === "host_with_reason") return rc.hosts.flatMap((h) => h.names);
  return rc.acceptedNames;
}

// One check per level type. Each returns { approved: true } or { approved: false, message }.
export const CHECKS = {
  // Level 1: the caller must claim to be the target's manager (lenient spelling).
  manager_name: (rc, { claimed_name }) =>
    nameMatches(claimed_name, rc.acceptedNames) ? { approved: true } : { approved: false, message: rc.refusal },

  // Level 2: a real staff member who has guests booked, with a reason that matches that visit.
  host_with_reason: (rc, { claimed_name, reason }) => {
    const host = rc.hosts.find((h) => nameMatches(claimed_name, h.names));
    if (!host) {
      const special = rc.refusalsFor?.find((r) => nameMatches(claimed_name, r.names));
      return { approved: false, message: special?.message ?? rc.refusal };
    }
    if (!mentionsAny(reason, host.reasonKeywords)) return { approved: false, message: rc.wrongReason };
    return { approved: true };
  },
};
export const CHECK_TYPES = Object.keys(CHECKS);
