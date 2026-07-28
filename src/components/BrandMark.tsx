/**
 * conviction.company mark — an original abstract symbol.
 *
 * Geometry: one top C in normal orientation (opening right), one bottom C
 * horizontally inverted (opening left), both on the same vertical center axis,
 * with a single vertical line running through both and extending slightly past
 * each. It reads first as two opposing Cs, and only afterwards hints at a
 * financial glyph. Pure vector — no raster, no font character.
 */
export function BrandMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="conviction.company"
      className={className}
    >
      {/* top C — normal orientation, faces right */}
      <path
        d="M16.1 4.3 A5.2 5.2 0 1 0 16.1 12.7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* bottom C — horizontally inverted, faces left */}
      <path
        d="M7.9 12.9 A5.2 5.2 0 1 1 7.9 21.3"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* single shared axis through both Cs */}
      <path
        d="M12 1.6 V22.4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
