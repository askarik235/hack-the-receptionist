// Mission briefings from the client. One message per unlocked target.
// In the mail text, **…** marks a hint worth noticing, and lines that start with
// "Target:", "Objective:" or "Attached:" are the job itself; both are highlighted.
import { useEffect, useState } from "react";
import { markMailRead, useMailRead } from "../os/badges.js";

const LINKS = [
  { label: "vitality-logistics.ae", url: "vitality-logistics.ae" },
  { label: "WorkNet", url: "worknet.io" },
  { label: "Pixa", url: "pixa.photos" },
];
const FACT_LINE = /^(Target|Objective|Attached): (.*)$/;
// A message that opens by itself (the newest one) counts as read after this long on screen,
// so the player sees which messages were new. Clicking one marks it read at once.
const READ_AFTER_MS = 1500;

// Splits "a **b** c" into text and highlighted parts.
function Rich({ text }) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <mark key={i} className="mail-key">{part}</mark> : part));
}

function Line({ line }) {
  const fact = FACT_LINE.exec(line);
  if (fact) {
    return (
      <div className={`mail-fact is-${fact[1].toLowerCase()}`}>
        <span className="mail-fact-label">{fact[1]}</span>
        <p>
          <Rich text={fact[2]} />
        </p>
      </div>
    );
  }
  if (/^— /.test(line)) return <p className="mail-sign">{line}</p>;
  return (
    <p>
      <Rich text={line} />
    </p>
  );
}

// The subject list shows plain text: no ** marks.
const plain = (text) => text.replace(/\*\*/g, "");

// visible: the Mail window is in front, so the open message can count as read.
export default function Mail({ mail, visible, onOpenUrl }) {
  const [selectedId, setSelectedId] = useState(null);
  const sorted = [...mail].sort((a, b) => (b.order ?? b.level) - (a.order ?? a.level));
  const selected = sorted.find((m) => m.id === selectedId) ?? sorted[0];
  const read = useMailRead();
  const isRead = (m) => read.includes(m.id);

  const openId = selected?.id;
  useEffect(() => {
    if (!visible || !openId) return;
    const timer = setTimeout(() => markMailRead(openId), READ_AFTER_MS);
    return () => clearTimeout(timer);
  }, [visible, openId]);

  if (!selected) return <p className="mail-empty">No messages yet.</p>;

  function open(id) {
    setSelectedId(id);
    markMailRead(id);
  }

  return (
    <div className="mail">
      <ul className="mail-list" aria-label="Inbox">
        {sorted.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className={`mail-item${m.id === selected.id ? " is-selected" : ""}${isRead(m) ? "" : " is-unread"}`}
              onClick={() => open(m.id)}
              aria-current={m.id === selected.id}
            >
              <span className="mail-from">
                {m.from}
                {!isRead(m) && <span className="mail-new">New</span>}
              </span>
              <span className="mail-subject">{plain(m.subject)}</span>
            </button>
          </li>
        ))}
      </ul>
      <article className="mail-read">
        <h3 className="mail-read-subject">{plain(selected.subject)}</h3>
        <p className="mail-read-from">From {selected.from}</p>
        <div className="mail-read-body">
          {selected.body.map((line, i) => (
            <Line key={i} line={line} />
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
