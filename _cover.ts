// Throwaway: calibrate an adaptive contour-line count for Contour (Supply
// Chain) so every seed lays down a similar amount of linework, and compare the
// resulting blank-gap stats against the current fixed-level behaviour.
import { createNoise2D } from "simplex-noise";
import { contours as d3contours } from "d3-contour";
import { mulberry32 } from "./src/tools/specimenTreeCore";
import { DEFAULT_CONTOUR, CW, CH, type ContourParams } from "./src/tools/contourCore";

const W = 1080;
const H = 1080;

// --- copy of buildField (no image path) so we can inspect the field itself ---
function buildField(gw: number, gh: number, w: number, h: number, p: ContourParams) {
  const rng = mulberry32(p.seed);
  const noise = createNoise2D(rng);
  const warpNoiseX = createNoise2D(mulberry32(p.seed ^ 0x1234));
  const warpNoiseY = createNoise2D(mulberry32(p.seed ^ 0x9abc));
  const octaves = Math.max(1, Math.round(p.octaves));
  const cell = Math.max(w, h) / p.fieldScale;
  const fbm = (nx: number, ny: number, fn: (x: number, y: number) => number) => {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * fn(nx * freq, ny * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
  const values = new Float64Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const px = (i / (gw - 1)) * w;
      const py = (j / (gh - 1)) * h;
      const nx = px / cell;
      const ny = py / cell;
      const qx = warpNoiseX(nx, ny);
      const qy = warpNoiseY(nx, ny);
      const n = fbm(nx + p.warp * qx, ny + p.warp * qy, noise);
      values[j * gw + i] = (n + 1) / 2;
    }
  }
  return values;
}

/** Mean |grad| per px, plus lo/hi, for a field. */
function fieldStats(values: Float64Array, gw: number, gh: number, w: number, h: number) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < values.length; k++) {
    if (values[k] < lo) lo = values[k];
    if (values[k] > hi) hi = values[k];
  }
  const sx = w / (gw - 1);
  const sy = h / (gh - 1);
  let sum = 0, n = 0;
  for (let j = 1; j < gh - 1; j++) {
    for (let i = 1; i < gw - 1; i++) {
      const gx = (values[j * gw + i + 1] - values[j * gw + i - 1]) / (2 * sx);
      const gy = (values[(j + 1) * gw + i] - values[(j - 1) * gw + i]) / (2 * sy);
      sum += Math.hypot(gx, gy);
      n++;
    }
  }
  return { lo, hi, meanGrad: sum / n };
}

/** Trace contours for an explicit level count (rest of the pipeline unchanged). */
function trace(p: ContourParams, levels: number, w = W, h = H) {
  const cellPx = 3;
  const gw = Math.max(8, Math.round(w / cellPx));
  const gh = Math.max(8, Math.round(h / cellPx));
  const values = buildField(gw, gh, w, h, p);
  const { lo, hi } = fieldStats(values, gw, gh, w, h);
  if (!isFinite(lo) || hi <= lo) return { lines: [] as number[][], len: 0 };
  const sorted = Float64Array.from(values);
  sorted.sort();
  const n = sorted.length;
  const fill = Math.min(1, Math.max(0, p.fill));
  const lv = Math.max(2, Math.round(levels));
  const raw: number[] = [];
  for (let l = 1; l <= lv; l++) {
    const t = l / (lv + 1);
    const linear = lo + (hi - lo) * t;
    const idx = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
    raw.push(linear * (1 - fill) + sorted[idx] * fill);
  }
  const thresholds: number[] = [];
  for (const t of raw) if (!thresholds.length || t > thresholds[thresholds.length - 1]) thresholds.push(t);
  if (thresholds.length < 2) return { lines: [] as number[][], len: 0 };
  const geo = d3contours().size([gw, gh]).thresholds(thresholds)(Array.from(values));
  const sx = w / (gw - 1);
  const sy = h / (gh - 1);
  const minRingArea = w * h * 0.0024;
  const lines: number[][] = [];
  let len = 0;
  for (const multi of geo) {
    for (const polygon of multi.coordinates) {
      for (const ring of polygon) {
        const pts: number[] = [];
        for (const [gx, gy] of ring) pts.push(gx * sx, gy * sy);
        if (pts.length < 6) continue;
        let a2 = 0;
        for (let i = 0, m = pts.length / 2; i < m; i++) {
          const j = (i + 1) % m;
          a2 += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
        }
        if (Math.abs(a2) / 2 < minRingArea) continue;
        for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
        lines.push(pts);
      }
    }
  }
  return { lines, len };
}

const CELL = 6;
function gapStats(lines: number[][], w = W, h = H) {
  const gw = Math.ceil(w / CELL), gh = Math.ceil(h / CELL);
  const INF = 1e9;
  const d = new Float64Array(gw * gh).fill(INF);
  for (const pts of lines) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / CELL));
      for (let s = 0; s <= steps; s++) {
        const gx = Math.min(gw - 1, Math.max(0, Math.round((x0 + ((x1 - x0) * s) / steps) / CELL)));
        const gy = Math.min(gh - 1, Math.max(0, Math.round((y0 + ((y1 - y0) * s) / steps) / CELL)));
        d[gy * gw + gx] = 0;
      }
    }
  }
  const a = 1, b = Math.SQRT2;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= gw || y >= gh ? INF : d[y * gw + x]);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const k = y * gw + x; d[k] = Math.min(d[k], at(x-1,y)+a, at(x,y-1)+a, at(x-1,y-1)+b, at(x+1,y-1)+b); }
  for (let y = gh-1; y >= 0; y--) for (let x = gw-1; x >= 0; x--) { const k = y * gw + x; d[k] = Math.min(d[k], at(x+1,y)+a, at(x,y+1)+a, at(x+1,y+1)+b, at(x-1,y+1)+b); }
  const s = Float64Array.from(d).sort();
  const q = (p: number) => s[Math.floor(p * (s.length - 1))] * CELL;
  let over = 0;
  for (let k = 0; k < d.length; k++) if (d[k] * CELL > 60) over++;
  return { p95: q(0.95), max: q(1), blank60: over / d.length };
}

const SEEDS: number[] = [];
for (let i = 0; i < 120; i++) SEEDS.push(((i * 7919 + 46933) % 99999) + 1);

// --- 1. calibrate: what does the current fixed levels=10 imply per seed? ---
const cellPx = 3;
const gw = Math.max(8, Math.round(W / cellPx));
const gh = Math.max(8, Math.round(H / cellPx));
const implied: number[] = [];
const info: Array<{ seed: number; range: number; grad: number; spacing: number; len: number }> = [];
for (const seed of SEEDS) {
  const p = { ...DEFAULT_CONTOUR, seed };
  const values = buildField(gw, gh, W, H, p);
  const { lo, hi, meanGrad } = fieldStats(values, gw, gh, W, H);
  // Threshold step at levels=10, and the mean line spacing it implies.
  const delta = (hi - lo) / (DEFAULT_CONTOUR.levels + 1);
  const spacing = delta / meanGrad; // px between neighbouring iso-lines
  implied.push(spacing);
  info.push({ seed, range: hi - lo, grad: meanGrad, spacing, len: 0 });
}
const sortedSpacing = [...implied].sort((a, b) => a - b);
const medSpacing = sortedSpacing[Math.floor(sortedSpacing.length / 2)];
console.log(
  `current levels=10 → implied line spacing: min ${sortedSpacing[0].toFixed(0)}px  med ${medSpacing.toFixed(0)}px  max ${sortedSpacing[sortedSpacing.length - 1].toFixed(0)}px  (canvas ${W}px)`,
);
console.log(`field range: min ${Math.min(...info.map(i => i.range)).toFixed(2)} max ${Math.max(...info.map(i => i.range)).toFixed(2)}`);

// Target spacing as a fraction of the short edge, anchored on the median seed.
const K = medSpacing / Math.min(W, H);
console.log(`median spacing is ${(K * 100).toFixed(1)}% of the short edge\n`);

function adaptiveLevels(p: ContourParams, w: number, h: number, targetFrac: number, min: number, max: number) {
  const values = buildField(gw, gh, w, h, p);
  const { lo, hi, meanGrad } = fieldStats(values, gw, gh, w, h);
  const spacing = targetFrac * Math.min(w, h);
  const delta = spacing * meanGrad;
  const lv = Math.round((hi - lo) / delta) - 1;
  return Math.min(max, Math.max(min, lv));
}

// --- 2. compare current vs adaptive ---
type Row = { name: string; p95: number[]; max: number[]; blank: number[]; lv: number[]; len: number[] };
const rows: Row[] = [];
const variants: Array<[string, (p: ContourParams) => number]> = [
  ["current fixed lv10", () => DEFAULT_CONTOUR.levels],
  ["adaptive (med spacing)", (p) => adaptiveLevels(p, W, H, K, 6, 30)],
  ["adaptive 0.8x spacing", (p) => adaptiveLevels(p, W, H, K * 0.8, 6, 34)],
  ["adaptive 0.65x spacing", (p) => adaptiveLevels(p, W, H, K * 0.65, 6, 40)],
];
for (const [name, pick] of variants) {
  const row: Row = { name, p95: [], max: [], blank: [], lv: [], len: [] };
  for (const seed of SEEDS) {
    const p = { ...DEFAULT_CONTOUR, seed };
    const lv = pick(p);
    const { lines, len } = trace(p, lv);
    const g = gapStats(lines);
    row.p95.push(g.p95);
    row.max.push(g.max);
    row.blank.push(g.blank60);
    row.lv.push(lv);
    row.len.push(len);
  }
  rows.push(row);
}
const st = (ns: number[]) => {
  const s = [...ns].sort((a, b) => a - b);
  const at = (q: number) => s[Math.floor(q * (s.length - 1))];
  return { min: s[0], med: at(0.5), p90: at(0.9), max: s[s.length - 1] };
};
for (const r of rows) {
  const g = st(r.max), p = st(r.p95), b = st(r.blank), lv = st(r.lv), L = st(r.len);
  console.log(
    `${r.name.padEnd(24)} hole radius med ${g.med.toFixed(0)}px p90 ${g.p90.toFixed(0)}px worst ${g.max.toFixed(0)}px | gap p95 med ${p.med.toFixed(0)}px | >60px-blank med ${(b.med*100).toFixed(1)}% worst ${(b.max*100).toFixed(1)}% | levels ${lv.min}-${lv.max} (med ${lv.med}) | ink length med ${(L.med/1000).toFixed(1)}k spread ${(L.min/1000).toFixed(1)}k-${(L.max/1000).toFixed(1)}k`,
  );
}

// --- 3. does it hold at other canvas sizes / aspects? ---
console.log("");
for (const [w, h] of [[CW, CH], [1080, 1350], [1920, 1080]] as Array<[number, number]>) {
  const maxes: number[] = [];
  const lvs: number[] = [];
  for (const seed of SEEDS.slice(0, 40)) {
    const p = { ...DEFAULT_CONTOUR, seed };
    const lv = adaptiveLevels(p, w, h, K * 0.8, 6, 34);
    const { lines } = trace(p, lv, w, h);
    maxes.push(gapStats(lines, w, h).max);
    lvs.push(lv);
  }
  const g = st(maxes), lv = st(lvs);
  console.log(`${w}x${h} adaptive 0.8x → hole med ${g.med.toFixed(0)}px worst ${g.max.toFixed(0)}px | levels ${lv.min}-${lv.max}`);
}
