// Training: what happened in each call, why, and how real companies defend against it.
// Plus a collection of the techniques the player has used, like achievements.
import { useCallback, useEffect, useState } from "react";
import { getTraining } from "../api.js";

export const CALL_ENDED_EVENT = "midas:call-ended";

const OUTCOMES = {
  cleared: { label: "Target cleared", tone: "good" },
  got_code: { label: "Got the code", tone: "good" },
  distrust: { label: "They stopped believing you", tone: "bad" },
  case_check: { label: "Your story didn't check out", tone: "bad" },
  silence: { label: "You went quiet; they hung up", tone: "bad" },
  failed: { label: "Call didn't connect", tone: "dim" },
  ended: { label: "Call ended, no code", tone: "dim" },
};
const clock = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const when = (unix) => new Date(unix * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

export default function Training() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("debriefs");
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    getTraining().then(
      (d) => {
        setData(d);
        setError(null);
      },
      () => setError("Can't load your debriefs. Check that the game server is running."),
    );
  }, []);

  // Load now, and again a few seconds after each call (the transcript arrives just after hang-up).
  useEffect(() => {
    load();
    let timer;
    const onCallEnded = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 4000);
    };
    window.addEventListener(CALL_ENDED_EVENT, onCallEnded);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CALL_ENDED_EVENT, onCallEnded);
    };
  }, [load]);

  const byId = new Map((data?.techniques ?? []).map((t) => [t.id, t]));
  const collected = data?.techniques.filter((t) => t.collected).length ?? 0;

  return (
    <div className="training">
      <nav className="training-tabs" aria-label="Training">
        <button type="button" className={tab === "debriefs" ? "is-current" : ""} onClick={() => setTab("debriefs")}>
          Debriefs
        </button>
        <button type="button" className={tab === "techniques" ? "is-current" : ""} onClick={() => setTab("techniques")}>
          Techniques {data && <span className="training-count">{collected}/{data.techniques.length}</span>}
        </button>
        <button type="button" className="training-refresh" onClick={load}>
          Refresh
        </button>
      </nav>

      <div className="training-body">
        {error && <p className="training-empty" role="alert">{error}</p>}
        {!data && !error && <p className="training-empty">Loading…</p>}

        {data && tab === "debriefs" && (
          <>
            {data.calls.length === 0 && (
              <p className="training-empty">No calls yet. After every call, win or lose, a debrief appears here.</p>
            )}
            {data.calls.map((call) => {
              const outcome = OUTCOMES[call.outcome] ?? OUTCOMES.ended;
              const isOpen = open === call.callId;
              return (
                <article key={call.callId} className={`debrief is-${outcome.tone}`}>
                  <header className="debrief-head">
                    <div>
                      <h3>{call.target.name}</h3>
                      <p className="debrief-meta">
                        Target {call.level}, {when(call.startedAt)}
                        {call.durationS ? `, ${clock(call.durationS)}` : ""}
                      </p>
                    </div>
                    <span className="debrief-outcome">{outcome.label}</span>
                  </header>

                  <div className="debrief-trust" aria-label={`Trust went from ${call.trust.start}% to ${call.trust.end}%`}>
                    <span>Trust {call.trust.start}%</span>
                    <div className="debrief-track">
                      <div className="debrief-fill" style={{ width: `${call.trust.end}%` }} />
                      <span className="debrief-mark" style={{ left: `${call.trust.codeAt}%` }} />
                    </div>
                    <strong>{call.trust.end}%</strong>
                  </div>

                  {call.moves.length > 0 && (
                    <ul className="debrief-moves">
                      {call.moves.map((m, i) => (
                        <li key={i} className={m.points > 0 ? "is-up" : "is-down"}>
                          <span className="debrief-points">{m.points > 0 ? `+${m.points}` : m.points}</span>
                          {m.label}
                        </li>
                      ))}
                    </ul>
                  )}

                  {call.techniques.length > 0 && (
                    <ul className="debrief-chips" aria-label="Techniques used">
                      {call.techniques.map((id) => (
                        <li key={id}>{byId.get(id)?.name ?? id}</li>
                      ))}
                    </ul>
                  )}
                  {!call.analysed && <p className="debrief-note">Still fetching the transcript. Check back in a moment.</p>}

                  <button type="button" className="debrief-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : call.callId)}>
                    {isOpen ? "Hide details" : "What to learn from this call"}
                  </button>

                  {isOpen && (
                    <div className="debrief-details">
                      {call.lesson && (
                        <section>
                          <h4>Why it worked</h4>
                          <p>{call.lesson.whyItWorked}</p>
                        </section>
                      )}
                      {call.techniques.length > 0 && (
                        <section>
                          <h4>How companies stop these tricks</h4>
                          <ul>
                            {call.techniques.map((id) => byId.get(id)).filter(Boolean).map((t) => (
                              <li key={t.id}>
                                <strong>{t.name}:</strong> {t.defence}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                      {call.lesson && (
                        <section>
                          <h4>Defences for this target</h4>
                          <ul>
                            {call.lesson.defence.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </section>
                      )}
                      {call.transcript?.length > 0 && (
                        <section>
                          <h4>Transcript</h4>
                          <ol className="debrief-transcript">
                            {call.transcript.map((m, i) => (
                              <li key={i} className={`is-${m.who}`}>
                                <span>{m.who === "you" ? "You" : call.target.name.split(" ")[0]}</span>
                                {m.text}
                              </li>
                            ))}
                          </ol>
                        </section>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </>
        )}

        {data && tab === "techniques" && (
          <ul className="technique-grid">
            {data.techniques.map((t) => (
              <li key={t.id} className={`technique${t.collected ? " is-collected" : ""}`}>
                <p className="technique-category">{t.category}</p>
                <h3>{t.collected ? t.name : "Not discovered yet"}</h3>
                {t.collected ? (
                  <>
                    <p>{t.realWorld}</p>
                    <p className="technique-defence">
                      <strong>Defence:</strong> {t.defence}
                    </p>
                    <p className="technique-times">Used in {t.times} {t.times === 1 ? "call" : "calls"}</p>
                  </>
                ) : (
                  <p className="technique-hint">Try a different approach on a call to discover it.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
