// Security events in the server log (Render > Logs): refused access, bad secrets, rate limits,
// oversized requests. Raw IPs are never written: each line carries a short keyed hash of the
// address, enough to see that one source keeps trying, not who it is.
// A flood is summarised: one line per event and source per minute, with a count of the rest.
import { createHmac } from "node:crypto";

const MAX_KEYS = 5000;

// Which responses count as a security event. 403 only on the tool endpoints: in the game it
// also means "nobody picks up at that number yet", which is normal play.
const isEvent = (status, path) =>
  status === 401 || status === 413 || status === 429 || (status === 403 && path.startsWith("/tools"));

// The path without query string or IDs, so one source's attempts group into one line.
const routeOf = (url) => url.split("?")[0].replace(/call_[A-Za-z0-9_-]+/g, ":call").slice(0, 60);

export function securityEvents({ secret, log = console, everyMs = 60_000, clock = Date.now }) {
  const seen = new Map(); // event key -> { at, skipped }
  const sourceOf = (ip) => createHmac("sha256", secret).update(`ip:${ip}`).digest("base64url").slice(0, 8);

  return (req, res, next) => {
    res.on("finish", () => {
      const path = routeOf(req.originalUrl ?? req.url ?? "");
      if (!isEvent(res.statusCode, path)) return;
      const key = `${res.statusCode} ${req.method} ${path} from ${sourceOf(req.ip ?? "")}`;
      const now = clock();
      const entry = seen.get(key);
      if (entry && now - entry.at < everyMs) {
        entry.skipped++;
        return;
      }
      if (seen.size >= MAX_KEYS) seen.clear();
      seen.set(key, { at: now, skipped: 0 });
      log.warn(`security: ${key}${entry?.skipped ? ` (+${entry.skipped} more since the last line)` : ""}`);
    });
    next();
  };
}
