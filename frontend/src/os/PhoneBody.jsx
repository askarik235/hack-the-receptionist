// The smartphone the Phone app runs on (desktop only): a graphite body with a thin gold rim,
// side keys, a status bar with Dubai time, and a home bar. An original design, not a copy of
// any real phone. Drag the body to move it; the home bar puts it away, the side key closes it.
import { useDubaiTime } from "./useDubaiTime.js";

const Signal = () => (
  <svg viewBox="0 0 18 12" className="device-signal" aria-hidden="true">
    <rect x="0" y="8" width="3" height="4" rx="1" />
    <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
    <rect x="10" y="3" width="3" height="9" rx="1" />
    <rect x="15" y="0" width="3" height="12" rx="1" />
  </svg>
);

const Battery = () => (
  <svg viewBox="0 0 26 12" className="device-battery" aria-hidden="true">
    <rect x="0.5" y="0.5" width="22" height="11" rx="3" className="device-battery-case" />
    <rect x="2.5" y="2.5" width="14" height="7" rx="1.5" />
    <path d="M24 4v4a1.6 1.6 0 0 0 0-4z" />
  </svg>
);

export default function PhoneBody({ title, drag, onPutAway, onClose, children }) {
  const time = useDubaiTime();
  return (
    <div className="device" {...drag}>
      <span className="device-key is-action" aria-hidden="true" />
      <span className="device-key is-volume-up" aria-hidden="true" />
      <span className="device-key is-volume-down" aria-hidden="true" />
      <button type="button" className="device-key is-power" onClick={onClose} aria-label={`Close ${title}`} title="Turn off the phone" />
      <div className="device-screen">
        <div className="device-status" aria-hidden="true">
          <span className="device-time">{time}</span>
          <span className="device-camera" />
          <span className="device-icons">
            <Signal />
            <span className="device-network">5G</span>
            <Battery />
          </span>
        </div>
        <div className="device-app">{children}</div>
        <button type="button" className="device-home" onClick={onPutAway} aria-label={`Minimise ${title}`} title="Put the phone away" />
      </div>
    </div>
  );
}
