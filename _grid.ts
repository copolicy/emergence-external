// Throwaway: rasterise a grid of Contour (Supply Chain) thumbnails to a PNG so
// old vs new defaults can be compared without a browser.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { computeContours, DEFAULT_CONTOUR, type ContourParams } from "./src/tools/contourCore";

const CELL = 240;   // thumbnail size
const PAD = 8;
const SEEDS = [17946, 57194, 85784, 82202, 60044, 46933];
const ROWS: Array<[string, Partial<ContourParams>]> = [
  ["old", { levels: 10, fill: 0.6, evenness: 0 }],
  ["new", {}],
];

const cols = SEEDS.length;
const rows = ROWS.length;
const W = cols * (CELL + PAD) + PAD;
const H = rows * (CELL + PAD) + PAD;
const img = new Uint8Array(W * H).fill(245); // cream

function px(x: number, y: number, v: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const k = y * W + x;
  if (v < img[k]) img[k] = v;
}

/** Anti-aliased-ish 1px line. */
function line(x0: number, y0: number, x1: number, y1: number, ink: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = y0 + ((y1 - y0) * s) / steps;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    px(xi, yi, 245 - (245 - ink) * (1 - fx) * (1 - fy));
    px(xi + 1, yi, 245 - (245 - ink) * fx * (1 - fy));
    px(xi, yi + 1, 245 - (245 - ink) * (1 - fx) * fy);
    px(xi + 1, yi + 1, 245 - (245 - ink) * fx * fy);
  }
}

function frame(ox: number, oy: number) {
  for (let x = 0; x < CELL; x++) { px(ox + x, oy, 205); px(ox + x, oy + CELL - 1, 205); }
  for (let y = 0; y < CELL; y++) { px(ox, oy + y, 205); px(ox + CELL - 1, oy + y, 205); }
}

ROWS.forEach(([, over], r) => {
  SEEDS.forEach((seed, c) => {
    const ox = PAD + c * (CELL + PAD);
    const oy = PAD + r * (CELL + PAD);
    frame(ox, oy);
    const params: ContourParams = { ...DEFAULT_CONTOUR, ...over, seed };
    const { lines } = computeContours(CELL, CELL, params, null);
    for (const l of lines) {
      const pts = l.pts;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        line(ox + pts[i], oy + pts[i + 1], ox + pts[i + 2], oy + pts[i + 3], 40);
      }
    }
  });
});

// ---- minimal grayscale PNG ----
function crc32(buf: Uint8Array) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 0;  // grayscale
const raw = Buffer.alloc((W + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W + 1)] = 0;
  Buffer.from(img.subarray(y * W, (y + 1) * W)).copy(raw, y * (W + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", new Uint8Array()),
]);
writeFileSync("_grid.png", png);
console.log(`wrote _grid.png (${W}x${H}) — row 1 old defaults, row 2 new; seeds ${SEEDS.join(", ")}`);
