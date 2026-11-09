// A draggable app window. On phones it fills the screen instead (see .is-compact in os.css).
// Hidden windows stay mounted, so a live call keeps running while the player browses.
import { useRef } from "react";

export default function Window({ win, title, active, compact, hidden, onFocus, onClose, onMinimize, onMove, children }) {
  const drag = useRef(null);

  function startDrag(event) {
    if (compact || event.button !== 0 || event.target.closest("button")) return;
    const desktop = event.currentTarget.closest(".desktop").getBoundingClientRect();
    drag.current = { dx: event.clientX - win.x, dy: event.clientY - win.y, desktop };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDrag(event) {
    if (!drag.current) return;
    const { dx, dy, desktop } = drag.current;
    // Keep the title bar reachable: never fully off screen.
    const x = Math.min(Math.max(event.clientX - dx, -win.w + 120), desktop.width - 120);
    const y = Math.min(Math.max(event.clientY - dy, 0), desktop.height - 40);
    onMove(win.id, x, y);
  }

  const style = compact ? { zIndex: win.z } : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  return (
    <section
      className={`window${active ? " is-active" : ""}${compact ? " is-compact" : ""}`}
      style={style}
      aria-label={title}
      hidden={hidden}
      onPointerDown={() => onFocus(win.id)}
    >
      <header
        className="window-bar"
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <h2 className="window-title">{title}</h2>
        <div className="window-controls">
          {!compact && (
            <button type="button" className="window-btn" onClick={() => onMinimize(win.id)} aria-label={`Minimise ${title}`}>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 9h8" /></svg>
            </button>
          )}
          <button type="button" className="window-btn is-close" onClick={() => onClose(win.id)} aria-label={`Close ${title}`}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
          </button>
        </div>
      </header>
      <div className="window-body">{children}</div>
    </section>
  );
}
