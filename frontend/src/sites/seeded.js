// Stable made-up numbers (connections, kudos, followers, suns) so a fake profile looks lived-in
// and never changes between visits: the same text always gives the same number in [min, max].
export function seeded(text, min, max) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return min + ((h >>> 0) % (max - min + 1));
}
