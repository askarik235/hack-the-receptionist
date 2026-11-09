// worknet.io: the professional network. Profiles show job history, manager and posts.
import { useState } from "react";
import { SITES } from "./route.js";

const initials = (name) => name.split(" ").map((p) => p[0]).join("");
const profileUrl = (handle) => `${SITES.worknet}/in/${handle}`;

function Search({ profiles, query, go }) {
  const [text, setText] = useState(query);
  const q = query.trim().toLowerCase();
  const results = q ? profiles.filter((p) => `${p.name} ${p.headline}`.toLowerCase().includes(q)) : profiles;
  return (
    <div className="wn-search-page">
      <form
        className="wn-search"
        onSubmit={(e) => {
          e.preventDefault();
          go(`${SITES.worknet}/search?q=${encodeURIComponent(text.trim())}`);
        }}
      >
        <label>
          <span className="visually-hidden">Search people</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search people or companies" />
        </label>
        <button type="submit">Search</button>
      </form>
      <h2 className="wn-results-title">{q ? `People matching "${query}"` : "People you may know"}</h2>
      {results.length === 0 && <p className="wn-empty">No one matches that search. Try a company name.</p>}
      <ul className="wn-results">
        {results.map((p) => (
          <li key={p.handle}>
            <button type="button" className="wn-result" onClick={() => go(profileUrl(p.handle))}>
              <span className="wn-avatar is-small" aria-hidden="true">{initials(p.name)}</span>
              <span>
                <span className="wn-result-name">{p.name}</span>
                <span className="wn-result-headline">{p.headline}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Profile({ profile, profiles, go }) {
  const manager = profile.reportsTo && profiles.find((p) => p.name === profile.reportsTo);
  return (
    <article className="wn-profile">
      <header className="wn-card wn-profile-head">
        <div className="wn-cover" aria-hidden="true" />
        <span className="wn-avatar" aria-hidden="true">{initials(profile.name)}</span>
        <h1>{profile.name}</h1>
        <p className="wn-headline">{profile.headline}</p>
        <p className="wn-location">{profile.location}</p>
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
      </header>

      <section className="wn-card">
        <h2>Activity</h2>
        {profile.posts.map((post) => (
          <div key={post.text} className="wn-post">
            <span className="wn-post-when">{post.when} ago</span>
            <p>{post.text}</p>
          </div>
        ))}
      </section>

      <section className="wn-card">
        <h2>Experience</h2>
        {profile.experience.map((job) => (
          <div key={job.title} className="wn-job">
            <strong>{job.title}</strong>
            <span>{job.company}</span>
            <span className="wn-muted">{job.period}</span>
          </div>
        ))}
        {profile.education && (
          <>
            <h2>Education</h2>
            <p>{profile.education}</p>
          </>
        )}
      </section>
    </article>
  );
}

export default function WorkNet({ route, osint, go }) {
  const { profiles } = osint.worknet;
  const [section, handle] = route.path;
  let body;
  if (section === "in") {
    const profile = profiles.find((p) => p.handle === handle);
    body = profile ? (
      <Profile profile={profile} profiles={profiles} go={go} />
    ) : (
      <p className="wn-empty">This profile doesn't exist or has been removed.</p>
    );
  } else {
    body = <Search profiles={profiles} query={route.params?.get("q") ?? ""} go={go} />;
  }

  return (
    <div className="site-worknet">
      <header className="wn-header">
        <button type="button" className="wn-logo" onClick={() => go(SITES.worknet)}>
          <span className="wn-logo-mark" aria-hidden="true" />
          worknet
        </button>
        <span className="wn-tagline">Your career, connected</span>
      </header>
      <main className="wn-main">{body}</main>
    </div>
  );
}
