// worknet.io: the professional network. Profiles show job history, manager and posts.
// Its own look (forest green, Work Sans, ring logo); the layout follows what people expect
// from a work profile site so it feels real: header card, activity, experience, side panel.
import { useEffect, useState } from "react";
import { SITES } from "./route.js";
import { seeded } from "./seeded.js";

const initials = (name) => name.split(" ").map((p) => p[0]).join("");
const profileUrl = (handle) => `${SITES.worknet}/in/${handle}`;

const AVATAR_TONES = ["#d9e6dc", "#e6dfcf", "#d6e0e8", "#eadad3", "#dfe3d0"];
const tone = (name) => AVATAR_TONES[seeded(name, 0, AVATAR_TONES.length - 1)];

function Avatar({ name, size = "md" }) {
  return (
    <span className={`wn-avatar is-${size}`} style={{ background: tone(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const Icon = {
  search: <path d="M7 12a5 5 0 110-10 5 5 0 010 10zM11 11l4 4" />,
  kudos: <path d="M5 15V8M5 8l3-6c1.5 0 2 1 2 2v3h4l-1 8H5" />,
  comment: <path d="M2 3h12v8H7l-3 3v-3H2z" />,
  share: <path d="M10 2l4 4-4 4M14 6H7a4 4 0 00-4 4v3" />,
  pin: <path d="M8 15s5-4.5 5-8.5A5 5 0 003 6.5C3 10.5 8 15 8 15zM8 8a1.6 1.6 0 100-3.2A1.6 1.6 0 008 8z" />,
  people: <path d="M6 7a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M11 7a2 2 0 100-4M12 9.6c1.6.4 2.6 2 2.6 4" />,
};
const Svg = ({ name }) => (
  <svg className="wn-icon" viewBox="0 0 16 16" aria-hidden="true">{Icon[name]}</svg>
);

function SearchBox({ query, go }) {
  const [text, setText] = useState(query);
  return (
    <form
      className="wn-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(`${SITES.worknet}/search?q=${encodeURIComponent(text.trim())}`);
      }}
    >
      <Svg name="search" />
      <label>
        <span className="visually-hidden">Search people</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search people or companies" />
      </label>
    </form>
  );
}

function PersonCard({ p, go }) {
  return (
    <li className="wn-person">
      <span className="wn-person-cover" style={{ "--hue": seeded(p.name, 0, 3) }} aria-hidden="true" />
      <Avatar name={p.name} size="lg" />
      <span className="wn-person-name">{p.name}</span>
      <span className="wn-person-headline">{p.headline}</span>
      <span className="wn-person-meta">
        <Svg name="people" />
        {seeded(p.name, 80, 640)} connections
      </span>
      <button type="button" className="wn-btn is-outline" onClick={() => go(profileUrl(p.handle))}>
        View profile
      </button>
    </li>
  );
}

function Search({ profiles, query, go }) {
  const q = query.trim().toLowerCase();
  const results = q ? profiles.filter((p) => `${p.name} ${p.headline}`.toLowerCase().includes(q)) : profiles;
  return (
    <div className="wn-search-page">
      <div className="wn-card wn-results-head">
        <h1>{q ? `People matching "${query}"` : "People you may know"}</h1>
        <p className="wn-muted">{q ? `${results.length} ${results.length === 1 ? "result" : "results"}` : "Based on people working in Dubai"}</p>
      </div>
      {results.length === 0 ? (
        <p className="wn-card wn-empty">No one matches that search. Try a company name, like Vitality.</p>
      ) : (
        <ul className="wn-people">
          {results.map((p) => (
            <PersonCard key={p.handle} p={p} go={go} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Post({ profile, post }) {
  const base = seeded(post.text, 6, 64);
  const comments = seeded(post.text + "c", 0, 9);
  const [given, setGiven] = useState(false);
  return (
    <article className="wn-post">
      <header className="wn-post-head">
        <Avatar name={profile.name} size="sm" />
        <span>
          <span className="wn-post-author">{profile.name}</span>
          <span className="wn-post-sub">{profile.headline}</span>
          <span className="wn-post-sub">{post.when}</span>
        </span>
      </header>
      <p className="wn-post-text">{post.text}</p>
      <p className="wn-post-counts">
        <span className="wn-kudos-dot" aria-hidden="true"><Svg name="kudos" /></span>
        {base + (given ? 1 : 0)} kudos
        <span className="wn-post-comments">{comments === 1 ? "1 comment" : `${comments} comments`}</span>
      </p>
      <div className="wn-post-actions">
        <button type="button" className={given ? "is-on" : ""} aria-pressed={given} onClick={() => setGiven(!given)}>
          <Svg name="kudos" /> Kudos
        </button>
        <button type="button" disabled title="Sign in to comment">
          <Svg name="comment" /> Comment
        </button>
        <button type="button" disabled title="Sign in to share">
          <Svg name="share" /> Share
        </button>
      </div>
    </article>
  );
}

function Profile({ profile, profiles, go }) {
  const [note, setNote] = useState(null);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(t);
  }, [note]);
  const manager = profile.reportsTo && profiles.find((p) => p.name === profile.reportsTo);
  const atVitality = profile.experience[0]?.company === "Vitality Logistics";
  const others = profiles.filter((p) => p.handle !== profile.handle).slice(0, 5);
  const guestOnly = () => setNote("Sign in to connect or send messages.");

  return (
    <div className="wn-profile-layout">
      <article className="wn-profile">
        <header className="wn-card wn-profile-head">
          <div className="wn-cover" style={{ "--hue": seeded(profile.name, 0, 3) }} aria-hidden="true" />
          <Avatar name={profile.name} size="xl" />
          <div className="wn-profile-body">
            <div>
              <h1>{profile.name}</h1>
              <p className="wn-headline">{profile.headline}</p>
              <p className="wn-location">
                <Svg name="pin" />
                {profile.location}
                <span className="wn-connections">{seeded(profile.name, 80, 640)} connections</span>
              </p>
              {profile.reportsTo && (
                <p className="wn-reports">
                  Reports to{" "}
                  {manager ? (
                    <button type="button" className="wn-link" onClick={() => go(profileUrl(manager.handle))}>
                      {profile.reportsTo}
                    </button>
                  ) : (
                    profile.reportsTo
                  )}
                </p>
              )}
            </div>
            {atVitality && (
              <button type="button" className="wn-company" onClick={() => go(SITES.vitality)}>
                <span className="wn-company-mark" aria-hidden="true" />
                Vitality Logistics
              </button>
            )}
          </div>
          <div className="wn-profile-actions">
            <button type="button" className="wn-btn" onClick={guestOnly}>Connect</button>
            <button type="button" className="wn-btn is-outline" onClick={guestOnly}>Message</button>
            <p className="wn-note" role="status">{note}</p>
          </div>
        </header>

        <section className="wn-card">
          <h2>Activity</h2>
          <p className="wn-muted wn-section-sub">{seeded(profile.name + "f", 40, 900)} followers</p>
          {profile.posts.map((post) => (
            <Post key={post.text} profile={profile} post={post} />
          ))}
        </section>

        <section className="wn-card">
          <h2>Experience</h2>
          <ol className="wn-jobs">
            {profile.experience.map((job) => (
              <li key={job.title}>
                <span className={`wn-job-logo${job.company === "Vitality Logistics" ? " is-vitality" : ""}`} aria-hidden="true">
                  {job.company === "Vitality Logistics" ? <span className="wn-company-mark" /> : job.company[0]}
                </span>
                <span className="wn-job-text">
                  <strong>{job.title}</strong>
                  <span>{job.company}</span>
                  <span className="wn-muted">{job.period}</span>
                </span>
              </li>
            ))}
          </ol>
          {profile.education && (
            <>
              <h2 className="wn-h2-gap">Education</h2>
              <p className="wn-edu">{profile.education}</p>
            </>
          )}
        </section>
      </article>

      <aside className="wn-card wn-side" aria-label="People also viewed">
        <h2>People also viewed</h2>
        <ul>
          {others.map((p) => (
            <li key={p.handle}>
              <button type="button" className="wn-side-person" onClick={() => go(profileUrl(p.handle))}>
                <Avatar name={p.name} size="sm" />
                <span>
                  <span className="wn-side-name">{p.name}</span>
                  <span className="wn-side-headline">{p.headline}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

export default function WorkNet({ route, osint, go }) {
  const { profiles } = osint.worknet;
  const [section, handle] = route.path;
  const query = route.params?.get("q") ?? "";
  let body;
  if (section === "in") {
    const profile = profiles.find((p) => p.handle === handle);
    body = profile ? (
      <Profile key={profile.handle} profile={profile} profiles={profiles} go={go} />
    ) : (
      <p className="wn-card wn-empty">This profile doesn't exist or has been removed.</p>
    );
  } else {
    body = <Search profiles={profiles} query={query} go={go} />;
  }

  return (
    <div className="site-worknet">
      <header className="wn-header">
        <div className="wn-header-inner">
          <button type="button" className="wn-logo" onClick={() => go(SITES.worknet)}>
            <span className="wn-logo-mark" aria-hidden="true" />
            <span className="wn-logo-word">worknet</span>
          </button>
          <SearchBox key={query} query={query} go={go} />
          <span className="wn-guest">Guest</span>
        </div>
      </header>
      <main className="wn-main">{body}</main>
    </div>
  );
}
