// pixa.photos: the photo app. Public accounts show a grid; posts show caption and comments.
// Its own look (sunshine yellow, Nunito, pill logo) and its own reaction: a sun, not a heart.
import { useEffect, useRef, useState } from "react";
import { SITES } from "./route.js";
import { seeded } from "./seeded.js";

const accountUrl = (handle) => `${SITES.pixa}/${handle}`;
const postUrl = (handle, id) => `${SITES.pixa}/${handle}/p/${id}`;

// Drawn stand-ins, used when a post has no real photo or it fails to load. Badges are drawn so
// their numbers are readable.
const SCENES = {
  kingfish: { glyph: "🐟", tone: "sea" },
  "warehouse-sunset": { glyph: "🌇", tone: "dusk" },
  shawarma: { glyph: "🌯", tone: "lunch" },
  biscuit: { glyph: "🐈", tone: "lunch" },
  karak: { glyph: "☕", tone: "dusk" },
  "new-city": { glyph: "🏙️", tone: "dusk" },
  "first-coffee": { glyph: "☕", tone: "lunch" },
};

// A staff badge. A turned badge shows its back, so nothing on it can be read.
function Badge({ badge }) {
  if (badge.turned) {
    return (
      <div className="px-badge is-turned">
        <span className="px-badge-strap" />
        <span className="px-badge-stripe" />
        <span className="px-badge-back">If found, please return to reception</span>
      </div>
    );
  }
  return (
    <div className="px-badge">
      <span className="px-badge-strap" />
      <span className="px-badge-company">Vitality Logistics</span>
      <span className="px-badge-face" />
      <span className={`px-badge-name${badge.blurName ? " is-blurred" : ""}`}>{badge.name}</span>
      <span className="px-badge-role">{badge.role}</span>
      <span className="px-badge-id">{badge.employeeId}</span>
    </div>
  );
}

// The real photo when there is one; the drawn stand-in below if it is missing or fails to load.
function Photo({ post, large = false }) {
  const [failed, setFailed] = useState(false);
  if (post.image && !failed) {
    return (
      <img
        className={`px-photo is-real${large ? " is-large" : ""}`}
        src={`/${post.image}`}
        alt={post.alt}
        draggable="false"
        loading={large ? "eager" : "lazy"}
        onError={() => setFailed(true)}
      />
    );
  }
  return <DrawnPhoto post={post} large={large} />;
}

function DrawnPhoto({ post, large }) {
  const size = large ? " is-large" : "";
  const badges = post.badges ?? [];
  // The alt text describes everything, so the drawing itself is hidden from screen readers.
  if (badges.length === 1) {
    return (
      <div className={`px-photo is-desk${size}`} role="img" aria-label={post.alt}>
        <div aria-hidden="true" className="px-desk-badge">
          <Badge badge={badges[0]} />
        </div>
      </div>
    );
  }
  if (badges.length > 1) {
    return (
      <div className={`px-photo is-office${size}`} role="img" aria-label={post.alt}>
        <div className="px-selfie" aria-hidden="true">
          {badges.map((badge, i) => (
            // People in a photo never move or reorder, so their position is a stable key.
            <div className="px-person" key={i}>
              <span className="px-head" />
              <span className="px-body">
                <Badge badge={badge} />
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const scene = SCENES[post.id] ?? { glyph: "📷", tone: "plain" };
  return (
    <div className={`px-photo is-${scene.tone}${size}`} role="img" aria-label={post.alt}>
      <span className="px-glyph" aria-hidden="true">{scene.glyph}</span>
    </div>
  );
}

const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

const Icon = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  comment: <path d="M4 5h16v11H9l-5 4z" />,
  send: <path d="M3 11l18-8-7 18-3-7zM11 14l10-11" />,
  save: <path d="M6 3h12v18l-6-4-6 4z" />,
  grid: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  tag: <path d="M3 12V3h9l9 9-9 9zM7.5 7.5h.01" />,
  prev: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  search: <path d="M10.5 17a6.5 6.5 0 110-13 6.5 6.5 0 010 13zM15.5 15.5L21 21" />,
};
const Svg = ({ name, className = "px-icon" }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{Icon[name]}</svg>
);

function Ring({ letter, size = "md" }) {
  return (
    <span className={`px-ring is-${size}`} aria-hidden="true">
      <span>{letter}</span>
    </span>
  );
}

function Handle({ handle, go }) {
  return (
    <button type="button" className="px-handle" onClick={() => go(accountUrl(handle))}>
      {handle}
    </button>
  );
}

function SearchBox({ go }) {
  const [text, setText] = useState("");
  return (
    <form
      className="px-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const handle = text.trim().replace(/^@/, "").toLowerCase();
        if (handle) go(accountUrl(handle));
      }}
    >
      <Svg name="search" />
      <label>
        <span className="visually-hidden">Find an account</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find an account, like @name" />
      </label>
    </form>
  );
}

function Explore({ accounts, go }) {
  return (
    <div className="px-explore">
      <ul className="px-stories" aria-label="Accounts">
        {accounts.map((a) => (
          <li key={a.handle}>
            <button type="button" onClick={() => go(accountUrl(a.handle))}>
              <Ring letter={a.displayName[0]} size="lg" />
              <span>{a.handle}</span>
            </button>
          </li>
        ))}
      </ul>
      <h2>Popular around Dubai</h2>
      <ul className="px-suggested">
        {accounts.map((a) => (
          <li key={a.handle}>
            <button type="button" className="px-suggest" onClick={() => go(accountUrl(a.handle))}>
              <Ring letter={a.displayName[0]} />
              <span className="px-suggest-text">
                <span className="px-suggest-handle">@{a.handle}</span>
                <span className="px-suggest-bio">{a.bio}</span>
              </span>
              <span className="px-suggest-go">See photos</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Account({ account, go }) {
  const [following, setFollowing] = useState(false);
  const [tab, setTab] = useState("posts");
  const followers = seeded(account.handle, 140, 2400) + (following ? 1 : 0);
  return (
    <div className="px-account">
      <header className="px-profile">
        <Ring letter={account.displayName[0]} size="xl" />
        <div className="px-profile-text">
          <div className="px-profile-top">
            <h1>{account.handle}</h1>
            <button type="button" className={`px-btn${following ? " is-quiet" : ""}`} aria-pressed={following} onClick={() => setFollowing(!following)}>
              {following ? "Following" : "Follow"}
            </button>
          </div>
          <ul className="px-stats">
            <li><strong>{account.posts.length}</strong> posts</li>
            <li><strong>{compact(followers)}</strong> followers</li>
            <li><strong>{seeded(account.handle + "f", 90, 700)}</strong> following</li>
          </ul>
          <p className="px-name">{account.displayName}</p>
          <p className="px-bio">{account.bio}</p>
        </div>
      </header>

      <div className="px-tabs" role="tablist" aria-label="Photos">
        <button type="button" role="tab" aria-selected={tab === "posts"} onClick={() => setTab("posts")}>
          <Svg name="grid" /> Posts
        </button>
        <button type="button" role="tab" aria-selected={tab === "tagged"} onClick={() => setTab("tagged")}>
          <Svg name="tag" /> Tagged
        </button>
      </div>

      {tab === "posts" ? (
        <ul className="px-grid">
          {account.posts.map((post) => (
            <li key={post.id}>
              <button type="button" className="px-tile" onClick={() => go(postUrl(account.handle, post.id))} aria-label={`Open post: ${post.caption}`}>
                <Photo post={post} />
                <span className="px-tile-hover" aria-hidden="true">
                  <span><Svg name="sun" /> {seeded(post.id, 12, 180)}</span>
                  <span><Svg name="comment" /> {post.comments.length}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-empty">No photos of @{account.handle} yet.</p>
      )}
    </div>
  );
}

function Post({ account, post, go }) {
  const [shone, setShone] = useState(false);
  const [burst, setBurst] = useState(0);
  const [saved, setSaved] = useState(false);
  const index = account.posts.indexOf(post);
  const prev = account.posts[index - 1];
  const next = account.posts[index + 1];
  const suns = seeded(post.id, 12, 180) + (shone ? 1 : 0);
  const shine = () => {
    setShone(true);
    setBurst((n) => n + 1);
  };

  // Zoom: click the photo to zoom in where you clicked, move to look around, click again to
  // zoom out. A short wait tells a click from a double-click (which gives a sun instead).
  // Keyboard: the Zoom button, then the arrow keys to look around.
  const [zoom, setZoom] = useState(null); // { x, y } in percent, or null
  const clickTimer = useRef(null);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const spot = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v) => Math.min(100, Math.max(0, v));
    return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
  };
  const onPhotoClick = (e) => {
    if (e.target.closest("button")) return;
    const at = spot(e);
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => setZoom((z) => (z ? null : at)), 220);
  };
  const onPhotoDoubleClick = (e) => {
    if (e.target.closest("button")) return;
    clearTimeout(clickTimer.current);
    shine();
  };
  const onPhotoMove = (e) => {
    if (zoom) setZoom(spot(e));
  };
  const onPhotoKey = (e) => {
    const step = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
    if (!zoom || !step) return;
    e.preventDefault();
    setZoom((z) => ({ x: Math.min(100, Math.max(0, z.x + step[0])), y: Math.min(100, Math.max(0, z.y + step[1])) }));
  };

  return (
    <article className="px-post">
      <div
        className={`px-post-photo${zoom ? " is-zoomed" : ""}`}
        onClick={onPhotoClick}
        onDoubleClick={onPhotoDoubleClick}
        onMouseMove={onPhotoMove}
        onKeyDown={onPhotoKey}
      >
        <div className="px-zoom" style={zoom ? { transform: "scale(2.6)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}>
          <Photo post={post} large />
        </div>
        <button type="button" className="px-zoom-btn" aria-pressed={Boolean(zoom)} onClick={() => setZoom((z) => (z ? null : { x: 50, y: 50 }))}>
          <Svg name="search" /> {zoom ? "Zoom out" : "Zoom"}
        </button>
        {burst > 0 && (
          <span key={burst} className="px-burst" aria-hidden="true">
            <Svg name="sun" className="px-burst-sun" />
          </span>
        )}
        {prev && (
          <button type="button" className="px-step is-prev" onClick={() => go(postUrl(account.handle, prev.id))} aria-label="Previous post">
            <Svg name="prev" />
          </button>
        )}
        {next && (
          <button type="button" className="px-step is-next" onClick={() => go(postUrl(account.handle, next.id))} aria-label="Next post">
            <Svg name="next" />
          </button>
        )}
      </div>

      <div className="px-post-side">
        <header className="px-post-head">
          <Ring letter={account.displayName[0]} size="sm" />
          <Handle handle={account.handle} go={go} />
        </header>
        <div className="px-post-thread">
          <p className="px-caption">
            <Handle handle={account.handle} go={go} /> {post.caption}
          </p>
          {post.comments.length === 0 && <p className="px-no-comments">No comments yet.</p>}
          <ul className="px-comments">
            {post.comments.map((c) => (
              <li key={c.handle + c.text}>
                <Ring letter={c.handle[0].toUpperCase()} size="xs" />
                <p>
                  <Handle handle={c.handle} go={go} /> {c.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-post-actions">
          <button type="button" className={`px-act${shone ? " is-on" : ""}`} aria-pressed={shone} onClick={() => (shone ? setShone(false) : shine())} aria-label="Give a sun">
            <Svg name="sun" />
          </button>
          <button type="button" className="px-act" disabled aria-label="Comment (log in to comment)">
            <Svg name="comment" />
          </button>
          <button type="button" className="px-act" disabled aria-label="Send (log in to send)">
            <Svg name="send" />
          </button>
          <button type="button" className={`px-act is-end${saved ? " is-on" : ""}`} aria-pressed={saved} onClick={() => setSaved(!saved)} aria-label="Save">
            <Svg name="save" />
          </button>
        </div>
        <p className="px-suns">{suns} suns</p>
        <p className="px-hint">Click the photo to zoom in. Double-click to give it a sun. Log in to comment.</p>
        <button type="button" className="px-back" onClick={() => go(accountUrl(account.handle))}>
          More from @{account.handle}
        </button>
      </div>
    </article>
  );
}

export default function Pixa({ route, osint, go }) {
  const { accounts } = osint.pixa;
  const [handle, kind, postId] = route.path;
  const account = handle && accounts.find((a) => a.handle === handle);

  let body;
  if (!handle) body = <Explore accounts={accounts} go={go} />;
  else if (!account)
    body = (
      <div className="px-private">
        <Ring letter={handle[0]?.toUpperCase()} size="xl" />
        <h1>@{handle}</h1>
        <p>This account is private. Only approved followers can see its photos.</p>
      </div>
    );
  else if (kind === "p") {
    const post = account.posts.find((p) => p.id === postId);
    body = post ? <Post key={post.id} account={account} post={post} go={go} /> : <Account account={account} go={go} />;
  } else body = <Account account={account} go={go} />;

  return (
    <div className="site-pixa">
      <header className="px-header">
        <div className="px-header-inner">
          <button type="button" className="px-logo" onClick={() => go(SITES.pixa)}>
            pixa
          </button>
          <SearchBox go={go} />
        </div>
      </header>
      <main className="px-main">{body}</main>
    </div>
  );
}
