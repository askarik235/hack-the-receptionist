// "Word travels": once a trick has won a level, the company hears about it.
// - Hard rule: an identity that already won an earlier level is refused by request_code.
// - Soft rule: later characters get the earlier levels' security notices (office_news).
// Only winning calls count (decision D1); failed calls only feed the debrief.
export function createWordTravels(db) {
  const winners = db.prepare(
    `SELECT cl.level, t.claimed_name
     FROM cleared_levels cl
     JOIN tool_calls t ON t.call_id = cl.winning_call_id AND t.tool = 'request_code' AND t.approved = 1
     WHERE cl.player_id = ? AND cl.level < ?
     GROUP BY cl.level
     ORDER BY cl.level`
  );

  return {
    // Names this player already used to win an earlier level.
    burnedNames: (playerId, level) => winners.all(playerId, level).map((row) => row.claimed_name).filter(Boolean),

    // Security notices the character at `level` has heard, one per earlier level this player won.
    officeNews(content, playerId, level) {
      return winners
        .all(playerId, level)
        .map((row) => content.levelByNumber.get(row.level)?.rumour)
        .filter(Boolean);
    },
  };
}
