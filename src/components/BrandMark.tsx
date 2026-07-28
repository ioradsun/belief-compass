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
        d="M15.77 4.56 A4.6 4.6 0 1 0 15.77 9.84"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* bottom C — horizontally inverted, faces left */}
      <path
        d="M8.23 14.16 A4.6 4.6 0 1 1 8.23 19.44"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* single shared axis through both Cs */}
      <path
        d="M12 1.4 V22.6"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
