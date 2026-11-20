import { useCallback, useEffect, useMemo, useState } from "react";
import { enterAccess, getAccess, getContent } from "./api.js";
import { useWindows } from "./os/useWindows.js";
import Window from "./os/Window.jsx";
import Taskbar from "./os/Taskbar.jsx";
import TargetBoard from "./os/TargetBoard.jsx";
import Skyline from "./os/Skyline.jsx";
import Badge from "./os/Badge.jsx";
import { Boot, Gate, Intro, introSeen } from "./os/Boot.jsx";
import Finale from "./os/Finale.jsx";
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
  // boot -> intro (first visit, or reopened from the taskbar) -> desktop
  const [returning] = useState(introSeen);
  const [phase, setPhase] = useState("boot");

  // null until we know whether this server wants the judge access code.
  const [access, setAccess] = useState(null);

  const loadContent = useCallback(() => {
    getContent().then(setContent, (err) => setLoadError(err.message));
  }, []);

  // The judges' link carries the code after # (never sent to the server in a page request):
  // trade it for the access cookie, then drop it from the address bar.
  useEffect(() => {
    (async () => {
      const code = new URLSearchParams(window.location.hash.slice(1)).get("access");
      if (code) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        await enterAccess(code).catch(() => {});
      }
      const status = await getAccess();
      setAccess(status);
      if (status.granted) loadContent();
    })().catch((err) => setLoadError(err.message));
  }, [loadContent]);

  const unlock = useCallback(() => {
    setAccess({ required: true, granted: true });
    loadContent();
  }, [loadContent]);

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
          finished={Boolean(content?.finale)}
          onFinale={() => setPhase("finale")}
        />
      ),
    }),
    [content, browserRequest, openUrl, loadContent, wm]
  );

  const badges = useBadges(content, wm.activeId);

  const covered = phase !== "desktop";

  return (
    <>
    <div className={`desktop${compact ? " is-compact" : ""}`} inert={covered} aria-hidden={covered || undefined}>
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
        onBrand={() => setPhase("again")}
      />
    </div>

    {phase === "boot" && (
      <Boot
        ready={loadError !== null || (access !== null && (!access.granted || content !== null))}
        quick={returning}
        onDone={() => setPhase(access && !access.granted ? "gate" : introSeen() ? "desktop" : "intro")}
      />
    )}
    {phase === "gate" && (
      <Gate
        onGranted={() => {
          unlock();
          setPhase(introSeen() ? "desktop" : "intro");
        }}
      />
    )}
    {(phase === "intro" || phase === "again") && <Intro again={phase === "again"} onClose={() => setPhase("desktop")} />}
    {phase === "finale" && (
      <Finale
        finale={content?.finale ?? null}
        targets={content?.targets ?? []}
        onClose={() => setPhase("desktop")}
        onOpenMail={() => {
          setPhase("desktop");
          wm.open("mail");
        }}
        onOpenTraining={() => {
          setPhase("desktop");
          wm.open("training");
        }}
      />
    )}
    </>
  );
}
