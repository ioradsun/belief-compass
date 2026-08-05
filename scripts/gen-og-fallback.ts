/**
 * Generate the branded fallback Open Graph image — public/og/default.png.
 *
 * This is the reliable image every share card falls back to when a market has no
 * usable media thumbnail (and, for now, for every non-media market until the
 * synthetic per-market image lands). It carries the product's core identity —
 * two sides, one question — with no text, so it reads at any size on any
 * platform. Deliberately a PLACEHOLDER: swap in the final art at the same path.
 *
 * Pure Node (zlib only) so it runs anywhere with no image dependency. 1200×630
 * is the canonical OG size (summary_large_image, ~1.91:1).
 *
 *   npx tsx scripts/gen-og-fallback.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const W = 1200;
const H = 630;

// Brand palette (mirrors src/styles.css).
const BG = [0x10, 0x10, 0x0f];
const YES = [0x4c, 0x73, 0xff]; // Conviction Blue
const NO = [0xf5, 0xa6, 0x23]; // Conviction Amber

function mix(a: number[], b: number[], t: number): number[] {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

/** One centered pill, split blue (YES) / amber (NO) — "pick a side". */
function pixel(x: number, y: number): number[] {
  const cx = W / 2;
  const cy = H / 2;
  const halfW = 260; // pill half-length
  const halfH = 46; // pill half-height
  const r = halfH; // fully rounded ends
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);

  // Rounded-rect (stadium) distance.
  const inStraight = dx <= halfW - r && dy <= halfH;
  const inCapCore = dx > halfW - r;
  let inside = false;
  let edge = 0; // 0..1 antialias coverage near the border
  if (inStraight) {
    inside = true;
    edge = Math.min(1, (halfH - dy) / 2);
  } else if (inCapCore) {
    const ccx = halfW - r;
    const d = Math.hypot(dx - ccx, dy);
    inside = d <= r;
    edge = Math.min(1, (r - d) / 2);
  }
  if (!inside) return BG;

  const side = x < cx ? YES : NO;
  // Soft seam in the middle so the two sides meet, not clash.
  const seam = Math.min(1, dx / 6);
  const color = mix(mix(YES, NO, 0.5), side, seam);
  // Antialias the pill edge back toward the background.
  return edge >= 1 ? color : mix(BG, color, Math.max(0, edge));
}

// Build raw RGBA scanlines with the mandatory per-row filter byte (0 = none).
const raw = Buffer.alloc((W * 4 + 1) * H);
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = pixel(x, y);
    raw[o++] = r;
    raw[o++] = g;
    raw[o++] = b;
    raw[o++] = 255;
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

// PNG CRC-32.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = fileURLToPath(new URL("../public/og", import.meta.url));
mkdirSync(outDir, { recursive: true });
const outPath = fileURLToPath(new URL("../public/og/default.png", import.meta.url));
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes, ${W}×${H})`);
