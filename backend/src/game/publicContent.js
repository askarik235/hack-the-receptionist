// What the browser is allowed to see. Built from an explicit allow-list so that prompts,
// private facts, code words, accepted names and agent settings can never leak by accident.
export const BOARD_SIZE = 5;

export function publicContent(content, clearedLevels) {
  const cleared = new Set(clearedLevels);
  const unlocked = (n) => n === 1 || cleared.has(n - 1);

  const targets = [];
  for (let n = 1; n <= BOARD_SIZE; n++) {
    const level = content.levelByNumber.get(n);
    if (!level || !unlocked(n)) {
      // Unlocked but not built yet (during development): don't promise "clear the last one".
      targets.push({ level: n, status: !level && unlocked(n) ? "soon" : "locked" });
      continue;
    }
    const person = content.staffById.get(level.targetId);
    targets.push({
      level: n,
      status: cleared.has(n) ? "cleared" : "open",
      title: level.title,
      name: person.name,
      role: person.role,
    });
  }

  const mail = content.levels
    .filter((level) => unlocked(level.level))
    .map((level) => ({
      id: `briefing-${level.level}`,
      level: level.level,
      from: level.briefing.from,
      subject: level.briefing.subject,
      body: level.briefing.body,
      disclaimer: level.briefing.disclaimer,
    }));

  return {
    company: { name: content.company.name, domain: content.company.domain },
    targets,
    mail,
    osint: content.osint,
  };
}
