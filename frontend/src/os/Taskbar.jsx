import { useEffect, useState } from "react";
import { NightjarMark } from "./icons.jsx";

const dubaiTime = () =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date());

export default function Taskbar({ apps, windows, activeId, onSelect }) {
  const [time, setTime] = useState(dubaiTime);
  useEffect(() => {
    const timer = setInterval(() => setTime(dubaiTime()), 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <footer className="taskbar">
      <span className="taskbar-brand">
        <NightjarMark />
        Nightjar
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
