// What the browser is allowed to see. Built from an explicit allow-list so that prompts,
// private facts, code words, accepted names and agent settings can never leak by accident.
import { callerIdKitUnlocked } from "./callerId.js";

const BOARD_SIZE = 5;

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
  // The last word after a level (the ending after Level 5), listed above that level's briefing.
  for (const level of content.levels) {
    if (!level.ending || !cleared.has(level.level)) continue;
    const { from, subject, body, disclaimer } = level.ending;
    mail.push({ id: `ending-${level.level}`, level: level.level, order: level.level + 0.5, from, subject, body, disclaimer });
  }

  // Website news that only appears once the story gets there (e.g. the police statement after Level 4).
  const { website } = content.osint;
  const news = website.pages.news.items.filter((item) => !item.afterLevel || cleared.has(item.afterLevel)).map(({ afterLevel, ...item }) => item);
  const osint = { ...content.osint, website: { ...website, pages: { ...website.pages, news: { ...website.pages.news, items: news } } } };

  return {
    company: { name: content.company.name, domain: content.company.domain },
    targets,
    mail,
    osint,
    // Phone features the player has unlocked (the caller ID kit arrives with Level 4).
    features: { callerIdKit: callerIdKitUnlocked(content, clearedLevels) },
  };
}
