// App badges, like the red counters on a phone's home screen: they tell the player where
// something new is waiting after each level (a briefing in Mail, a new phone feature, a news
// post, a debrief). What the player has already seen is saved in this browser only.
import { useEffect, useState, useSyncExternalStore } from "react";
import { getTraining } from "../api.js";
import { CALL_ENDED_EVENT } from "../apps/Training.jsx";
import { digitsOf, useContacts } from "../phone/contacts.js";

const KEY = "midas.seen";
// mail and features start empty, so the very first briefing shows a badge. The other lists
// start as null: on the first visit, whatever already exists counts as seen.
const EMPTY = { mail: [], features: [], news: null, debriefs: null, contacts: null };
const listeners = new Set();
let seen = null;

function load() {
  if (seen) return seen;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    seen = { ...EMPTY, ...(saved && typeof saved === "object" ? saved : {}) };
  } catch {
    seen = { ...EMPTY };
  }
  return seen;
}

function save(next) {
  seen = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private window: remember for this visit only */
  }
  listeners.forEach((fn) => fn());
}

// Adds ids to one of the seen lists (or starts it). Does nothing if they're all there already.
function markSeen(list, ids) {
  const current = load()[list];
  if (current && ids.every((id) => current.includes(id))) return;
  save({ ...load(), [list]: [...new Set([...(current ?? []), ...ids])] });
}

const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const useSeen = () => useSyncExternalStore(subscribe, load);

export const markMailRead = (id) => markSeen("mail", [id]);
export const useMailRead = () => useSeen().mail;

// Debriefs live on the server: fetch them now, and again after each call ends (the
// transcript arrives a few seconds after hang-up, sometimes a little later).
function useDebriefIds() {
  const [ids, setIds] = useState(null);
  useEffect(() => {
    let timers = [];
    const fetchIds = () =>
      getTraining().then(
        (d) => setIds(d.calls.map((c) => c.callId)),
        () => {}
      );
    fetchIds();
    const onCallEnded = () => {
      timers.forEach(clearTimeout);
      timers = [4000, 12000].map((ms) => setTimeout(fetchIds, ms));
    };
    window.addEventListener(CALL_ENDED_EVENT, onCallEnded);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener(CALL_ENDED_EVENT, onCallEnded);
    };
  }, []);
  return ids;
}

const unseen = (ids, list) => (ids && list ? ids.filter((id) => !list.includes(id)).length : 0);

// Badge counts for the desktop. `visibleApp` is the app the player is looking at right now:
// its news counts as seen straight away (Mail is the exception: each message is read on its own).
export function useBadges(content, visibleApp) {
  const s = useSeen();
  const contacts = useContacts();
  const debriefs = useDebriefIds();

  const mailIds = content?.mail.map((m) => m.id) ?? [];
  const newsIds = content?.osint.website.pages.news.items.map((n) => n.headline) ?? null;
  const contactIds = contacts.map((c) => digitsOf(c.number));
  const features = content?.features?.callerIdKit ? ["callerIdKit"] : [];

  // First visit: what's already there isn't news.
  useEffect(() => {
    if (s.news === null && newsIds) markSeen("news", newsIds);
    if (s.contacts === null) markSeen("contacts", contactIds);
    if (s.debriefs === null && debriefs) markSeen("debriefs", debriefs);
  });

  // The app on screen has nothing unseen.
  useEffect(() => {
    if (visibleApp === "phone") {
      markSeen("contacts", contactIds);
      markSeen("features", features);
    }
    if (visibleApp === "browser" && newsIds) markSeen("news", newsIds);
    if (visibleApp === "training" && debriefs) markSeen("debriefs", debriefs);
  });

  return {
    mail: unseen(mailIds, s.mail),
    phone: unseen(contactIds, s.contacts) + unseen(features, s.features),
    browser: unseen(newsIds, s.news),
    training: unseen(debriefs, s.debriefs),
  };
}
