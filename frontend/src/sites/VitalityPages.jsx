// vitality-logistics.ae: the About us, Our team and Careers pages. Freight-yard look: trucks,
// tracking steps, shipping containers and a departure board. Motion runs once and stops for
// people who ask for reduced motion.
import { useEffect, useRef, useState } from "react";
import { SITES } from "./route.js";
import { useDubaiTime } from "../os/useDubaiTime.js";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// True once the element has scrolled into view (and stays true).
function useReveal(threshold = 0.2) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return undefined;
    if (!("IntersectionObserver" in window) || reducedMotion()) {
      setShown(true);
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShown(true);
        io.disconnect();
      }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, threshold]);
  return [ref, shown];
}

const initials = (name) => name.split(" ").map((p) => p[0]).join("");

/* ---------------- About us ---------------- */

function CountUp({ value, run }) {
  const [shown, setShown] = useState(value < 1000 ? 0 : value); // years don't count up
  useEffect(() => {
    if (!run || value >= 1000) return undefined;
    if (reducedMotion()) {
      setShown(value);
      return undefined;
    }
    let frame;
    const start = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - start) / 1400);
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, value]);
  return shown;
}

function Figures({ figures }) {
  const [ref, shown] = useReveal(0.4);
  return (
    <ul ref={ref} className="vla-figures">
      {figures.map((f) => (
        <li key={f.label}>
          <strong aria-label={`${f.value}${f.suffix}`}>
            <span aria-hidden="true">
              <CountUp value={f.value} run={shown} />
              {f.suffix}
            </span>
          </strong>
          <span>{f.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Truck() {
  const wheel = (cx) => (
    <g className="vla-wheel" key={cx}>
      <circle cx={cx} cy="112" r="13" fill="#1d2833" />
      <circle cx={cx} cy="112" r="6" fill="#9fb0bd" />
      <path d={`M${cx - 6} 112h12M${cx} 106v12`} stroke="#1d2833" strokeWidth="2" />
    </g>
  );
  return (
    <svg className="vla-truck" viewBox="0 0 330 130" aria-hidden="true">
      {/* trailer: a ribbed shipping container */}
      <rect x="10" y="22" width="214" height="78" rx="2" fill="#c8553d" />
      <g stroke="#a8432f" strokeWidth="3">
        {Array.from({ length: 17 }, (_, i) => (
          <path key={i} d={`M${22 + i * 12} 28v66`} />
        ))}
      </g>
      <rect x="10" y="22" width="214" height="6" fill="#d9705a" />
      <text x="117" y="69" textAnchor="middle" className="vla-truck-word">VITALITY</text>
      <rect x="8" y="100" width="222" height="6" fill="#2a3540" />
      {/* cab */}
      <path d="M236 48h46l26 26v32h-72z" fill="#0f3057" />
      <path d="M246 56h32l18 18h-50z" fill="#bfe3ef" />
      <rect x="236" y="98" width="72" height="8" fill="#2a3540" />
      <rect x="300" y="88" width="10" height="6" rx="1" fill="#f5c36a" />
      {[48, 76, 186, 212, 286].map(wheel)}
    </svg>
  );
}

function Cranes() {
  // Port cranes on the horizon, behind the road.
  const crane = (x, h) => (
    <g key={x} fill="none" stroke="#7d98ab" strokeWidth="3">
      <path d={`M${x} 120V${120 - h}M${x + 26} 120V${120 - h}M${x} ${120 - h}h26M${x - 30} ${126 - h}h110M${x + 4} ${120 - h * 0.5}l18 -16`} />
      <path d={`M${x + 70} ${126 - h}v18`} strokeWidth="2" />
    </g>
  );
  return (
    <svg className="vla-cranes" viewBox="0 0 900 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {crane(90, 78)}
      {crane(330, 92)}
      {crane(560, 70)}
      {crane(790, 86)}
      <path d="M180 120h60v-22h-60zM620 120h80v-16h-80z" fill="#9db3c2" />
    </svg>
  );
}

function Story({ steps }) {
  const [ref, shown] = useReveal(0.25);
  return (
    <ol ref={ref} className={`vla-track${shown ? " is-in" : ""}`} style={{ "--steps": steps.length }}>
      {steps.map((s, i) => (
        <li key={s.year} style={{ "--i": i }} className={i === steps.length - 1 ? "is-now" : ""}>
          <span className="vla-track-dot" aria-hidden="true" />
          <span className="vla-track-year">{s.year}</span>
          <span className="vla-track-status">{s.status}</span>
          <p>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

const MODE_ICONS = {
  sea: <path d="M4 26l4 8h32l4-8zM10 26V18h12v8M24 26V14h10v12M6 40c3 0 3-2 6-2s3 2 6 2 3-2 6-2 3 2 6 2 3-2 6-2 3 2 6 2" />,
  road: <path d="M4 14h24v18H4zM28 20h9l7 7v5H28zM6 36a4 4 0 108 0 4 4 0 10-8 0M30 36a4 4 0 108 0 4 4 0 10-8 0" />,
  air: <path d="M6 26l14-2 10-14h5l-5 14 12-1 4-5h3l-2 8 2 8h-3l-4-5-12-1 5 14h-5L20 30 6 28z" />,
  warehouse: <path d="M4 18L24 8l20 10v24H4zM12 42V26h24v16M12 32h24M12 37h24" />,
};

function Services({ services }) {
  const [ref, shown] = useReveal(0.1);
  return (
    <ul ref={ref} className={`vla-services${shown ? " is-in" : ""}`}>
      {services.map((s, i) => (
        <li key={s.mode} style={{ "--i": i }}>
          <svg viewBox="0 0 48 48" aria-hidden="true">{MODE_ICONS[s.mode]}</svg>
          <h3>{s.name}</h3>
          <p>{s.text}</p>
        </li>
      ))}
    </ul>
  );
}

function SiteArt({ kind }) {
  if (kind === "office") {
    return (
      <svg className="vla-site-art" viewBox="0 0 200 120" aria-hidden="true">
        <rect x="70" y="10" width="60" height="110" fill="#0f3057" />
        <g fill="#bfe3ef">
          {Array.from({ length: 12 }, (_, r) =>
            [78, 96, 114].map((x) => <rect key={`${r}-${x}`} x={x} y={18 + r * 8} width="10" height="4" className={r === 1 ? "is-lit" : ""} />)
          )}
        </g>
        <rect x="20" y="62" width="44" height="58" fill="#5b7c99" />
        <rect x="136" y="48" width="46" height="72" fill="#5b7c99" />
      </svg>
    );
  }
  return (
    <svg className="vla-site-art" viewBox="0 0 200 120" aria-hidden="true">
      <path d="M10 50l90-30 90 30v70H10z" fill="#5b7c99" />
      <g fill="#dbe5ec">
        <rect x="30" y="70" width="40" height="50" />
        <rect x="80" y="70" width="40" height="50" />
        <rect x="130" y="70" width="40" height="50" />
      </g>
      <g stroke="#b6c5d1" strokeWidth="2">
        {Array.from({ length: 9 }, (_, i) => (
          <path key={i} d={`M30 ${75 + i * 5}h140`} />
        ))}
      </g>
      <rect x="132" y="96" width="36" height="24" fill="#00897f" />
      <rect x="138" y="80" width="30" height="16" fill="#e2a03f" />
    </svg>
  );
}

export function About({ page }) {
  return (
    <div className="vla">
      <section className="vla-hero">
        <div className="vla-hero-text">
          <h2>{page.title}</h2>
          {page.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        <div className="vla-road" role="img" aria-label="A Vitality Logistics container truck driving past the port cranes">
          <Cranes />
          <div className="vla-tarmac">
            <span className="vla-lanes" />
          </div>
          <Truck />
        </div>
      </section>

      <Figures figures={page.figures} />

      <section className="vla-block">
        <h2>Our story</h2>
        <Story steps={page.story} />
      </section>

      <section className="vla-block">
        <h2>What we move</h2>
        <Services services={page.services} />
      </section>

      <section className="vla-block">
        <h2>Where we work</h2>
        <ul className="vla-sites">
          {page.sites.map((s) => (
            <li key={s.name}>
              <SiteArt kind={s.kind} />
              <div>
                <h3>{s.name}</h3>
                <p className="vla-site-place">{s.place}</p>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------- Our team ---------------- */

const BOX_COLOURS = ["navy", "rust", "sea", "amber", "steel", "teal"];

function Container({ group, index }) {
  const [ref, shown] = useReveal(0.15);
  const id = `vlt-${group.department.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section ref={ref} id={id} className={`vlt-box is-${BOX_COLOURS[index % BOX_COLOURS.length]}${shown ? " is-in" : ""}`} aria-labelledby={`${id}-title`}>
      <header className="vlt-box-head">
        <h3 id={`${id}-title`}>{group.department}</h3>
        <span className="vlt-box-code" aria-hidden="true">VLTU {String(204100 + index * 37).padStart(6, "0")}</span>
        <span className="vlt-box-count">{group.members.length === 1 ? "1 person" : `${group.members.length} people`}</span>
      </header>
      <ul className="vlt-tags">
        {group.members.map((m, i) => (
          <li key={m.name} className="vlt-tag" style={{ "--i": i }}>
            <span className="vlt-tag-hole" aria-hidden="true" />
            <span className="vlt-tag-mono" aria-hidden="true">{initials(m.name)}</span>
            <span className="vlt-tag-name">{m.name}</span>
            <span className="vlt-tag-role">{m.role}</span>
            <p className="vlt-tag-bio">{m.bio}</p>
            <span className="vlt-tag-site">
              <svg viewBox="0 0 12 16" aria-hidden="true"><path d="M6 15s5-5.5 5-9A5 5 0 001 6c0 3.5 5 9 5 9z" /><circle cx="6" cy="6" r="1.8" /></svg>
              {m.site}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Team({ page }) {
  const groups = [];
  for (const m of page.members) {
    let group = groups.find((g) => g.department === m.department);
    if (!group) groups.push((group = { department: m.department, members: [] }));
    group.members.push(m);
  }
  const jump = (department) => {
    const el = document.getElementById(`vlt-${department.toLowerCase().replace(/\W+/g, "-")}`);
    el?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  };
  return (
    <section className="vlt">
      <header className="vlt-head">
        <h2>{page.title}</h2>
        <p className="vl-lead">{page.intro}</p>
        <nav className="vlt-chips" aria-label="Departments">
          {groups.map((g) => (
            <button key={g.department} type="button" onClick={() => jump(g.department)}>
              {g.department}
              <span>{g.members.length}</span>
            </button>
          ))}
        </nav>
      </header>
      {groups.map((g, i) => (
        <Container key={g.department} group={g} index={i} />
      ))}
    </section>
  );
}

/* ---------------- Careers ---------------- */

const FLAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Departure-board letters: each one flicks through random letters before it settles.
function Flap({ text, delay = 0 }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? text : text.replace(/\S/g, " ")));
  useEffect(() => {
    if (reducedMotion()) {
      setShown(text);
      return undefined;
    }
    let frame;
    const start = performance.now() + delay;
    const tick = (t) => {
      const settled = Math.floor(Math.max(0, t - start) / 35);
      setShown(
        [...text]
          .map((c, i) => (c === " " || i < settled ? c : t < start ? " " : FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)]))
          .join("")
      );
      if (settled < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, delay]);
  return (
    <span className="vlc-flap" aria-label={text}>
      {shown.split(" ").map((word, w) => (
        <span key={w} className="vlc-flap-word" aria-hidden="true">
          {[...word].map((c, i) => (
            <span key={i} className="vlc-flap-cell">{c === " " ? " " : c}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

export function Careers({ page, go }) {
  const [site, setSite] = useState("all");
  const [openTitle, setOpenTitle] = useState(null);
  const time = useDubaiTime();
  const sites = [...new Set(page.openings.map((o) => o.location))];
  const rows = page.openings.filter((o) => site === "all" || o.location === site);
  const openCount = page.openings.filter((o) => o.status === "open").length;
  const count = (where) => page.openings.filter((o) => o.status === "open" && (where === "all" || o.location === where)).length;

  return (
    <section className="vlc">
      <h2>{page.title}</h2>
      <p className="vl-lead">{page.intro}</p>

      <div className="vlc-filter" role="group" aria-label="Filter by site">
        {["all", ...sites].map((s) => (
          <button key={s} type="button" aria-pressed={site === s} onClick={() => setSite(s)}>
            {s === "all" ? "All sites" : s}
            <span>{count(s)}</span>
          </button>
        ))}
      </div>

      <div className="vlc-board">
        <div className="vlc-board-top">
          <span className="vlc-board-title">Vacancies</span>
          <span className="vlc-board-meta">{openCount} open</span>
          <span className="vlc-board-clock" aria-label={`Dubai time ${time}`}>{time}</span>
        </div>
        <div className="vlc-row is-head" aria-hidden="true">
          <span>Role</span>
          <span>Site</span>
          <span>Type</span>
          <span>Status</span>
        </div>
        <ul className="vlc-rows">
          {rows.map((o, i) => {
            const open = openTitle === o.title;
            const panelId = `vlc-${o.title.toLowerCase().replace(/\W+/g, "-")}`;
            return (
              <li key={o.title} className={`vlc-item${open ? " is-open" : ""}${o.status === "closed" ? " is-closed" : ""}`}>
                <button type="button" className="vlc-row" aria-expanded={open} aria-controls={panelId} onClick={() => setOpenTitle(open ? null : o.title)}>
                  <span className="vlc-role"><Flap text={o.title.toUpperCase()} delay={i * 140} /></span>
                  <span className="vlc-site">{o.location}</span>
                  <span className="vlc-type">{o.type}</span>
                  <span className={`vlc-status is-${o.status}`}>{o.status === "open" ? "Hiring" : "Closed"}</span>
                  <svg className="vlc-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
                </button>
                <div id={panelId} className="vlc-panel" hidden={!open}>
                  <p>{o.summary}</p>
                  <ul>
                    {o.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  {o.status === "open" ? (
                    <button type="button" className="vl-cta" onClick={() => go(`${SITES.vitality}/contact`)}>
                      Apply for this role
                    </button>
                  ) : (
                    <p className="vlc-closed-note">Applications are closed for now.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {page.guide && (
        <p className="vl-guide">
          <button type="button" className="vl-file-link" onClick={() => go(page.guide.url)}>
            <span className="vl-file-badge" aria-hidden="true">PDF</span>
            {page.guide.label}
          </button>
        </p>
      )}
    </section>
  );
}
