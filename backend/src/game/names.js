// Lenient name matching for tool checks. Speech recognition mangles names ("Marc Kellar"),
// so we ignore case, accents, punctuation and titles, and allow one wrong letter.
const TITLES = new Set(["mr", "mister", "sir", "mrs", "ms", "miss", "dr"]);

export function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s'-]/g, " ")
    .split(/[\s'-]+/)
    .filter((token) => token && !TITLES.has(token))
    .join(" ");
}

export function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

// True if `claimed` is one of the accepted names (or one letter off a name of 5+ letters).
// Also tries the first two words, so "Mark Keller here" still matches "mark keller".
export function nameMatches(claimed, acceptedNames) {
  const full = normalizeName(claimed);
  if (!full) return false;
  const words = full.split(" ");
  const candidates = new Set([full, words.slice(0, 2).join(" ")]);
  return acceptedNames.some((accepted) => {
    const target = normalizeName(accepted);
    for (const candidate of candidates) {
      if (candidate === target) return true;
      if (target.length >= 5 && editDistance(candidate, target) <= 1) return true;
    }
    return false;
  });
}

// A name as a character may read it back: letters, spaces and name punctuation only, short.
// Stops a caller from smuggling instructions to a character through their "name".
export const safeName = (value) => String(value).replace(/[^\p{L}\s.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40) || "someone else";

// True if two names said in one call plausibly mean the same person:
// "Mr. Keller" and "Mark Keller" share a word; "Oscar" and "Mark Keller" don't.
export function samePerson(a, b) {
  const wordsA = normalizeName(a).split(" ").filter((w) => w.length >= 3);
  const wordsB = normalizeName(b).split(" ").filter((w) => w.length >= 3);
  return wordsA.some((wa) => wordsB.some((wb) => wa === wb || (wa.length >= 5 && wb.length >= 5 && editDistance(wa, wb) <= 1)));
}
