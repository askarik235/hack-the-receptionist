// Window manager state: one window per app, stacked by z-order. Small on purpose.
import { useCallback, useReducer } from "react";

const CASCADE = 28;
const TASKBAR_H = 44; // matches --taskbar-h in os.css

function reducer(state, action) {
  const z = state.topZ + 1;
  const update = (fn) => state.windows.map((w) => (w.id === action.id ? fn(w) : w));
  switch (action.type) {
    case "open": {
      if (state.windows.some((w) => w.id === action.id)) {
        return { topZ: z, windows: update((w) => ({ ...w, z, minimized: false })) };
      }
      // Fit the window inside the visible desktop (small screens, narrow side panes).
      const { width, height } = action.viewport;
      const w = Math.min(action.size.w, width - 24);
      const h = Math.min(action.size.h, height - 24);
      const offset = (state.windows.length % 6) * CASCADE;
      // "right": held at the right edge, near the bottom, like a phone in your hand.
      const right = action.place === "right";
      const x = right ? Math.max(12, width - w - 40) : Math.max(12, Math.min(128 + offset, width - w - 12));
      const y = right ? Math.max(12, height - h - 16) : Math.max(12, Math.min(32 + offset, height - h - 12));
      const win = { id: action.id, x, y, w, h, z, minimized: false };
      return { topZ: z, windows: [...state.windows, win] };
    }
    case "focus":
      return { topZ: z, windows: update((w) => ({ ...w, z, minimized: false })) };
    case "minimize":
      return { ...state, windows: update((w) => ({ ...w, minimized: true })) };
    case "close":
      return { ...state, windows: state.windows.filter((w) => w.id !== action.id) };
    case "move":
      return { ...state, windows: update((w) => ({ ...w, x: action.x, y: action.y })) };
    default:
      return state;
  }
}

export function useWindows(apps) {
  const [{ windows }, dispatch] = useReducer(reducer, { topZ: 1, windows: [] });

  const open = useCallback(
    (id) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight - TASKBAR_H };
      dispatch({ type: "open", id, size: apps[id].size, place: apps[id].place, viewport });
    },
    [apps]
  );
  const focus = useCallback((id) => dispatch({ type: "focus", id }), []);
  const minimize = useCallback((id) => dispatch({ type: "minimize", id }), []);
  const close = useCallback((id) => dispatch({ type: "close", id }), []);
  const move = useCallback((id, x, y) => dispatch({ type: "move", id, x, y }), []);

  const visible = windows.filter((w) => !w.minimized);
  const activeId = visible.length ? visible.reduce((a, b) => (b.z > a.z ? b : a)).id : null;

  return { windows, activeId, open, close, minimize, focus, move };
}
