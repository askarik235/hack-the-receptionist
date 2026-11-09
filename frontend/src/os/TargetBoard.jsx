// The five targets. Locked ones stay anonymous; cleared ones get a rubber stamp.
const initials = (name) => name.split(" ").map((part) => part[0]).join("");

export default function TargetBoard({ targets }) {
  return (
    <aside className="target-board" aria-label="Targets">
      <h2 className="board-title">Targets</h2>
      <ol className="board-list">
        {targets.map((t) => (
          <li key={t.level} className={`target is-${t.status}`}>
            <span className="target-face" aria-hidden="true">{t.name ? initials(t.name) : "?"}</span>
            <span className="target-text">
              <span className="target-name">{t.name ?? (t.status === "soon" ? "Next target" : "Locked")}</span>
              <span className="target-role">
                {t.role ?? (t.status === "soon" ? "Coming in a future update" : `Clear target ${t.level - 1} to reveal`)}
              </span>
            </span>
            {t.status === "cleared" && <span className="stamp">Cleared</span>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
