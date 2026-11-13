// The "facts" lock of each level: who the code is meant for, and what they must say.
// Checked on the server when a character calls request_code, so the model's mood alone
// can't hand out a code.
import { nameMatches } from "./names.js";

// True if the text contains any of the (lowercase) keywords, ignoring case and extra spaces.
// Very short plain words (up to 3 letters, like "em") must match a whole word, so "em"
// doesn't match "them" or "emergency".
export function mentionsAny(text, keywords) {
  if (typeof text !== "string") return false;
  const said = text.toLowerCase().replace(/\s+/g, " ");
  return keywords.some((k) => (/^[a-z]{1,3}$/.test(k) ? new RegExp(`\\b${k}\\b`).test(said) : said.includes(k)));
}

// "Saffron.", " SAFFRON " -> "saffron". Speech-to-text adds punctuation and capitals.
const plainWord = (value) => (typeof value === "string" ? value.toLowerCase().replace(/[^a-z]/g, "") : "");

// Names that count as "the right person to ask" at this level (used for the trust bonus and the debrief).
export function identityNames(level) {
  const rc = level.requestCode;
  if (rc.check === "host_with_reason") return rc.hosts.flatMap((h) => h.names);
  if (rc.check === "employee_reset") return rc.accounts.flatMap((a) => a.names);
  return rc.acceptedNames;
}

// "VL-0388", "vl 0388", "V L zero three eight eight" written as "VL0388" -> "0388".
// Only the four digits matter; speech-to-text mangles the letters and dashes.
export function employeeIdDigits(value) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 4 ? digits : null;
}

// A name whose special refusal applies (e.g. executives), or the default refusal.
const refuseUnknown = (rc, claimed_name) => {
  const special = rc.refusalsFor?.find((r) => nameMatches(claimed_name, r.names));
  return { approved: false, message: special?.message ?? rc.refusal };
};

// One check per level type: (requestCode rules, tool arguments, content) ->
// { approved: true } or { approved: false, message }.
export const CHECKS = {
  // Level 1: the caller must claim to be the target's manager (lenient spelling).
  manager_name: (rc, { claimed_name }) =>
    nameMatches(claimed_name, rc.acceptedNames) ? { approved: true } : { approved: false, message: rc.refusal },

  // Level 2: a real staff member who has guests booked, with a reason that matches that visit.
  host_with_reason: (rc, { claimed_name, reason }) => {
    const host = rc.hosts.find((h) => nameMatches(claimed_name, h.names));
    if (!host) return refuseUnknown(rc, claimed_name);
    if (!mentionsAny(reason, host.reasonKeywords)) return { approved: false, message: rc.wrongReason };
    return { approved: true };
  },

  // Level 3: a password reset for an account owner who gives the matching employee ID and
  // department. `staffById` supplies the real ID, so it lives in one place (staff.json).
  employee_reset: (rc, { claimed_name, employee_id, department }, { staffById }) => {
    const account = rc.accounts.find((a) => nameMatches(claimed_name, a.names));
    if (!account) return refuseUnknown(rc, claimed_name);
    const given = employeeIdDigits(employee_id);
    if (!given) return { approved: false, message: rc.missingId };
    if (given !== employeeIdDigits(staffById.get(account.staffId).employeeId)) return { approved: false, message: rc.wrongId };
    if (!mentionsAny(department, account.departments)) return { approved: false, message: rc.wrongDepartment };
    return { approved: true };
  },

  // Level 4: an urgent payment approved by the CEO. Only for him, only from his own mobile
  // (the caller ID the player set, stored on the call, never what the model says), only with
  // this week's approval word, and only for the confidential deal it is meant for.
  ceo_payment: (rc, { claimed_name, reason, approval_word, caller_id }, { staffById }) => {
    if (!nameMatches(claimed_name, rc.acceptedNames)) return refuseUnknown(rc, claimed_name);
    if (!caller_id || caller_id !== staffById.get(rc.callerStaffId)?.phone) return { approved: false, message: rc.wrongCaller };
    if (!rc.approvalWords.includes(plainWord(approval_word))) return { approved: false, message: rc.wrongWord };
    if (!mentionsAny(reason, rc.reasonKeywords)) return { approved: false, message: rc.wrongReason };
    return { approved: true };
  },
};
export const CHECK_TYPES = Object.keys(CHECKS);
