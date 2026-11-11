// vitality-logistics.ae: a believable, slightly boring corporate site (light theme).
import { useEffect } from "react";
import { SITES } from "./route.js";
import { discoverContacts } from "../phone/contacts.js";

const PAGES = [
  ["", "Home"],
  ["about", "About"],
  ["team", "Our team"],
  ["careers", "Careers"],
  ["news", "News"],
  ["contact", "Contact"],
];

const initials = (name) => name.split(" ").map((p) => p[0]).join("");

function Home({ page, go }) {
  return (
    <>
      <section className="vl-hero">
        <div className="vl-hero-text">
          <h1>{page.tagline}</h1>
          <p>Sea, road and air freight across the GCC, handled from Dubai since 2009.</p>
          <button type="button" className="vl-cta" onClick={() => go(`${SITES.vitality}/contact`)}>
            Request a quote
          </button>
        </div>
        <div className="vl-hero-art" role="img" aria-label={page.hero.alt}>
          <span className="vl-crate is-a" />
          <span className="vl-crate is-b" />
          <span className="vl-crate is-c" />
          <span className="vl-crate is-d" />
          <span className="vl-hull" />
        </div>
      </section>
      <ul className="vl-stats">
        {page.stats.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </>
  );
}

function Team({ page }) {
  return (
    <section className="vl-section">
      <h2>{page.title}</h2>
      <p className="vl-lead">The people who keep the Gulf moving.</p>
      <ul className="vl-team">
        {page.members.map((m) => (
          <li key={m.name}>
            <span className="vl-avatar" aria-hidden="true">{initials(m.name)}</span>
            <span className="vl-member-name">{m.name}</span>
            <span className="vl-member-role">{m.role}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Simple({ page, list }) {
  return (
    <section className="vl-section">
      <h2>{page.title}</h2>
      {page.paragraphs?.map((p) => <p key={p}>{p}</p>)}
      {list && <ul className="vl-list">{list}</ul>}
    </section>
  );
}

function Contact({ page }) {
  // Visiting this page saves its numbers to the player's phone contacts.
  useEffect(() => {
    discoverContacts(page.phones.map((p) => ({ name: `Vitality: ${p.label}`, number: p.number })));
  }, [page]);
  return (
    <section className="vl-section">
      <h2>{page.title}</h2>
      <p>{page.address}</p>
      {page.hours && <p>{page.hours}</p>}
      <dl className="vl-phones">
        {page.phones.map((p) => (
          <div key={p.number}>
            <dt>{p.label}</dt>
            <dd>{p.number}</dd>
          </div>
        ))}
        <div>
          <dt>Email</dt>
          <dd>{page.email}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function VitalitySite({ route, osint, go }) {
  const { pages } = osint.website;
  const current = route.path[0] ?? "";
  let body;
  if (current === "") body = <Home page={pages.home} go={go} />;
  else if (current === "team") body = <Team page={pages.team} />;
  else if (current === "about") body = <Simple page={pages.about} />;
  else if (current === "careers") body = <Simple page={pages.careers} list={pages.careers.openings.map((o) => <li key={o}>{o}</li>)} />;
  else if (current === "news")
    body = (
      <Simple
        page={pages.news}
        list={pages.news.items.map((n) => (
          <li key={n.headline} className="vl-news">
            <span className="vl-news-date">{n.date}</span>
            <strong>{n.headline}</strong>
            <span>{n.text}</span>
          </li>
        ))}
      />
    );
  else if (current === "contact") body = <Contact page={pages.contact} />;
  else body = <section className="vl-section"><h2>Page not found</h2><p>This page doesn't exist on our site.</p></section>;

  return (
    <div className="site-vitality">
      <header className="vl-header">
        <button type="button" className="vl-logo" onClick={() => go(SITES.vitality)}>
          <span className="vl-logo-mark" aria-hidden="true" />
          Vitality <span>Logistics</span>
        </button>
        <nav className="vl-nav" aria-label="Vitality Logistics">
          {PAGES.slice(1).map(([path, label]) => (
            <button key={path} type="button" className={current === path ? "is-current" : ""} onClick={() => go(`${SITES.vitality}/${path}`)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="vl-main">{body}</main>
      <footer className="vl-footer">© 2026 Vitality Logistics LLC. Business Bay, Dubai. A fictional company.</footer>
    </div>
  );
}
