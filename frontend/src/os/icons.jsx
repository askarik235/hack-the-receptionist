// Original line icons for the desktop. Drawn on a 32x32 grid, stroke only.
const Icon = ({ children }) => (
  <svg viewBox="0 0 32 32" className="app-glyph" aria-hidden="true">
    {children}
  </svg>
);

export const icons = {
  mail: (
    <Icon>
      <rect x="5" y="8" width="22" height="16" rx="2" />
      <path d="M5.5 9l10.5 8 10.5-8" />
    </Icon>
  ),
  browser: (
    <Icon>
      <circle cx="16" cy="16" r="11" />
      <path d="M5 16h22M16 5c3.5 3.2 5 7 5 11s-1.5 7.8-5 11c-3.5-3.2-5-7-5-11s1.5-7.8 5-11z" />
    </Icon>
  ),
  phone: (
    <Icon>
      <rect x="10" y="4" width="12" height="24" rx="2.5" />
      <path d="M14 24h4" />
    </Icon>
  ),
  hack: (
    <Icon>
      <rect x="7" y="14" width="18" height="13" rx="2" />
      <path d="M11 14v-3a5 5 0 0 1 10 0v3M16 19v3" />
    </Icon>
  ),
  training: (
    <Icon>
      <path d="M16 5l3.2 6.5 7.1 1-5.1 5 1.2 7.1L16 21.2l-6.4 3.4 1.2-7.1-5.1-5 7.1-1z" />
    </Icon>
  ),
  notes: (
    <Icon>
      <path d="M8 5h12l5 5v17H8z" />
      <path d="M20 5v5h5M12 16h9M12 20h9M12 24h5" />
    </Icon>
  ),
};

// The Midas mark: a golden feather. The shaft and the two splits in the vane are cut out in the
// taskbar's own colour, so the feather reads at 20px.
export const MidasMark = () => (
  <svg viewBox="0 0 24 24" className="midas-mark" aria-hidden="true">
    <defs>
      <linearGradient id="midas-gold" x1="21" y1="3" x2="5" y2="19" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#fbe28c" />
        <stop offset="0.55" stopColor="#e9ad3e" />
        <stop offset="1" stopColor="#b97f24" />
      </linearGradient>
    </defs>
    <path className="midas-vane" d="M21 2.5C15 2.5 8 7 6 18c7-1 13-7 15-15.5z" />
    <path className="midas-quill" d="M2.5 21.5l4-4" />
    <path className="midas-cut" d="M6.5 17.5Q13 11 20.6 3M10 13.9l-2-3.3M14 9.7l-1.8-4.1M12.6 11.2l4.7.5" />
  </svg>
);
