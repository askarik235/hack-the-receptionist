// What a character remembers about this player before picking up (Level 5: Viktor). Passed into
// the call at the start, like the office news, so he always has it: the names that won earlier
// levels, the methods this player has used, and earlier calls to him and how they ended.
// Built only from our own records. Caller-chosen names are cleaned, and no code ever appears.
import { samePerson, safeName } from "./names.js";
import { createWordTravels } from "./wordTravels.js";

const MAX_EARLIER_CALLS = 5;
// How an earlier call ended, as the character remembers it (calls.close_reason).
const CALL_ENDINGS = {
  distrust: "you didn't believe them and hung up",
  hangup: "they hung up on you",
  silence: "they went quiet and you hung up",
  time_limit: "it went nowhere and the line was cut",
};

export function createPlayerHistory(db, content) {
  const wordTravels = createWordTravels(db);
  const earlierCalls = db.prepare(
    `SELECT c.id, c.close_reason, c.trust_identity,
            (SELECT claimed_name FROM tool_calls t WHERE t.call_id = c.id AND t.claimed_name IS NOT NULL ORDER BY t.id LIMIT 1) AS first_claim,
            (SELECT COUNT(*) FROM tool_calls t WHERE t.call_id = c.id AND t.tool = 'request_code' AND json_extract(t.arguments_json, '$.result') = 'refused') AS failed_checks
     FROM calls c
     WHERE c.player_id = ? AND c.level = ? AND c.id != ? AND c.status = 'ended'
     ORDER BY c.created_at DESC, c.attempt DESC LIMIT ?`
  );
  const playerTechniques = db.prepare("SELECT technique FROM player_techniques WHERE player_id = ? ORDER BY first_seen_at");

  // The history as plain text for the character, or null if this level doesn't remember players.
  return function playerHistory(playerId, level, currentCallId) {
    if (!level.remembersPlayer) return null;
    const target = content.staffById.get(level.targetId);
    const parts = [];

    const names = wordTravels.winningClaims(playerId, level.level).map(({ level: won, claimed_name }) => {
      const who = samePerson(claimed_name, target.name) ? "your own name" : safeName(claimed_name);
      const what = content.levelByNumber.get(won)?.incident;
      return what ? `${who} (to get ${what})` : who;
    });
    parts.push(names.length ? `Names the attackers used this week: ${names.join("; ")}.` : "You don't know what names the attackers used.");

    const methods = playerTechniques
      .all(playerId)
      .map((row) => content.techniques.find((t) => t.id === row.technique)?.name)
      .filter(Boolean);
    if (methods.length) parts.push(`How they work: ${methods.join(", ")}.`);

    const calls = earlierCalls.all(playerId, level.level, currentCallId, MAX_EARLIER_CALLS).map((row) => {
      const claimed = row.trust_identity ?? row.first_claim;
      const who = claimed ? `someone saying they were ${safeName(claimed)}` : "someone who never gave a name";
      const how = row.failed_checks > 0 ? "the case check failed and you gave them nothing" : CALL_ENDINGS[row.close_reason] ?? "the call dropped";
      return `${who}: ${how}`;
    });
    parts.push(
      calls.length
        ? `Earlier calls to you about the case this weekend, newest first: ${calls.join("; ")}.`
        : "Nobody else has called you about the case yet."
    );
    return parts.join(" ");
  };
}
