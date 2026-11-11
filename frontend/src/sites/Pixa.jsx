// pixa.photos: the photo app. Public accounts show a grid; posts show caption and comments.
import { useState } from "react";
import { SITES } from "./route.js";

const accountUrl = (handle) => `${SITES.pixa}/${handle}`;
const postUrl = (handle, id) => `${SITES.pixa}/${handle}/p/${id}`;

// Stand-in "photos" until real images exist. The badge is drawn so its number is readable.
const SCENES = {
  kingfish: { glyph: "🐟", tone: "sea" },
  "warehouse-sunset": { glyph: "🌇", tone: "dusk" },
  shawarma: { glyph: "🌯", tone: "lunch" },
  biscuit: { glyph: "🐈", tone: "lunch" },
  karak: { glyph: "☕", tone: "dusk" },
};

function Photo({ post, large = false }) {
  if (post.id === "badge") {
    return (
      <div className={`px-photo is-desk${large ? " is-large" : ""}`} role="img" aria-label={post.alt}>
        <div className="px-badge">
          <span className="px-badge-strap" aria-hidden="true" />
          <span className="px-badge-company">Vitality Logistics</span>
          <span className="px-badge-face" aria-hidden="true" />
          <span className="px-badge-name" aria-hidden="true">Timur Bekov</span>
          <span className="px-badge-role">Operations</span>
          <span className="px-badge-id">VL-0412</span>
        </div>
      </div>
    );
  }
  const scene = SCENES[post.id] ?? { glyph: "📷", tone: "plain" };
  return (
    <div className={`px-photo is-${scene.tone}${large ? " is-large" : ""}`} role="img" aria-label={post.alt}>
      <span className="px-glyph" aria-hidden="true">{scene.glyph}</span>
    </div>
  );
}

function Handle({ handle, go }) {
  return (
    <button type="button" className="px-handle" onClick={() => go(accountUrl(handle))}>
      {handle}
    </button>
  );
}

function Explore({ accounts, go }) {
  const [text, setText] = useState("");
  return (
    <div className="px-explore">
      <form
        className="px-search"
        onSubmit={(e) => {
          e.preventDefault();
          const handle = text.trim().replace(/^@/, "").toLowerCase();
          if (handle) go(accountUrl(handle));
        }}
      >
        <label>
          <span className="visually-hidden">Find an account</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find an account, like @name" />
        </label>
      </form>
      <h2>Popular around Dubai</h2>
      <ul className="px-suggested">
        {accounts.map((a) => (
          <li key={a.handle}>
            <button type="button" onClick={() => go(accountUrl(a.handle))}>
              <span className="px-ring" aria-hidden="true">{a.displayName[0]}</span>
              <span>@{a.handle}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Account({ account, go }) {
  return (
    <div className="px-account">
      <header className="px-profile">
        <span className="px-ring is-large" aria-hidden="true">{account.displayName[0]}</span>
        <div>
          <h1>@{account.handle}</h1>
          <p className="px-count">{account.posts.length} posts</p>
          <p className="px-bio">{account.bio}</p>
        </div>
      </header>
      <ul className="px-grid">
        {account.posts.map((post) => (
          <li key={post.id}>
            <button type="button" className="px-tile" onClick={() => go(postUrl(account.handle, post.id))} aria-label={`Open post: ${post.caption}`}>
              <Photo post={post} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Post({ account, post, go }) {
  return (
    <article className="px-post">
      <Photo post={post} large />
      <div className="px-post-side">
        <p className="px-caption">
          <Handle handle={account.handle} go={go} /> {post.caption}
        </p>
        {post.comments.length === 0 && <p className="px-no-comments">No comments yet.</p>}
        <ul className="px-comments">
          {post.comments.map((c) => (
            <li key={c.handle + c.text}>
              <Handle handle={c.handle} go={go} /> {c.text}
            </li>
          ))}
        </ul>
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
        <span className="px-ring is-large" aria-hidden="true">{handle[0]?.toUpperCase()}</span>
        <h1>@{handle}</h1>
        <p>This account is private. Only approved followers can see its photos.</p>
      </div>
    );
  else if (kind === "p") {
    const post = account.posts.find((p) => p.id === postId);
    body = post ? <Post account={account} post={post} go={go} /> : <Account account={account} go={go} />;
  } else body = <Account account={account} go={go} />;

  return (
    <div className="site-pixa">
      <header className="px-header">
        <button type="button" className="px-logo" onClick={() => go(SITES.pixa)}>
          pixa
        </button>
      </header>
      <main className="px-main">{body}</main>
    </div>
  );
}
