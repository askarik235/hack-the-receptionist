// A draggable app window. On phones it fills the screen instead (see .is-compact in os.css).
// Hidden windows stay mounted, so a live call keeps running while the player browses.
// A `device` window (the Phone) has no title bar: it's drawn as a smartphone and dragged by its body.
import { useRef } from "react";
import PhoneBody from "./PhoneBody.jsx";

export default function Window({ win, title, device, active, compact, hidden, onFocus, onClose, onMinimize, onMove, children }) {
  const drag = useRef(null);

  function startDrag(event) {
    // A phone is dragged by its body, bezel and status bar; only the app on its screen is excluded.
    if (compact || event.button !== 0 || event.target.closest("button, .device-app")) return;
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

  const dragHandlers = {
    onPointerDown: startDrag,
    onPointerMove: onDrag,
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
  };
  const style = compact ? { zIndex: win.z } : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };
  const asDevice = device && !compact;

  return (
    <section
      className={`window${asDevice ? " is-device" : ""}${active ? " is-active" : ""}${compact ? " is-compact" : ""}`}
      style={style}
      aria-label={title}
      hidden={hidden}
      onPointerDown={() => onFocus(win.id)}
    >
      {asDevice ? (
        <PhoneBody title={title} drag={dragHandlers} onPutAway={() => onMinimize(win.id)} onClose={() => onClose(win.id)}>
          {children}
        </PhoneBody>
      ) : (
        <>
          <header className="window-bar" {...dragHandlers}>
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
        </>
      )}
    </section>
  );
}
