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

// The Nightjar mark: a bird's swept wing.
export const NightjarMark = () => (
  <svg viewBox="0 0 24 24" className="nightjar-mark" aria-hidden="true">
    <path d="M2 14c5-1 8-4 10-9 1 4 0 7-2 9 4-1 8-1 12 1-6 1-11 3-14 6 0-3 1-5 3-6-3 0-6 0-9-1z" />
  </svg>
);
