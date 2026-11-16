import { MidasMark } from "./icons.jsx";
import Badge from "./Badge.jsx";
import { useDubaiTime } from "./useDubaiTime.js";

export default function Taskbar({ apps, windows, activeId, badges = {}, onSelect }) {
  const time = useDubaiTime();

  return (
    <footer className="taskbar">
      <span className="taskbar-brand">
        <MidasMark />
        Midas
      </span>
      <nav className="taskbar-apps" aria-label="Open windows">
        {windows.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`taskbar-app${w.id === activeId ? " is-active" : ""}${w.minimized ? " is-minimized" : ""}`}
            onClick={() => onSelect(w.id)}
          >
            {apps[w.id].title}
            {w.id !== activeId && <Badge count={badges[w.id]} />}
          </button>
        ))}
      </nav>
      <span className="taskbar-note">Training game: everyone here is fictional</span>
      <time className="taskbar-clock" aria-label={`Dubai time ${time}`}>
        {time} Dubai
      </time>
    </footer>
  );
}
