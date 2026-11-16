// files.vitality-logistics.ae: VitalNet Files, the company's shared drive. Nadia's account can see
// the folder list but opens almost nothing. The Sandgrouse folder opens with the code the CEO read
// out; the server only sends its documents to a player who cleared that level with their own code.
import { useState } from "react";
import { openFolder } from "../api.js";
import { useFormSubmit } from "./useFormSubmit.js";

const ERRORS = {
  wrong_code: "That folder code is not valid.",
  invalid_request: "Enter the folder code.",
  too_many_attempts: "Too many attempts. Try again in a minute.",
};

const LOCKED_FOLDER = "sandgrouse";
const FOLDERS = [
  { id: LOCKED_FOLDER, name: "Sandgrouse", parent: "Executive Office" },
  { id: "finance", name: "Finance" },
  { id: "hr", name: "HR" },
  { id: "it", name: "IT Help Desk" },
  { id: "operations", name: "Operations" },
  { id: "reception", name: "Reception" },
];

// Survives moving between pages in the browser; a reload locks the folder again.
let unlocked = null;

function LockIcon() {
  return (
    <svg className="vf-lock" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function Unlock({ onOpen }) {
  const [code, setCode] = useState("");
  const { busy, error, submit } = useFormSubmit({
    action: () => openFolder(LOCKED_FOLDER, code),
    onDone: onOpen,
    errors: ERRORS,
    fallback: "VitalNet Files is not responding. Try again.",
  });

  return (
    <form className="vf-unlock" onSubmit={submit}>
      <LockIcon />
      <h2>Sandgrouse is a restricted folder</h2>
      <p>Only V. Sokolov and E. Clarke can open it. Investigators can use a one-time folder code.</p>
      <label>
        Folder code
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WORD-1234" autoComplete="off" spellCheck="false" maxLength={40} />
      </label>
      {error && (
        <p className="vn-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !code.trim()}>
        {busy ? "Checking…" : "Open folder"}
      </button>
    </form>
  );
}

function Documents({ vault }) {
  const [openId, setOpenId] = useState(vault.documents[0]?.id);
  const open = vault.documents.find((d) => d.id === openId);
  return (
    <div className="vf-docs">
      <ul className="vn-list" aria-label={`${vault.title} documents`}>
        {vault.documents.map((d) => (
          <li key={d.id}>
            <button type="button" className={`vn-item${d.id === openId ? " is-open" : ""}`} onClick={() => setOpenId(d.id)} aria-current={d.id === openId}>
              <span className="vn-item-from">{d.title}</span>
              <span className="vn-item-date">{d.date}</span>
              <span className="vn-item-subject">{d.kind}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <article className="vn-read">
          <h2>{open.title}</h2>
          <dl className="vn-meta">
            <dt>Type</dt>
            <dd>{open.kind}</dd>
            <dt>Date</dt>
            <dd>{open.date}</dd>
            {open.from && (
              <>
                <dt>From</dt>
                <dd>{open.from}</dd>
              </>
            )}
          </dl>
          <div className="vn-text">
            {open.body.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}

export default function VitalNetFiles() {
  const [folder, setFolder] = useState(LOCKED_FOLDER);
  const [vault, setVault] = useState(unlocked);
  const current = FOLDERS.find((f) => f.id === folder);
  const unlock = (data) => {
    unlocked = data;
    setVault(data);
  };

  let main;
  if (folder !== LOCKED_FOLDER) {
    main = (
      <div className="vf-denied">
        <h2>{current.name}</h2>
        <p>Your account doesn't have access to this folder. Ask the folder owner or the IT help desk (ext. 214).</p>
      </div>
    );
  } else {
    main = vault ? <Documents vault={vault} /> : <Unlock onOpen={unlock} />;
  }

  return (
    <div className="site-vitalnet">
      <div className="vn-app">
        <header className="vn-top">
          <p className="vn-wordmark">
            Vital<span>Net</span> Files
          </p>
          <span className="vn-user">Signed in as nadia.rahman</span>
        </header>
        <div className="vf-body">
          <nav className="vf-tree" aria-label="Shared drive">
            <p className="vf-tree-title">Shared drive</p>
            <ul>
              {FOLDERS.map((f) => (
                <li key={f.id}>
                  <button type="button" className={`vf-folder${f.id === folder ? " is-open" : ""}`} onClick={() => setFolder(f.id)} aria-current={f.id === folder}>
                    {f.parent && <span className="vf-parent">{f.parent}</span>}
                    {f.name}
                    {f.id === LOCKED_FOLDER && !vault && <LockIcon />}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <main className="vf-main">{main}</main>
        </div>
      </div>
    </div>
  );
}
