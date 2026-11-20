// The ending cutscene, played when the last target is hacked (and replayable from HACK).
// Five beats: the jobs get stamped, the player's cut comes in, the twist, MIDAS goes dark,
// then the end card. The text comes from the server, which only sends it after the last level
// is cleared, so the ending can't be read in the bundle ahead of time.
import { useCallback, useEffect, useRef, useState } from "react";
import { MidasMark } from "./icons.jsx";
import { prefersReducedMotion } from "./motion.js";

const SCENES = ["ledger", "transfer", "news", "dark", "end"];
// How long each beat stays before moving on by itself (ms). The end card waits for the player.
const HOLD = { ledger: 6200, transfer: 9800, news: 9000, dark: 5200 };
// The client's bonus slams down from the top once the cut has finished counting (ms into the beat).
// Keep in step with the .finale-bonus animation delay and duration in os.css.
const BONUS_LANDS_AT = 3300;

const money = (n) => Math.round(n).toLocaleString("en-US");

// Counts from wherever it is now up to `target` (so a second target adds on top).
function useCountUp(target, run, ms) {
  const [value, setValue] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (!run) return undefined;
    if (prefersReducedMotion()) {
      current.current = target;
      setValue(target);
      return undefined;
    }
    const from = current.current;
    const start = performance.now();
    let frame;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / ms);
      current.current = from + (target - from) * (1 - (1 - k) ** 4);
      setValue(current.current);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, run, ms]);
  return value;
}

export default function Finale({ finale, targets, onClose, onOpenMail, onOpenTraining }) {
  const [scene, setScene] = useState(0);
  const name = SCENES[scene];
  const root = useRef(null);
  const firstButton = useRef(null);

  const next = useCallback(() => setScene((s) => Math.min(s + 1, SCENES.length - 1)), []);
  const skip = useCallback(() => setScene(SCENES.length - 1), []);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  // Each beat moves on by itself; the end card stays.
  useEffect(() => {
    if (!finale || name === "end") return undefined;
    const timer = setTimeout(next, HOLD[name]);
    return () => clearTimeout(timer);
  }, [finale, name, next]);

  useEffect(() => {
    if (name === "end") firstButton.current?.focus({ preventScroll: true });
  }, [name]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (name === "end") onClose();
        else skip();
      } else if (name !== "end" && [" ", "Enter", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [name, next, skip, onClose]);

  const transfer = finale?.transfer;
  const bonus = transfer?.bonus ?? null;
  const cut = transfer ? (transfer.total * transfer.share) / 100 : 0;

  // The bonus lands partway through the payout beat; then the counter adds it on.
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (name !== "transfer" || !bonus) return undefined;
    const timer = setTimeout(() => setLanded(true), prefersReducedMotion() ? 0 : BONUS_LANDS_AT);
    return () => clearTimeout(timer);
  }, [name, bonus]);
  const shown = useCountUp(cut + (landed ? bonus.amount : 0), name === "transfer", landed ? 900 : 2600);

  return (
    <div
      ref={root}
      tabIndex={-1}
      className={`finale is-${name}`}
      role="dialog"
      aria-modal="true"
      aria-label="Ending"
      onPointerDown={(e) => {
        if (name !== "end" && e.button === 0) next();
      }}
    >
      {!finale && <p className="finale-wait">Decrypting M's last transmission</p>}

      {finale && name === "ledger" && (
        <section className="finale-scene finale-ledger" aria-live="polite">
          <h2>{finale.ledgerTitle}</h2>
          <ol>
            {targets.map((t, i) => (
              <li key={t.level} style={{ "--i": i }}>
                <span className="finale-ledger-who">
                  {t.name}
                  <small>{t.role}</small>
                </span>
                <span className="finale-ledger-what">{finale.prizes[i]}</span>
                <span className="finale-stamp">Cleared</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {finale && name === "transfer" && (
        <section className={`finale-scene finale-transfer${landed ? " is-slammed" : ""}`} aria-live="polite">
          {bonus && (
            <div className="finale-bonus">
              <p className="finale-bonus-amount">
                +{transfer.currency} {money(bonus.amount)}
              </p>
              <p className="finale-bonus-label">
                {bonus.label}. <span>{bonus.note}</span>
              </p>
            </div>
          )}
          <p className="finale-route">
            Incoming from wallet <strong>{transfer.from}</strong>
          </p>
          <p className="finale-amount" aria-label={`${transfer.currency} ${money(cut + (bonus?.amount ?? 0))}`}>
            <span className="finale-currency">{transfer.currency}</span>
            <span className="finale-digits">{money(shown)}</span>
          </p>
          <p className="finale-share">
            Your cut: {transfer.share}% of {transfer.currency} {money(transfer.total)}
            {landed && <> + bonus</>}
          </p>
          <p className="finale-memo">{transfer.memo}</p>
          <p className="finale-from">— M</p>
        </section>
      )}

      {finale && name === "news" && (
        <section className="finale-scene finale-news" aria-live="polite">
          <article className="finale-wire">
            <p className="finale-wire-source">Gulf Business Wire</p>
            <h2>{finale.headline}</h2>
          </article>
          <div className="finale-reveal">
            {finale.reveal.map((line, i) => (
              <p key={line} style={{ "--i": i }}>
                {line}
              </p>
            ))}
          </div>
        </section>
      )}

      {finale && name === "dark" && (
        <section className="finale-scene finale-dark" aria-live="polite">
          <ol>
            {finale.shutdown.map((line, i) => (
              <li key={line} style={{ "--i": i }}>
                <span>{line}</span>
                <span className="finale-ok">done</span>
              </li>
            ))}
          </ol>
          <p className="finale-gone" style={{ "--i": finale.shutdown.length }}>
            MIDAS has gone dark.
          </p>
        </section>
      )}

      {finale && name === "end" && (
        <section className="finale-scene finale-end" aria-labelledby="finale-title">
          <div className="finale-mark">
            <MidasMark />
          </div>
          <h1 id="finale-title">Game completed</h1>
          <p className="finale-signoff">
            “{finale.signoff}”<span>M</span>
          </p>
          {finale.stats && (
            <dl className="finale-stats">
              <div>
                <dt>Calls made</dt>
                <dd>{finale.stats.calls}</dd>
              </div>
              <div>
                <dt>Minutes on the phone</dt>
                <dd>{finale.stats.minutes}</dd>
              </div>
              <div>
                <dt>Tricks collected</dt>
                <dd>
                  {finale.stats.techniques}
                  <small>/{finale.stats.techniquesTotal}</small>
                </dd>
              </div>
            </dl>
          )}
          <p className="finale-lesson">{finale.lesson}</p>
          <div className="finale-actions">
            <button ref={firstButton} type="button" className="intro-start" onClick={onOpenTraining}>
              See what you learned
            </button>
            <button type="button" className="finale-secondary" onClick={onOpenMail}>
              Read M's last message
            </button>
            <button type="button" className="finale-secondary" onClick={onClose}>
              Back to the desktop
            </button>
          </div>
          <p className="finale-note">Training game. All people and companies are fictional.</p>
        </section>
      )}

      {finale && name !== "end" && (
        <p className="finale-hint" aria-hidden="true">
          Click to continue. Esc skips to the end.
        </p>
      )}
    </div>
  );
}
