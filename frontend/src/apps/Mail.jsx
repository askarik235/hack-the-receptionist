// Mission briefings from the client. One message per unlocked target.
import { useState } from "react";

const LINKS = [
  { label: "vitality-logistics.ae", url: "vitality-logistics.ae" },
  { label: "WorkNet", url: "worknet.io" },
  { label: "Pixa", url: "pixa.photos" },
];

export default function Mail({ mail, onOpenUrl }) {
  const [selectedId, setSelectedId] = useState(null);
  const sorted = [...mail].sort((a, b) => b.level - a.level);
  const selected = sorted.find((m) => m.id === selectedId) ?? sorted[0];

  if (!selected) return <p className="mail-empty">No messages yet.</p>;

  return (
    <div className="mail">
      <ul className="mail-list" aria-label="Inbox">
        {sorted.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className={`mail-item${m.id === selected.id ? " is-selected" : ""}`}
              onClick={() => setSelectedId(m.id)}
              aria-current={m.id === selected.id}
            >
              <span className="mail-from">{m.from}</span>
              <span className="mail-subject">{m.subject}</span>
            </button>
          </li>
        ))}
      </ul>
      <article className="mail-read">
        <h3 className="mail-read-subject">{selected.subject}</h3>
        <p className="mail-read-from">From {selected.from}</p>
        <div className="mail-read-body">
          {selected.body.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="mail-links">
          <span>Open in Browser:</span>
          {LINKS.map((link) => (
            <button key={link.url} type="button" className="link-button" onClick={() => onOpenUrl(link.url)}>
              {link.label}
            </button>
          ))}
        </div>
        <p className="mail-disclaimer">{selected.disclaimer}</p>
      </article>
    </div>
  );
}
