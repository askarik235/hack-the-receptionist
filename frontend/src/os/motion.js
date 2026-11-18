// True when the player asked their system for less motion. Checked when an animation starts,
// so changing the setting mid-game takes effect on the next one.
export const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
