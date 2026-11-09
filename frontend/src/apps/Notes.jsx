// Recon notepad. Saved in this browser for now (moves to the server with player accounts).
import { useEffect, useState } from "react";

const KEY = "nightjar-notes";
const load = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

export default function Notes() {
  const [text, setText] = useState(load);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, text);
      } catch {
        /* private mode: notes just aren't kept */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <label className="notes">
      <span className="visually-hidden">Notes</span>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={10_000}
        placeholder="Names, numbers, who reports to whom, anything you might say on the call."
        spellCheck="false"
      />
    </label>
  );
}
