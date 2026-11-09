// The HACK terminal: type the code a character gave you. The server checks it.
import { useEffect, useRef, useState } from "react";
import { submitHack } from "../api.js";

const ERRORS = {
  invalid_code: "That doesn't look like an access code. Codes look like WORD-1234.",
  too_many_attempts: "Too many attempts. Their system locked you out for a minute.",
  nothing_to_hack: "No open target right now. Check your mail.",
};
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

export default function Hack({ target, domain, onCleared, onOpenMail }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [result, setResult] = useState(null); // { kind: "granted" | "denied", ... }
  const input = useRef(null);
  const logEnd = useRef(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" }); // returns a Promise in newer browsers; don't return it
  }, [log, result]);

  const print = (text, tone = "") => setLog((l) => [...l, { text, tone, id: `${Date.now()}-${l.length}` }]);

  async function hack(event) {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setResult(null);
    print(`> hack ${code.trim().toUpperCase()}`, "cmd");
    try {
      print(`connecting to ${domain ?? "target"} internal systems…`);
      const [response] = await Promise.all([submitHack(code), wait(900)]);
      print("sending access code…");
      await wait(500);
      if (response.result === "granted") {
        print("access granted", "ok");
        setResult({ kind: "granted", ...response });
        setCode("");
        onCleared?.();
      } else {
        print("access denied: code rejected", "bad");
        setResult({ kind: "denied" });
      }
    } catch (err) {
      print(ERRORS[err.code] ?? "Connection failed. Check that the game server is running.", "bad");
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <div className="hack">
      <div className="hack-screen" aria-live="polite">
        <p className="hack-banner">NIGHTJAR access tool</p>
        <p className="hack-line">
          {target ? (
            <>
              target {target.level}: {target.name}, {target.role}
            </>
          ) : (
            "no open target"
          )}
        </p>
        <p className="hack-line is-dim">Type the access code your target read out to you.</p>

        {log.map((line) => (
          <p key={line.id} className={`hack-line ${line.tone ? `is-${line.tone}` : ""}`}>
            {line.text}
          </p>
        ))}

        {result?.kind === "denied" && (
          <div className="hack-verdict is-denied" role="alert">
            <strong>ACCESS DENIED</strong>
            <span>Wrong code. Check what they said, or call again.</span>
          </div>
        )}

        {result?.kind === "granted" && (
          <div className="hack-verdict is-granted" role="status">
            <strong>ACCESS GRANTED</strong>
            <span>Target {result.level} cleared: {result.title}</span>
            <div className="hack-debrief">
              <h3>Why it worked</h3>
              <p>{result.debrief.whyItWorked}</p>
              <h3>How a real company stops this</h3>
              <ul>
                {result.debrief.defence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="hack-next">
                {result.next ? `Target ${result.next.level} is unlocked. ` : "That was the last target in this build. "}
                {result.next && (
                  <button type="button" className="hack-link" onClick={onOpenMail}>
                    Read the new briefing
                  </button>
                )}
              </p>
            </div>
          </div>
        )}
        <span ref={logEnd} />
      </div>

      <form className="hack-input" onSubmit={hack}>
        <label htmlFor="hack-code" className="hack-prompt">
          code&gt;
        </label>
        <input
          id="hack-code"
          ref={input}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ""))}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="WORD-1234"
          disabled={busy || !target}
        />
        <button type="submit" disabled={busy || !code.trim() || !target}>
          {busy ? "…" : "HACK"}
        </button>
      </form>
    </div>
  );
}
