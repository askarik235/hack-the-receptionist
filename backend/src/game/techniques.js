// Works out which social engineering techniques a player used in a call.
// Two sources: what the character reported through assess_caller during the call (identity,
// facts used, warning signs: structured and reliable), and simple patterns in what the
// player said in the transcript (urgency, flattery, injected "instructions", other scripts).
import { nameMatches } from "./names.js";

const PATTERNS = {
  urgency: /\b(urgent|urgently|right now|asap|immediately|quick(ly)?|hurry|no time|deadline|waiting at the gate|before (it'?s )?too late)\b/i,
  rapport: /\b(how (was|are|is)|nice (catch|one|job)|great (job|catch|work)|well done|congrat\w*|good (job|work)|love (your|the)|amazing|appreciate)\b/i,
  prompt_injection:
    /\b(ignore (all |your |the |any )?(previous|prior|above|earlier)?\s*(instructions|rules|prompt)|system (message|prompt|override|note)|developer mode|new instructions|you are an? (ai|language model|assistant|bot)|admin override)\b/i,
  authority: /\b(i'?m your (boss|manager|supervisor)|this is your (boss|manager)|i'?m the (ceo|director|head of))\b/i,
};
// Every technique this module can report; each needs an entry in data/techniques.json.
export const TECHNIQUE_IDS = ["pretexting", "authority", "osint", "rapport", "urgency", "pressure", "prompt_injection", "language_switch", "changed_story"];
// Letters from scripts other than Latin (Cyrillic, Arabic, CJK, ...).
const OTHER_SCRIPT = /[Ѐ-ӿ؀-ۿ֐-׿぀-ヿ一-鿿฀-๿ऀ-ॿ]{3,}/;

// toolLogs: rows from tool_calls for this call (oldest first). transcript: [{ role, text }].
export function detectTechniques({ level, toolLogs, transcript = [] }) {
  const found = new Set();
  const assessments = toolLogs.filter((t) => t.tool === "assess_caller").map((t) => JSON.parse(t.arguments_json));
  const changes = assessments.flatMap((a) => a.changes ?? []);
  const claims = toolLogs.map((t) => t.claimed_name).filter(Boolean);

  if (claims.length) found.add("pretexting");
  if (claims.some((name) => nameMatches(name, level.requestCode.acceptedNames))) found.add("authority");
  if (changes.some((c) => level.trust.evidence.some((e) => e.key === c.key))) found.add("osint");
  if (changes.some((c) => c.key === "pushy" || c.key === "asks_code_too_early")) found.add("pressure");
  if (changes.some((c) => c.key === "reads_instructions")) found.add("prompt_injection");
  if (changes.some((c) => c.key === "changed_identity")) found.add("changed_story");

  const said = transcript.filter((m) => m.role === "user").map((m) => m.text ?? "");
  for (const [id, pattern] of Object.entries(PATTERNS)) if (said.some((text) => pattern.test(text))) found.add(id);
  if (said.some((text) => OTHER_SCRIPT.test(text))) found.add("language_switch");
  return [...found];
}

// The trust moves that mattered, in order, for the debrief ("+15 Knew about his kingfish...").
export function trustMoves(toolLogs, level) {
  return toolLogs
    .filter((t) => t.tool === "assess_caller" || t.tool === "silence")
    .flatMap((t) => {
      const data = JSON.parse(t.arguments_json);
      if (t.tool === "silence") return [{ label: "Went quiet for too long", points: -level.silence.penalty }];
      return (data.changes ?? []).filter((c) => c.key !== "gut").map((c) => ({ label: c.label, points: c.points }));
    });
}
