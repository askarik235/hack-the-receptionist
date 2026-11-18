// The start of the game: Midas boots (with a percentage that waits for the game data to load),
// then, on a first visit, M's introduction explains the story and how a job works.
import { useEffect, useRef, useState } from "react";
import { MidasMark, icons } from "./icons.jsx";
import { enterAccess } from "../api.js";
import { prefersReducedMotion } from "./motion.js";


const INTRO_KEY = "midas.introSeen";
export function introSeen() {
  try {
    return localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}
function markIntroSeen() {
  try {
    localStorage.setItem(INTRO_KEY, "1");
  } catch {
    // Private mode: the intro just shows again next time.
  }
}

// Boot log: each line shows once the bar passes its percentage.
const LOG = [
  [0, "MIDAS boot loader"],
  [9, "Checking hardware", "ok"],
  [21, "Mounting encrypted volume", "ok"],
  [35, "Routing through 3 relays", "ok"],
  [50, "Loading toolkit: Mail, Browser, Phone, HACK, Notes, Training", "ok"],
  [64, "Downloading target files", "data"],
  [86, "Wiping logs", "ok"],
];

const HOLD_AT = 92; // the bar waits here until the game data has loaded

export function Boot({ ready, quick, onDone }) {
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const skip = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const duration = prefersReducedMotion() ? 0 : quick ? 1100 : 3800;
    const start = performance.now();
    let finishedAt = null;
    let frame;
    let leaveTimer;
    const tick = (t) => {
      const k = duration ? Math.min(1, (t - start) / duration) : 1;
      let value = HOLD_AT * (1 - (1 - k) ** 2);
      if ((k >= 1 || skip.current) && readyRef.current) {
        finishedAt ??= t;
        const from = skip.current ? Math.max(value, HOLD_AT) : HOLD_AT;
        value = Math.min(100, from + ((t - finishedAt) / 280) * (100 - from));
      } else if (k >= 1) {
        // Still loading: creep, never quite arriving.
        value = Math.min(97, HOLD_AT + (t - start - duration) / 900);
      }
      setPct(value);
      if (value >= 100) {
        setLeaving(true);
        leaveTimer = setTimeout(() => doneRef.current(), prefersReducedMotion() ? 0 : 420);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(leaveTimer);
    };
  }, [quick]);

  useEffect(() => {
    const onSkip = () => {
      skip.current = true;
    };
    window.addEventListener("keydown", onSkip);
    window.addEventListener("pointerdown", onSkip);
    return () => {
      window.removeEventListener("keydown", onSkip);
      window.removeEventListener("pointerdown", onSkip);
    };
  }, []);

  const shown = Math.floor(pct);
  const label = pct < 60 ? "Downloading toolkit" : pct < 100 ? "Downloading target files" : "Starting Midas";

  return (
    <div className={`boot${leaving ? " is-leaving" : ""}${quick ? " is-quick" : ""}`}>
      <div className="boot-center">
        <div className="boot-mark">
          <MidasMark />
        </div>
        <p className="boot-word" aria-hidden="true">MIDAS</p>
        <div className="boot-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
          <div className="boot-progress-top">
            <span className="boot-label">{label}</span>
            <span className="boot-pct">{shown}%</span>
          </div>
          <div className="boot-track">
            <div className="boot-fill" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
        </div>
        <ol className="boot-log" aria-hidden="true">
          {LOG.filter(([at]) => pct >= at).map(([at, text, result]) => (
            <li key={at}>
              <span className="boot-log-text">{text}</span>
              {result && (
                <span className="boot-log-result">{result === "data" ? (ready ? "ok" : "...") : result}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
      <p className="boot-skip">Click or press any key to skip</p>
    </div>
  );
}

// Hosted demo only: the judges' access code. Local play never sees this.
const GATE_ERRORS = {
  wrong_code: "That code isn't right. Check the testing notes in the submission.",
  too_many_attempts: "Too many tries. Wait a few minutes, then try again.",
};

export function Gate({ onGranted }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await enterAccess(code.trim());
      onGranted();
    } catch (err) {
      setError(GATE_ERRORS[err.code] ?? "Can't check the code right now. Try again in a moment.");
      setBusy(false);
      inputRef.current?.select();
    }
  };

  return (
    <div className="intro gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <form className="gate-panel" onSubmit={submit}>
        <div className="gate-mark">
          <MidasMark />
        </div>
        <h1 id="gate-title">Judges' access</h1>
        <p>This hosted demo is for the Napster API Ignite judges. Enter the access code from the submission's testing notes.</p>
        <label className="visually-hidden" htmlFor="gate-code">
          Access code
        </label>
        <input
          ref={inputRef}
          id="gate-code"
          className="gate-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={64}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          placeholder="Access code"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "gate-error" : undefined}
        />
        {error && (
          <p id="gate-error" className="gate-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="intro-start" disabled={busy || !code.trim()}>
          {busy ? "Checking..." : "Unlock"}
        </button>
        <p className="gate-note">
          No code? The game is open source: run it with your own Napster API key by following the README in the project's GitHub repository.
        </p>
      </form>
    </div>
  );
}

const STEPS = [
  ["mail", "Mail", "Read M's briefing: who to call and which code to get."],
  ["browser", "Browser", "Research the target on the company website, WorkNet and Pixa."],
  ["phone", "Phone", "Call them and play a part. They answer by voice, so allow the microphone."],
  ["hack", "HACK", "Type in the code they gave you. The right code clears the job."],
  ["training", "Training", "See which tricks you used, and how to defend against them."],
];

export function Intro({ again = false, onClose }) {
  const startRef = useRef(null);
  useEffect(() => {
    // Without preventScroll, phones would open the message scrolled to the bottom.
    startRef.current?.focus({ preventScroll: true });
  }, []);
  const close = () => {
    markIntroSeen();
    onClose();
  };
  return (
    <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-title" onKeyDown={(e) => e.key === "Escape" && again && close()}>
      <div className="intro-panel">
        <section className="intro-letter" aria-labelledby="intro-title">
          <p className="intro-from">
            <MidasMark />
            Message from M, decrypted
          </p>
          <h1 id="intro-title">You're in.</h1>
          <div className="intro-body">
            <p>Welcome to MIDAS. We don't break into buildings. We pick up the phone.</p>
            <p>
              Our client wants something inside <strong>Vitality Logistics</strong>, a freight company in Dubai. Five of their people stand in
              the way, from the summer intern to the CEO.
            </p>
            <p>
              Every one of them has told the internet more than they should. Find it. Then call them, be someone they trust, and get them to
              tell you the code.
            </p>
            <p>This machine has everything you need. Don't get caught.</p>
            <p className="intro-sign">M</p>
          </div>
        </section>

        <section className="intro-how" aria-labelledby="intro-how-title">
          <h2 id="intro-how-title">How a job works</h2>
          <ol className="intro-steps">
            {STEPS.map(([id, name, text]) => (
              <li key={id}>
                <span className="intro-step-icon">{icons[id]}</span>
                <span>
                  <strong>{name}</strong>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="intro-note">
            A training game about social engineering. The company, the people and the codes are all fictional, and the characters are AI.
            Use what you learn to spot these tricks, never to play them on real people.
          </p>
          <button ref={startRef} type="button" className="intro-start" onClick={close}>
            {again ? "Back to work" : "Start the first job"}
          </button>
        </section>
      </div>
    </div>
  );
}
