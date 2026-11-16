// In-game web browser: tabs, back/forward, address bar, bookmarks. Only our fake sites exist.
import { useEffect, useRef, useState } from "react";
import { parseUrl, resolveTyped, START, SITES } from "../sites/route.js";
import StartPage from "../sites/StartPage.jsx";
import VitalitySite from "../sites/VitalitySite.jsx";
import WorkNet from "../sites/WorkNet.jsx";
import Pixa from "../sites/Pixa.jsx";
import VitalNetMail from "../sites/VitalNetMail.jsx";
import VitalNetFiles from "../sites/VitalNetFiles.jsx";

const BOOKMARKS = [
  { label: "Vitality Logistics", url: SITES.vitality },
  { label: "WorkNet", url: SITES.worknet },
  { label: "Pixa", url: SITES.pixa },
];

let nextTabId = 1;
const newTab = (url = START) => ({ id: nextTabId++, history: [url], index: 0 });

function pageTitle(route, osint) {
  if (route.site === "start") return "New tab";
  if (route.site === "vitality") return route.path[0] === "files" ? route.path[route.path.length - 1] : "Vitality Logistics";
  if (route.site === "mail") return "VitalNet Mail";
  if (route.site === "files") return "VitalNet Files";
  if (route.site === "worknet") {
    const profile = osint?.worknet.profiles.find((p) => p.handle === route.path[1]);
    return profile ? `${profile.name} | WorkNet` : "WorkNet";
  }
  if (route.site === "pixa") return route.path[0] ? `@${route.path[0]} on Pixa` : "Pixa";
  return "Not found";
}

export default function Browser({ osint, request }) {
  const [tabs, setTabs] = useState(() => [newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const url = tab.history[tab.index];
  const [typed, setTyped] = useState(url);

  useEffect(() => setTyped(url === START ? "" : url), [url]);

  const updateTab = (fn) => setTabs((list) => list.map((t) => (t.id === tab.id ? fn(t) : t)));
  const go = (target) => updateTab((t) => ({ ...t, history: [...t.history.slice(0, t.index + 1), target], index: t.index + 1 }));

  // Requests from other apps (Mail) open in a new tab, replacing an untouched start tab.
  const handled = useRef(null);
  useEffect(() => {
    if (!request || handled.current === request.at) return;
    handled.current = request.at;
    const created = newTab(resolveTyped(request.url));
    setTabs((list) => {
      const untouched = list.length === 1 && list[0].history.length === 1 && list[0].history[0] === START;
      return untouched ? [created] : [...list, created];
    });
    setActiveId(created.id);
  }, [request]);

  function closeTab(id) {
    setTabs((list) => {
      if (list.length === 1) return [newTab()];
      const rest = list.filter((t) => t.id !== id);
      if (id === activeId) setActiveId(rest[rest.length - 1].id);
      return rest;
    });
  }

  function addTab() {
    const created = newTab();
    setTabs((list) => [...list, created]);
    setActiveId(created.id);
  }

  const route = parseUrl(url);
  const Site = { start: StartPage, vitality: VitalitySite, mail: VitalNetMail, files: VitalNetFiles, worknet: WorkNet, pixa: Pixa }[route.site];

  return (
    <div className="browser">
      <div className="browser-tabs" role="tablist" aria-label="Tabs">
        {tabs.map((t) => {
          const title = pageTitle(parseUrl(t.history[t.index]), osint);
          return (
            <div key={t.id} className={`browser-tab${t.id === tab.id ? " is-active" : ""}`}>
              <button type="button" role="tab" aria-selected={t.id === tab.id} className="browser-tab-title" onClick={() => setActiveId(t.id)}>
                {title}
              </button>
              <button type="button" className="browser-tab-close" onClick={() => closeTab(t.id)} aria-label={`Close tab ${title}`}>
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
              </button>
            </div>
          );
        })}
        <button type="button" className="browser-tab-new" onClick={addTab} aria-label="New tab">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" /></svg>
        </button>
      </div>

      <form
        className="browser-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) go(resolveTyped(typed));
        }}
      >
        <button type="button" className="browser-nav" disabled={tab.index === 0} onClick={() => updateTab((t) => ({ ...t, index: t.index - 1 }))} aria-label="Back">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <button
          type="button"
          className="browser-nav"
          disabled={tab.index === tab.history.length - 1}
          onClick={() => updateTab((t) => ({ ...t, index: t.index + 1 }))}
          aria-label="Forward"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <label className="browser-address">
          <span className="visually-hidden">Address</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type an address, like pixa.photos" spellCheck="false" autoComplete="off" />
        </label>
      </form>

      <nav className="browser-bookmarks" aria-label="Bookmarks">
        {BOOKMARKS.map((b) => (
          <button key={b.url} type="button" onClick={() => go(b.url)}>
            {b.label}
          </button>
        ))}
      </nav>

      <div className="browser-page" key={`${tab.id}-${tab.index}`}>
        {!osint ? (
          <p className="browser-loading">Loading…</p>
        ) : Site ? (
          <Site route={route} osint={osint} go={go} />
        ) : (
          <div className="site-none">
            <h3>This site can't be reached</h3>
            <p>
              {route.host} doesn't exist on this network. Try {SITES.vitality}, {SITES.worknet} or {SITES.pixa}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
