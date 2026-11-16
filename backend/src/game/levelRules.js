// The "facts" lock of each level: who the code is meant for, and what they must say.
// Checked on the server when a character calls request_code, so the model's mood alone
// can't hand out a code.
import { editDistance, nameMatches } from "./names.js";
import { codesMatch } from "./codes.js";

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

// A payee the caller actually gave: something address-like (any wallet will do), not a
// placeholder the model filled in because it didn't ask ("unknown", "the wallet", "n/a").
const PLACEHOLDER_PAYEE = /\b(unknown|not (given|provided|said|known)|none|n\/?a|tbd|no address)\b/i;
export function looksLikeAddress(payee) {
  if (typeof payee !== "string" || PLACEHOLDER_PAYEE.test(payee)) return false;
  const lettersAndDigits = payee.replace(/[^a-z0-9]/gi, "");
  const words = payee.toLowerCase().replace(/['’]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const vague = words.length > 0 && words.every((w) => ["the", "a", "his", "her", "their", "client", "clients", "crypto", "wallet", "address", "account", "seller", "sellers", "usual", "same", "one"].includes(w));
  return lettersAndDigits.length >= 6 && !vague;
}

// Names that count as "the right person to ask" at this level (used for the trust bonus and the debrief).
export function identityNames(level) {
  const rc = level.requestCode;
  if (rc.check === "host_with_reason") return rc.hosts.flatMap((h) => h.names);
  if (rc.check === "employee_reset") return rc.accounts.flatMap((a) => a.names);
  return rc.acceptedNames ?? []; // investigator_evidence: any outsider's name will do
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
// { approved: true } or { approved: false, message }. `pending: true` means "not yet, ask for
// what's missing": it doesn't count as a refusal.
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
  // this week's approval word, only for the confidential deal it is meant for, and only once
  // she has asked where the money goes (any wallet address will do, but not a placeholder).
  ceo_payment: (rc, { claimed_name, reason, approval_word, payee, caller_id }, { staffById }) => {
    if (!nameMatches(claimed_name, rc.acceptedNames)) return refuseUnknown(rc, claimed_name);
    if (!caller_id || caller_id !== staffById.get(rc.callerStaffId)?.phone) return { approved: false, message: rc.wrongCaller };
    if (!rc.approvalWords.includes(plainWord(approval_word))) return { approved: false, message: rc.wrongWord };
    if (!mentionsAny(reason, rc.reasonKeywords)) return { approved: false, message: rc.wrongReason };
    if (!looksLikeAddress(payee)) return { approved: false, pending: true, message: rc.missingPayee };
    return { approved: true };
  },

  // Level 5: the caller poses as the police detective the CEO is waiting for. Staff names are
  // refused (nobody at the company gets the folder this week). The proof is the transfer
  // reference of the Level 4 payment: per player, so only someone who made that payment (or the
  // bank and the police) can know it. `expected_reference` is worked out by the tool router.
  // A wrong reference or reason can be a slip of the tongue, so those may be retried (`retry`);
  // a staff or attacker name can't. `why` is logged so a refusal can be explained later.
  investigator_evidence: (rc, { claimed_name, reason, transfer_reference, expected_reference }) => {
    const special = rc.refusalsFor?.find((r) => nameMatches(claimed_name, r.names));
    if (special) return { approved: false, why: "name", message: special.message };
    if (!transfer_reference) return { approved: false, pending: true, message: rc.missingReference };
    if (!referenceMatches(expected_reference, transfer_reference)) return { approved: false, retry: true, why: "reference", message: rc.wrongReference };
    if (!mentionsAny(reason, rc.reasonKeywords)) return { approved: false, retry: true, why: "reason", message: rc.wrongReason };
    return { approved: true };
  },
};

// The spoken reference matches if it's exact, or has the right four digits and the word is
// one letter off (speech recognition hears "Perl" for "Pearl").
export function referenceMatches(expected, spoken) {
  if (!expected) return false;
  const heard = spokenCode(spoken);
  if (codesMatch(expected, heard)) return true;
  const [word, digits] = expected.split("-");
  const [heardWord, heardDigits] = heard.split("-");
  return Boolean(heardWord) && heardDigits === digits && word.length >= 4 && editDistance(heardWord, word) <= 1;
}

// A code as the model may pass it after hearing it: "Pearl 4471", "pearl, four four seven one",
// "pearl forty-four seventy-one", "pearl double four seven one", "reference PEARL-4-4-7-1"
// -> "PEARL-4471". The first word followed by exactly four digits wins.
const DIGIT_WORDS = { zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const TEENS = { ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19" };
const TENS = { twenty: "2", thirty: "3", forty: "4", fourty: "4", fifty: "5", sixty: "6", seventy: "7", eighty: "8", ninety: "9" };
const REPEATS = { double: 2, triple: 3 };

// Said between the word and the digits; ignored ("topaz dash 8150").
const FILLERS = new Set(["dash", "hyphen", "minus"]);

// Spelled-out letters become one word: "t o p a z" -> "topaz" (two or more in a row).
function joinSpelled(words) {
  const out = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (/^[a-z]$/.test(w) && prev?.spelled) prev.text += w;
    else out.push({ text: w, spelled: /^[a-z]$/.test(w) });
  }
  return out.map((t) => t.text);
}

// Words to single digits: "forty four" -> 4 4, "forty" -> 4 0, "double four" -> 4 4.
function spokenTokens(value) {
  const words = joinSpelled(value.toLowerCase().match(/[a-z]+|\d/g) ?? [])
    .filter((w) => !FILLERS.has(w))
    .map((w) => DIGIT_WORDS[w] ?? w);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    if (TEENS[w]) out.push(...TEENS[w]);
    else if (TENS[w] && /^[1-9]$/.test(next ?? "")) out.push(TENS[w], next), i++;
    else if (TENS[w]) out.push(TENS[w], "0");
    else if (REPEATS[w] && /^\d$/.test(next ?? "")) out.push(...Array(REPEATS[w]).fill(next)), i++;
    else out.push(w);
  }
  return out;
}

export function spokenCode(value) {
  if (typeof value !== "string") return "";
  const tokens = spokenTokens(value);
  for (let i = 0; i < tokens.length; i++) {
    if (!/^[a-z]{3,10}$/.test(tokens[i])) continue;
    let j = i + 1;
    while (j < tokens.length && /^\d$/.test(tokens[j])) j++;
    if (j - i - 1 === 4) return `${tokens[i]}-${tokens.slice(i + 1, j).join("")}`.toUpperCase();
  }
  return "";
}
export const CHECK_TYPES = Object.keys(CHECKS);
