// A red counter on an app icon, like a phone's home screen. Keyed on the count, so it pops
// again each time something new arrives.
export default function Badge({ count }) {
  if (!count) return null;
  return (
    <span key={count} className="app-badge" aria-hidden="true">
      {count > 9 ? "9+" : count}
    </span>
  );
}
