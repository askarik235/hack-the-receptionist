// mail.vitality-logistics.ae: VitalNet Mail, the company webmail. The player logs in with the
// temporary password they talked out of IT. The server only returns an inbox for a player who
// cleared that level and typed their own password.
import { useState } from "react";
import { mailLogin } from "../api.js";
import { useFormSubmit } from "./useFormSubmit.js";

const ERRORS = {
  wrong_login: "Wrong username or password.",
  invalid_login: "Enter your username (firstname.lastname) and password.",
  too_many_attempts: "Too many attempts. Try again in a minute.",
};

const FORWARD_LINE = /^-+ Forwarded message -+$/;
const HEADER_LINE = /^(From|To|Date|Subject): /;

// A forwarded email shows the original below the separator as an indented quote, with its
// From/To/Date/Subject lines grouped like a real webmail header.
function EmailBody({ lines }) {
  const split = lines.findIndex((line) => FORWARD_LINE.test(line));
  const own = split === -1 ? lines : lines.slice(0, split);
  const quoted = split === -1 ? [] : lines.slice(split + 1);
  const headers = quoted.filter((line) => HEADER_LINE.test(line));
  const rest = quoted.filter((line) => !HEADER_LINE.test(line));
  return (
    <>
      {own.map((line, i) => <p key={i}>{line}</p>)}
      {split !== -1 && (
        <blockquote className="vn-forward">
          <p className="vn-forward-label">Forwarded message</p>
          <div className="vn-forward-head">{headers.map((line, i) => <div key={i}>{line}</div>)}</div>
          {rest.map((line, i) => <p key={i}>{line}</p>)}
        </blockquote>
      )}
    </>
  );
}

// Survives moving between pages in the browser; a reload logs out, like a real session cookie.
let session = null;

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useFormSubmit({
    action: () => mailLogin(username, password),
    onDone: onLogin,
    errors: ERRORS,
    fallback: "VitalNet is not responding. Try again.",
  });

  return (
    <div className="vn-login">
      <form className="vn-login-card" onSubmit={submit}>
        <p className="vn-wordmark">
          Vital<span>Net</span>
        </p>
        <h1>Sign in to your mailbox</h1>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="firstname.lastname" autoComplete="off" spellCheck="false" maxLength={80} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" maxLength={80} />
        </label>
        {error && (
          <p className="vn-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !username.trim() || !password.trim()}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="vn-help">Locked out? Call the IT help desk on ext. 214.</p>
      </form>
    </div>
  );
}

function Inbox({ box, onLogout }) {
  const [openId, setOpenId] = useState(box.emails[0]?.id);
  const [read, setRead] = useState(() => new Set([box.emails[0]?.id]));
  const open = box.emails.find((e) => e.id === openId);

  function select(id) {
    setOpenId(id);
    setRead((r) => new Set(r).add(id));
  }

  return (
    <div className="vn-app">
      <header className="vn-top">
        <p className="vn-wordmark">
          Vital<span>Net</span> Mail
        </p>
        <span className="vn-user">{box.address}</span>
        <button type="button" className="vn-logout" onClick={onLogout}>
          Sign out
        </button>
      </header>
      <div className="vn-body">
        <ul className="vn-list" aria-label="Inbox">
          {box.emails.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`vn-item${e.id === openId ? " is-open" : ""}${read.has(e.id) ? "" : " is-unread"}`}
                onClick={() => select(e.id)}
                aria-current={e.id === openId}
              >
                <span className="vn-item-from">{e.from.replace(/\s*<.*>$/, "")}</span>
                <span className="vn-item-date">{e.date}</span>
                <span className="vn-item-subject">{e.subject}</span>
              </button>
            </li>
          ))}
        </ul>
        {open && (
          <article className="vn-read">
            <h2>{open.subject}</h2>
            <dl className="vn-meta">
              <dt>From</dt>
              <dd>{open.from}</dd>
              <dt>To</dt>
              <dd>{open.to}</dd>
              <dt>Date</dt>
              <dd>{open.date}</dd>
            </dl>
            <div className="vn-text">
              <EmailBody lines={open.body} />
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

export default function VitalNetMail() {
  const [box, setBox] = useState(session);
  const login = (data) => {
    session = data;
    setBox(data);
  };
  const logout = () => {
    session = null;
    setBox(null);
  };
  return <div className="site-vitalnet">{box ? <Inbox box={box} onLogout={logout} /> : <Login onLogin={login} />}</div>;
}
