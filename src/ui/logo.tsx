/**
 * The mark of DESIGN section 8 on a 24 px grid: a tile holding a pill track with the knob on the
 * right. Colored by tokens, not literal black and white: a black tile would vanish on the dark
 * page, and the inverted dark form is the one the design names for dark taskbars.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="24" height="24" rx="5" style={{ fill: 'var(--inverse-bg)' }} />
      <rect x="3" y="8" width="18" height="8" rx="4" style={{ fill: 'var(--inverse-text)' }} />
      <circle cx="17" cy="12" r="3" style={{ fill: 'var(--inverse-bg)' }} />
    </svg>
  );
}
