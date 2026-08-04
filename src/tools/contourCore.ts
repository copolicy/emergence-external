import { contours as d3contours } from "d3-contour";
import { createNoise2D } from "simplex-noise";
import { mulberry32 } from "./specimenTreeCore";
import { sampleLuminance, toneAt, type LumBuffer } from "./flowFieldCore";
import { makeFade, strokeFaded, svgFadedPaths, type FadeOptions } from "./dissolveFade";
import {
  drawStamped,
  stampActive,
  traceStampPathD,
  type StampOpts,
} from "./stampTreatment";

// Generative canvas size — matches the other tools.
export const CW = 680;
export const CH = 580;
// Reversed out — cream linework on mid green.
export const INK = "#195519"; // Mid green
export const BG = "#F5F5F2"; // Cream

// Lighter dissolve than the shared default — a topo sheet should stay mostly
// inked with only a narrow taper right at the edge, not thin out over the
// whole lower half. Canvas and SVG must share these or the export diverges.
//
// `tipFrac` is a fraction of each line's own cut depth, not of the canvas, so a
// seemingly modest 0.2 against a cut at 0.92 put the taper's start at 0.736 —
// linework was already down to 59% weight by mid-depth, and `cutout` then broke
// the thinned strokes apart entirely, blanking the bottom quarter. Keep this
// small enough that the taper reads as an edge treatment.
const CONTOUR_FADE: FadeOptions = { start: 0.92, floor: 0.99, tipFrac: 0.03 };

/**
 * Vetted terrains. Contour fill is a lottery on the raw seed: two thirds of
 * seeds put their relief unevenly enough that a quadrant of the sheet reads
 * blank, and no exposed slider can rescue one — Density and Spread are off the
 * panel. So the seed slider indexes this list instead of the raw seed space.
 *
 * Built by sweeping seeds 1–6000 at the locked `fieldScale` / `levels` /
 * `minRing` and scoring each on how evenly its linework covers a 12×10 cell
 * grid: share of cells under half the median cell's path length (≤0.083),
 * emptiest cell against the median (≥0.248), spread of cell density (cv
 * ≤0.533), total path length (≥146.3 per 1000px², above the median seed) and a
 * busiest-cell ceiling (≤3.66× median) so the stamp pass can't fuse tight bands
 * into solid ink. Scored at the 1:1 preview dims, then re-checked against the
 * other three aspect presets on a looser floor — the field is sampled over
 * whatever window the canvas is, so a seed that fills a square can still leave
 * a gap in 16:9. 53 of 6000 passed. The scores are specific to those params —
 * if any of them move, re-run `_contourseeds_node.ts` and paste the new list.
 */
export const CONTOUR_SEEDS = [
  42, 89, 257, 451, 658, 792, 838, 841, 846, 886, 918, 995, 1575, 1625, 1739,
  1787, 2024, 2059, 2204, 2503, 2708, 2739, 2749, 2753, 2774, 2785, 2813, 2820,
  2821, 3479, 3536, 3568, 3605, 3740, 3764, 3798, 3860, 3915, 4136, 4466, 4470,
  4490, 4598, 4683, 5249, 5251, 5299, 5313, 5320, 5328, 5692, 5814, 5998,
];

/** Resolve a 1-based seed slider position to its vetted field seed. */
export function fieldSeed(seed: number): number {
  const i = Math.round(seed) - 1;
  const n = CONTOUR_SEEDS.length;
  return CONTOUR_SEEDS[((i % n) + n) % n];
}

/**
 * Topographic contour lines. A domain-warped simplex field is sampled onto a
 * grid, then d3-contour traces iso-lines at evenly spaced levels — the nested,
 * meandering linework of an antique survey map. With an image, the field is
 * blended toward the picture's tone so the contours band its forms.
 */
export interface ContourParams {
  seed: number; // 1-based index into CONTOUR_SEEDS, not the raw field seed
  fieldScale: number; // feature size — cells across the long edge
  octaves: number; // fbm detail layers
  warp: number; // domain-warp amount — how much the lines meander
  levels: number; // number of contour lines
  fill: number; // 0..1 — spread contours by area rather than by raw elevation value, so flat plateaus fill with lines instead of sitting blank (independent of line count)
  evenness: number; // 0..1 — flatten the broad elevation trend so every part of the canvas carries relief, and the linework spreads instead of bunching on the steep side
  minRing: number; // smallest ring worth drawing, as a share of canvas area — culls the innermost pinprick loops at each peak
  lineWidth: number; // stroke width
  // ink treatment — the same stamp/cutout render pass the Root Brush runs
  stamp: number; // 0..1 ink-stamp fatten/smooth pass (0 = off)
  cutout: number; // 0..1 cutout break/simplify pass (0 = off)
  // image
  imageInfluence: number; // 0..1 how strongly the image shapes the field
  contrast: number; // tone curve exponent for the image
}

export const DEFAULT_CONTOUR: ContourParams = {
  // Index into CONTOUR_SEEDS, not a raw seed.
  seed: 17,
  fieldScale: 3,
  octaves: 0,
  warp: 0,
  // At 12 the plateaus between landforms sat blank and fill swung seed to seed;
  // 16 rings the plateaus too. Past ~18 the tight bands fuse under the stamp
  // pass into solid ink.
  levels: 16,
  // Contours are placed mostly by raw elevation. Area-weighted placement (see
  // `fill`) crowds the thresholds into whatever value band covers the most
  // canvas, which starves the peaks and basins of lines — the opposite of the
  // even coverage it was reached for. `evenness` does that job properly.
  fill: 0.2,
  evenness: 1,
  // At the old 0.0024 speckle floor every peak ended in a nest of pinprick
  // loops — around 55 rings under a fiftieth of the canvas per sheet. This
  // clears those, so each peak closes on one broad ring and neighbouring bands
  // read as joined forms. Past ~0.016 the peaks hollow out into empty lenses.
  minRing: 0.008,
  lineWidth: 0.3,
  // Ink treatment, both dialled in against the reference and locked — no
  // sliders, so the pass always fattens the contours and breaks them by this
  // much.
  stamp: 0.39,
  cutout: 0.72,
  imageInfluence: 0.8,
  contrast: 1.1,
};

export const CONTOUR_RANGES: Record<keyof ContourParams, [number, number, number]> = {
  seed: [1, CONTOUR_SEEDS.length, 1],
  fieldScale: [2, 18, 0.5],
  octaves: [0, 6, 1],
  warp: [0, 2.5, 0.05],
  levels: [3, 20, 1],
  fill: [0, 1, 0.02],
  evenness: [0, 1, 0.02],
  minRing: [0, 0.03, 0.0005],
  lineWidth: [0.3, 1, 0.01],
  stamp: [0, 0.45, 0.01],
  cutout: [0, 1, 0.01],
  imageInfluence: [0, 1, 0.02],
  contrast: [0.3, 3, 0.05],
};

export const CONTOUR_LABELS: Record<keyof ContourParams, string> = {
  seed: "Seed",
  fieldScale: "Field Scale",
  octaves: "Detail",
  warp: "Meander",
  levels: "Density",
  fill: "Fill",
  evenness: "Spread",
  minRing: "Min Ring",
  lineWidth: "Line Weight",
  stamp: "Stamp",
  cutout: "Line Breaks",
  imageInfluence: "Image Shape",
  contrast: "Contrast",
};

export const CONTOUR_HINTS: Record<keyof ContourParams, string> = {
  seed: "Steps through the vetted terrains. Each one is checked to carry linework across the whole sheet, so no position lands on a half-empty map.",
  fieldScale: "Size of the landforms. Lower values make broad basins; higher values pack tighter ridges.",
  octaves: "Layers of detail folded into the field. More layers add fine crinkle to the coastlines.",
  warp: "How much the field is distorted — turns smooth blobs into meandering, river-like contours.",
  levels: "How many contour lines are drawn between the lowest and highest ground.",
  fill: "Spreads contours by how much canvas area they cover rather than by raw elevation. Zero spaces lines evenly by elevation; one crowds them into whichever band covers the most canvas, which fills the plateaus but empties the peaks and basins.",
  evenness:
    "Levels out how much relief each part of the canvas carries, by flattening the broad rise and fall underneath the landforms. Zero leaves the raw field, where a seed can put all its slope in one corner and leave the rest blank; one gives every region its own contour rings. Shapes and their scale stay the same — only how evenly the lines are spread changes.",
  minRing:
    "Drops any ring smaller than this share of the canvas. Raising it clears the pinprick loops at the centre of each peak, so the surviving rings read as fewer, broader forms; too high and the peaks hollow out.",
  lineWidth: "Thickness of the contour strokes.",
  stamp:
    "Ink-stamp fatten pass (à la Photoshop's Stamp filter). Spreads and smooths the linework into solid calligraphic ink, fusing fine clusters. Zero switches it off.",
  cutout:
    "Cutout pass (à la Photoshop's Cutout filter). Simplifies the stroke contours and pinches thin spots into organic breaks and dashes — never thickens the line. Zero switches it off.",
  imageInfluence: "How strongly the image's tone shapes the terrain. Zero is pure noise; one bands the picture.",
  contrast: "Tone curve for the image. Above 1 deepens the shadows into denser contours.",
};

// The only sliders exposed in the UI. Every other param stays at its default,
// including Density (`levels`), settled at 16, Spread (`evenness`), which is
// what keeps every seed's linework covering the whole canvas, and the ink
// treatment pair Stamp and Line Breaks, settled at 0.39 and 0.72.
export const SLIDER_KEYS_SIMPLE: (keyof ContourParams)[] = [
  "seed",
  "lineWidth",
];

export const SLIDER_KEYS_FIELD: (keyof ContourParams)[] = [
  "seed",
  "fieldScale",
  "octaves",
  "warp",
];

export const SLIDER_KEYS_DRAW: (keyof ContourParams)[] = ["levels", "lineWidth"];

export const SLIDER_KEYS_IMAGE: (keyof ContourParams)[] = ["imageInfluence", "contrast"];

export interface ContourLine {
  pts: number[]; // flat [x0,y0,x1,y1,...] in canvas px
  w: number;
  order: number; // 0..1 reveal order by elevation
}

export interface ContourResult {
  lines: ContourLine[];
}

// ---- field -----------------------------------------------------------------

/** Build the scalar elevation grid the contours are traced from. */
function buildField(
  gw: number,
  gh: number,
  w: number,
  h: number,
  p: ContourParams,
  buf: LumBuffer | null | undefined,
): Float64Array {
  // `p.seed` is a slider position; the field runs off the vetted seed behind it.
  const s = fieldSeed(p.seed);
  const rng = mulberry32(s);
  const noise = createNoise2D(rng);
  const warpNoiseX = createNoise2D(mulberry32(s ^ 0x1234));
  const warpNoiseY = createNoise2D(mulberry32(s ^ 0x9abc));
  const octaves = Math.max(1, Math.round(p.octaves));
  // Feature size off the canvas's area, not its long edge. Preview dims hold a
  // constant pixel area across every aspect preset, so this gives 16:9 and 9:16
  // the same landform size — and the same fill — as the square. Keyed to the long
  // edge, a wide frame stretched each landform to a third of 837px and fitted
  // barely more than one row of them into 471px of height.
  const cell = Math.sqrt(w * h) / p.fieldScale;

  const fbm = (nx: number, ny: number, fn: (x: number, y: number) => number) => {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * fn(nx * freq, ny * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm; // ~ -1..1
  };

  const values = new Float64Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      // Map grid cell to canvas px, then to noise space.
      const px = (i / (gw - 1)) * w;
      const py = (j / (gh - 1)) * h;
      const nx = px / cell;
      const ny = py / cell;
      // Domain warp: displace the sample point by a second noise field.
      const qx = warpNoiseX(nx, ny);
      const qy = warpNoiseY(nx, ny);
      const n = fbm(nx + p.warp * qx, ny + p.warp * qy, noise);
      values[j * gw + i] = (n + 1) / 2; // 0..1
    }
  }

  // Level over roughly half a landform: broader than that and the trend the
  // blank areas come from survives; tighter and it starts eating the landforms
  // themselves.
  const gridPx = w / (gw - 1);
  levelRelief(values, gw, gh, Math.max(1, Math.round(cell / 2 / gridPx)), p.evenness);

  if (buf) {
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const px = (i / (gw - 1)) * w;
        const py = (j / (gh - 1)) * h;
        const d = toneAt(buf, px * (buf.width / w), py * (buf.height / h), p);
        const k = j * gw + i;
        values[k] = values[k] * (1 - p.imageInfluence) + d * p.imageInfluence;
      }
    }
  }
  return values;
}

// How much the high-passed field is stretched back out. Subtracting the local
// mean leaves a much narrower spread than the raw field, and without this the
// thresholds would sit far outside it and trace almost nothing.
const RELIEF_GAIN = 2.2;

/**
 * Flatten the broad rise and fall under the landforms, in place, by subtracting
 * a local mean taken over roughly half a landform. What's left is each region's
 * own relief, so a seed that happens to pile all its slope into one corner
 * still carries contour lines everywhere else. `amount` blends against the raw
 * field; 0 leaves it untouched.
 */
function levelRelief(
  values: Float64Array,
  gw: number,
  gh: number,
  radius: number,
  amount: number,
) {
  if (!(amount > 0)) return;
  const blurred = boxBlur(values, gw, gh, radius);
  const a = Math.min(1, amount);
  for (let k = 0; k < values.length; k++) {
    const evened = 0.5 + (values[k] - blurred[k]) * RELIEF_GAIN;
    values[k] = values[k] * (1 - a) + evened * a;
  }
}

/**
 * Box mean over a (2r+1)² window, via a summed-area table so the radius is
 * free — it runs to half a landform, which is most of the grid. Windows are
 * cropped at the edges rather than extended, so border cells average over what
 * is actually there.
 */
function boxBlur(src: Float64Array, gw: number, gh: number, r: number): Float64Array {
  const sw = gw + 1;
  const sat = new Float64Array(sw * (gh + 1));
  for (let j = 0; j < gh; j++) {
    let rowSum = 0;
    for (let i = 0; i < gw; i++) {
      rowSum += src[j * gw + i];
      sat[(j + 1) * sw + i + 1] = sat[j * sw + i + 1] + rowSum;
    }
  }
  const out = new Float64Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    const j0 = Math.max(0, j - r);
    const j1 = Math.min(gh - 1, j + r);
    for (let i = 0; i < gw; i++) {
      const i0 = Math.max(0, i - r);
      const i1 = Math.min(gw - 1, i + r);
      const sum =
        sat[(j1 + 1) * sw + i1 + 1] -
        sat[j0 * sw + i1 + 1] -
        sat[(j1 + 1) * sw + i0] +
        sat[j0 * sw + i0];
      out[j * gw + i] = sum / ((j1 - j0 + 1) * (i1 - i0 + 1));
    }
  }
  return out;
}

export function computeContours(
  w: number,
  h: number,
  p: ContourParams,
  buf?: LumBuffer | null,
): ContourResult {
  // Grid resolution — fine enough for smooth lines, capped for performance.
  const cellPx = 3;
  const gw = Math.max(8, Math.round(w / cellPx));
  const gh = Math.max(8, Math.round(h / cellPx));
  const values = buildField(gw, gh, w, h, p, buf);

  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo) || hi <= lo) return { lines: [] };

  // Sorted copy for area-weighted (percentile) threshold placement — spreads
  // contours by how much canvas area falls in each band rather than by raw
  // elevation, so flat plateaus and basins fill with lines instead of
  // sitting blank. Blended against the plain linear spacing via `fill`.
  const sorted = Float64Array.from(values);
  sorted.sort();
  const n = sorted.length;
  const fill = Math.min(1, Math.max(0, p.fill));

  const levels = Math.max(2, Math.round(p.levels));
  const rawThresholds: number[] = [];
  for (let l = 1; l <= levels; l++) {
    const t = l / (levels + 1);
    const linear = lo + (hi - lo) * t;
    const idx = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
    const byArea = sorted[idx];
    rawThresholds.push(linear * (1 - fill) + byArea * fill);
  }
  // Dedupe — coincident thresholds would trace the same ring twice.
  const thresholds: number[] = [];
  for (const t of rawThresholds) {
    if (thresholds.length === 0 || t > thresholds[thresholds.length - 1]) {
      thresholds.push(t);
    }
  }
  if (thresholds.length < 2) return { lines: [] };

  const generator = d3contours().size([gw, gh]).thresholds(thresholds);
  const geo = generator(Array.from(values));

  const sx = w / (gw - 1);
  const sy = h / (gh - 1);
  const lines: ContourLine[] = [];
  // Smallest ring worth drawing, as a share of the canvas so it holds at any size
  // or aspect. A single tiny loop around a pinprick in the field reads as speckle
  // rather than as terrain — at the 0.0024 floor and 1080² that is about a 30px
  // radius, well under the median ring (~72px), so it takes the specks and leaves
  // the landforms. Raise it to thin out the innermost loops at each peak.
  const minRingArea = w * h * Math.max(0, p.minRing);

  geo.forEach((multi, idx) => {
    const order = thresholds.length > 1 ? idx / (thresholds.length - 1) : 1;
    for (const polygon of multi.coordinates) {
      for (const ring of polygon) {
        const pts: number[] = [];
        for (const [gx, gy] of ring) pts.push(gx * sx, gy * sy);
        if (pts.length < 6) continue;
        // Shoelace area of the closed ring.
        let a2 = 0;
        for (let i = 0, n = pts.length / 2; i < n; i++) {
          const j = (i + 1) % n;
          a2 += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
        }
        if (Math.abs(a2) / 2 < minRingArea) continue;
        lines.push({ pts, w: p.lineWidth, order });
      }
    }
  });

  return { lines };
}

// ---- rendering -------------------------------------------------------------

export function drawContours(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  result: ContourResult,
  ink: string,
  background: string,
  progress = 1,
  fade = false,
  fadeSeed = 1,
  stamp?: StampOpts,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }

  if (stampActive(stamp)) {
    drawStamped(ctx, dpr, w, h, ink, stamp, (tctx) =>
      paintContourLines(tctx, w, h, result, ink, progress, fade, fadeSeed),
    );
    return;
  }
  paintContourLines(ctx, w, h, result, ink, progress, fade, fadeSeed);
}

/** Stroke every contour ring onto `ctx` (transform must already be set). */
function paintContourLines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  result: ContourResult,
  ink: string,
  progress: number,
  fade: boolean,
  fadeSeed: number,
) {
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed, ...CONTOUR_FADE }) : null;
  let lineId = 0;
  for (const line of result.lines) {
    if (line.order > progress) {
      lineId++;
      continue;
    }
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
        }
      : null;
    const pts = line.pts;
    if (pts.length < 6) continue;
    if (
      pts[0] !== pts[pts.length - 2] ||
      pts[1] !== pts[pts.length - 1]
    ) {
      const closed = pts.slice();
      closed.push(pts[0], pts[1]);
      strokeFaded(ctx, closed, line.w, fadeOpts);
    } else {
      strokeFaded(ctx, pts, line.w, fadeOpts);
    }
  }
}

export function buildContourSVG(
  w: number,
  h: number,
  result: ContourResult,
  ink: string,
  background: string,
  fade = false,
  fadeSeed = 1,
  stamp?: StampOpts,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed, ...CONTOUR_FADE }) : null;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="${background}"/>`,
  ];

  // Ink-stamp treatment: traced into real vector paths (see stampTreatment)
  // so the export survives design tools that ignore SVG filters.
  if (stampActive(stamp)) {
    const d = traceStampPathD(w, h, ink, stamp, (tctx) =>
      paintContourLines(tctx, w, h, result, ink, 1, fade, fadeSeed),
    );
    parts.push(`<path d="${d}" fill="${ink}" fill-rule="evenodd"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  }

  parts.push(
    `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">`,
  );
  let lineId = 0;
  for (const line of result.lines) {
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
        }
      : null;
    const pts = line.pts;
    if (pts.length >= 6) {
      const closed = pts.slice();
      if (
        closed[0] !== closed[closed.length - 2] ||
        closed[1] !== closed[closed.length - 1]
      ) {
        closed.push(closed[0], closed[1]);
      }
      parts.push(svgFadedPaths(closed, line.w, fadeOpts, f));
    }
  }
  parts.push(`</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

export function randomContourParams(prev: ContourParams): ContourParams {
  const rand = mulberry32((fieldSeed(prev.seed) * 2654435761) >>> 0);
  // Only the seed, and only within the vetted list. Density, Field Scale, Detail
  // and Meander are all off the panel and settled at their defaults, and a shuffle
  // must not land on a value there is no longer any control to bring back — Detail
  // and Meander in particular would crinkle and warp the coastlines with no way to
  // flatten them again.
  return { ...prev, seed: Math.floor(rand() * CONTOUR_SEEDS.length) + 1 };
}

export { sampleLuminance };
