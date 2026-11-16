import { useCallback, useEffect, useMemo, useState } from "react";
import { getContent } from "./api.js";
import { useWindows } from "./os/useWindows.js";
import Window from "./os/Window.jsx";
import Taskbar from "./os/Taskbar.jsx";
import TargetBoard from "./os/TargetBoard.jsx";
import Skyline from "./os/Skyline.jsx";
import Badge from "./os/Badge.jsx";
import { useBadges } from "./os/badges.js";
import { icons } from "./os/icons.jsx";
import Mail from "./apps/Mail.jsx";
import Browser from "./apps/Browser.jsx";
import Notes from "./apps/Notes.jsx";
import Phone from "./apps/Phone.jsx";
import Hack from "./apps/Hack.jsx";
import Training from "./apps/Training.jsx";

const APPS = {
  mail: { title: "Mail", size: { w: 760, h: 500 } },
  browser: { title: "Browser", size: { w: 1000, h: 660 } },
  // Drawn as a smartphone, held at the right of the screen.
  phone: { title: "Phone", size: { w: 296, h: 612 }, device: true, place: "right" },
  hack: { title: "HACK", size: { w: 540, h: 480 } },
  notes: { title: "Notes", size: { w: 420, h: 440 } },
  training: { title: "Training", size: { w: 720, h: 560 } },
};
const DESKTOP_ORDER = ["mail", "browser", "phone", "hack", "notes", "training"];

function useCompact() {
  const query = "(max-width: 767px)";
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setCompact(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return compact;
}

export default function App() {
  const [content, setContent] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [browserRequest, setBrowserRequest] = useState(null);
  const wm = useWindows(APPS);
  const compact = useCompact();

  const loadContent = useCallback(() => {
    getContent().then(setContent, (err) => setLoadError(err.message));
  }, []);
  useEffect(loadContent, [loadContent]);

  // Other apps (Mail links) can open a page in the Browser.
  const openUrl = useCallback(
    (url) => {
      setBrowserRequest({ url, at: Date.now() });
      wm.open("browser");
    },
    [wm]
  );

  const renderApp = useMemo(
    () => ({
      mail: (visible) => <Mail mail={content?.mail ?? []} visible={visible} onOpenUrl={openUrl} />,
      browser: () => <Browser osint={content?.osint} request={browserRequest} />,
      notes: () => <Notes />,
      training: () => <Training />,
      phone: () => <Phone callerIdKit={Boolean(content?.features?.callerIdKit)} />,
      hack: () => (
        <Hack
          target={content?.targets.find((t) => t.status === "open")}
          domain={content?.company.domain}
          onCleared={loadContent}
          onOpenMail={() => wm.open("mail")}
        />
      ),
    }),
    [content, browserRequest, openUrl, loadContent, wm]
  );

  const badges = useBadges(content, wm.activeId);

  return (
    <div className={`desktop${compact ? " is-compact" : ""}`}>
      <div className="blinds-frame" aria-hidden="true">
        <Skyline />
        <div className="blinds" />
      </div>

      <nav className="desktop-icons" aria-label="Apps">
        {DESKTOP_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className="desktop-icon"
            onClick={() => wm.open(id)}
            aria-label={badges[id] ? `${APPS[id].title}, ${badges[id]} new` : APPS[id].title}
          >
            <span className="desktop-icon-art">
              {icons[id]}
              <Badge count={badges[id]} />
            </span>
            <span>{APPS[id].title}</span>
          </button>
        ))}
      </nav>

      {content && <TargetBoard targets={content.targets} />}
      {compact && <p className="compact-note">Training game: everyone here is fictional</p>}
      {loadError && (
        <p className="desktop-error" role="alert">
          Can't reach the game server ({loadError}). Check that the backend is running, then reload.
        </p>
      )}

      {wm.windows.map((w) => (
          <Window
            key={w.id}
            win={w}
            title={APPS[w.id].title}
            device={APPS[w.id].device}
            active={w.id === wm.activeId}
            compact={compact}
            hidden={w.minimized || (compact && w.id !== wm.activeId)}
            onFocus={wm.focus}
            onClose={wm.close}
            onMinimize={wm.minimize}
            onMove={wm.move}
          >
            {renderApp[w.id](w.id === wm.activeId)}
          </Window>
        ))}

      <Taskbar
        apps={APPS}
        windows={wm.windows}
        activeId={wm.activeId}
        badges={badges}
        onSelect={(id) => (id === wm.activeId && !compact ? wm.minimize(id) : wm.focus(id))}
      />
    </div>
  );
}
