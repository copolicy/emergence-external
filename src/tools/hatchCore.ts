import { mulberry32 } from "./specimenTreeCore";
import { strokeFaded, svgFadedPaths } from "./dissolveFade";
import {
  drawStamped,
  stampActive,
  traceStampPathD,
  type StampOpts,
} from "./stampTreatment";

// Financial Services — a scattered matchstick hatch. Straight strokes only, cast
// at a handful of snapped headings and dropped in small parallel bundles, so the
// overlaps read as tally marks and hash crosses rather than woven ridges. The
// field packs solid at the top and thins out downward through the fade pass.
export const HW = 680;
export const HH = 580;
export const INK = "#195519"; // Mid green
export const BG = "#F5F5F2"; // Cream

export interface HatchParams {
  seed: number;
  spacing: number; // cluster grid cell in px — lower packs the mat denser
  length: number; // stroke length in px
  lengthVar: number; // 0..1 variation around that length
  facets: number; // how many headings the lattice allows
  wobble: number; // degrees of per-stroke drift off the snapped heading
  align: number; // 0..1 headings follow a noise field vs. pure chance
  bundle: number; // parallel siblings dropped per cluster
  gap: number; // perpendicular spacing between siblings in px
  jitter: number; // 0..1 scatter of cluster centres off the grid
  lineWidth: number;
  widthVar: number;
  // ink treatment — the same stamp/cutout render pass the Root Brush runs
  stamp: number; // 0..1 ink-stamp fatten/smooth pass (0 = off)
  cutout: number; // 0..1 cutout break/simplify pass (0 = off)
}

// The mat's structure is fixed, not dialled: cluster spacing, stick length,
// heading count and the shape of the bundle are what make this read as
// Financial Services, so they're set here and kept off the rail. Seed, Line
// Weight and Line Breaks are the ones left to play with.
export const DEFAULT_HATCH: HatchParams = {
  seed: 44425,
  spacing: 40,
  length: 65,
  // Uniform sticks — every stroke is cut to the same length. Depth variation
  // comes from the fade pass truncating them, not from the cut itself.
  lengthVar: 0,
  facets: 7,
  wobble: 5,
  // Zero — every cluster picks its heading on its own. Any alignment at all
  // pulls neighbours into families and the mat starts to comb one way.
  align: 0,
  // Always a pair, always this far apart — the tally-mark read depends on it.
  bundle: 2,
  gap: 14.5,
  // Low enough that clusters hold their grid slot — high jitter lets pairs
  // wander onto each other and the field mats up instead of reading as marks.
  jitter: 0.4,
  lineWidth: 2.3,
  widthVar: 0.12,
  // No fatten pass — just enough cutout to nick the ink where sticks cross.
  // Line Breaks is a fraction of the ink's own weight, so with no stamp to
  // fatten it this sits high on the slider to bite the same amount.
  stamp: 0,
  cutout: 0.81,
};

export const HATCH_RANGES: Record<keyof HatchParams, [number, number, number]> =
  {
    seed: [1, 99999, 1],
    spacing: [10, 60, 1],
    length: [20, 180, 1],
    lengthVar: [0, 1, 0.02],
    facets: [2, 12, 1],
    wobble: [0, 30, 0.5],
    align: [0, 1, 0.05],
    bundle: [1, 5, 1],
    gap: [3, 28, 0.5],
    jitter: [0, 1, 0.05],
    lineWidth: [0.3, 4, 0.1],
    widthVar: [0, 0.6, 0.02],
    stamp: [0, 0.45, 0.01],
    cutout: [0, 1, 0.01],
  };

export const HATCH_LABELS: Record<keyof HatchParams, string> = {
  seed: "Seed",
  spacing: "Density",
  length: "Stick Length",
  lengthVar: "Length Variation",
  facets: "Headings",
  wobble: "Wobble",
  align: "Alignment",
  bundle: "Bundle",
  gap: "Bundle Gap",
  jitter: "Jitter",
  lineWidth: "Line Weight",
  widthVar: "Weight Variation",
  stamp: "Stamp",
  cutout: "Line Breaks",
};

export const HATCH_HINTS: Record<keyof HatchParams, string> = {
  seed: "Random starting value. Same seed always produces the same hatch.",
  spacing: "How tightly clusters sit together. Higher values pack a denser mat.",
  length: "Length of each stick.",
  lengthVar: "How much stick lengths vary around that length.",
  facets:
    "How many headings the lattice allows. Six gives 30° steps — verticals, horizontals and diagonals.",
  wobble: "Drift off the snapped heading, so parallels stay hand-cast.",
  align:
    "How strongly neighbouring sticks share a heading. Zero scatters every angle; one groups them into drifting families.",
  bundle:
    "How many parallel sticks land side by side per cluster — two by default. Bundles crossing bundles make the tally-mark hashes.",
  gap: "Perpendicular spacing between the sticks in a bundle.",
  jitter: "Scatter of cluster centres off the grid — breaks up the rows.",
  lineWidth: "Thickness of each stick.",
  widthVar: "How much stick weights vary.",
  stamp:
    "Ink-stamp fatten pass (à la Photoshop's Stamp filter). Spreads and smooths the linework into solid calligraphic ink, fusing fine clusters. Zero switches it off.",
  cutout:
    "Cutout pass (à la Photoshop's Cutout filter). Simplifies the stroke contours and pinches thin spots into organic breaks and dashes — never thickens the line. Zero switches it off.",
};

export const SLIDER_KEYS_SIMPLE_HATCH: (keyof HatchParams)[] = [
  "seed",
  "lineWidth",
  "cutout",
];

export interface HatchLine {
  pts: number[];
  w: number;
  order: number;
  /** Cluster centre across the width, 0 at the left edge — feeds the left relief. */
  xn: number;
  /** Cluster this stick belongs to — siblings share it and live or die as one. */
  group: number;
}

function hash2(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed, 2654435761);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Depth thinning. The shared dissolve tapers each vector's tip, which would
// leave hairline stubs and uneven lengths here — the mat instead loses whole
// sticks as it descends: solid at the top, scattered pairs at the bottom.
const FADE_TOP = 0.38; // full density above this fraction of the height
const FADE_CURVE = 1.1; // >1 holds density longer before it drops away

// Left-edge relief. A second, much gentler thinning that reaches a fifth of the
// way in and leans into the bottom-left corner, so the mat breathes off that
// margin instead of butting into it. Kept deliberately shallow — it should read
// as a little air at the edge, never as a second fade.
const LEFT_REACH = 0.2; // fraction of the width the relief touches
const LEFT_TOP = 0.07; // share of clusters it takes at the top-left…
const LEFT_BOTTOM = 0.2; // …and at the bottom-left, where the two fades stack

/** True while this cluster survives the thinning at its own place in the field. */
function survivesDepth(
  id: number,
  xn: number,
  yn: number,
  seed: number,
): boolean {
  let keep = 1;
  if (yn > FADE_TOP) {
    const t = Math.min(1, (yn - FADE_TOP) / (1 - FADE_TOP));
    keep = 1 - Math.pow(t, FADE_CURVE);
  }
  if (xn < LEFT_REACH) {
    // Squared, so the relief is only really felt in the last stretch of margin.
    const t = 1 - xn / LEFT_REACH;
    const strength = LEFT_TOP + (LEFT_BOTTOM - LEFT_TOP) * yn;
    keep *= 1 - strength * t * t;
  }
  return hash2(id, 0x51ed, seed) < keep;
}

/** Do these two sticks properly cross? Shared endpoints and touches don't count. */
function sticksCross(s: number[], t: number[]): boolean {
  const side = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = side(t[0], t[1], t[2], t[3], s[0], s[1]);
  const d2 = side(t[0], t[1], t[2], t[3], s[2], s[3]);
  const d3 = side(s[0], s[1], s[2], s[3], t[0], t[1]);
  const d4 = side(s[0], s[1], s[2], s[3], t[2], t[3]);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

// Overlap relief. Placement used to be blind — a cluster took its slot whatever
// was already lying there, and bundles piled into knots. Each cluster now
// auditions a few positions and keeps the one crossing the fewest sticks
// already down. Every cluster still lands, so this unpicks the knots without
// thinning the field; a first-try clean landing skips the rest.
//
// Only the position is auditioned, never the heading. Parallel sticks can't
// cross, so letting the heading chase a low score combs the whole field into
// one direction — the facet lattice is what keeps the angles scattered, and it
// stays out of this.
const PLACE_TRIES = 4;

/**
 * Scatter straight sticks on a jittered grid. Each cluster picks one heading off
 * the facet lattice — either from a noise field (neighbours agree) or at random
 * (they don't) — then lays a fixed bundle of parallels across it, nudged to the
 * least-tangled of a handful of nearby positions.
 */
export function computeHatch(w: number, h: number, p: HatchParams): HatchLine[] {
  const cell = Math.max(8, p.spacing);
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const facets = Math.max(2, Math.round(p.facets));
  const step = Math.PI / facets; // headings are undirected — half a turn covers them
  const wobble = (p.wobble * Math.PI) / 180;
  const noiseCell = cell * 5.5;
  const rand = mulberry32(p.seed ^ 0x7a51);
  const lines: HatchLine[] = [];
  let group = 0;

  // Uniform-grid index over the sticks already down, so auditioning a placement
  // only tests the handful of neighbours that could actually reach it.
  const bucket = Math.max(cell, p.length);
  const placed: number[][] = [];
  const index = new Map<number, number[]>();
  const bucketKey = (ix: number, iy: number) => ix * 73856093 + iy * 19349663;
  const spanOf = (s: number[]) => [
    Math.floor(Math.min(s[0], s[2]) / bucket),
    Math.floor(Math.min(s[1], s[3]) / bucket),
    Math.floor(Math.max(s[0], s[2]) / bucket),
    Math.floor(Math.max(s[1], s[3]) / bucket),
  ];
  const addStick = (s: number[]) => {
    const id = placed.push(s) - 1;
    const [ix0, iy0, ix1, iy1] = spanOf(s);
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const k = bucketKey(ix, iy);
        const list = index.get(k);
        if (list) list.push(id);
        else index.set(k, [id]);
      }
  };
  const countCrossings = (s: number[]) => {
    const [ix0, iy0, ix1, iy1] = spanOf(s);
    // A stick spans several buckets, so tally ids once rather than per bucket.
    const seen = new Set<number>();
    let n = 0;
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const list = index.get(bucketKey(ix, iy));
        if (!list) continue;
        for (const id of list) {
          if (seen.has(id)) continue;
          seen.add(id);
          if (sticksCross(s, placed[id])) n++;
        }
      }
    return n;
  };

  // Fixed count — every cluster is a pair, so the field reads as tally
  // marks throughout instead of thinning into stray singles.
  const count = Math.max(1, Math.round(p.bundle));
  const spread = (count - 1) * p.gap * 0.5;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gid = group++;
      // One weight per cluster — siblings are one mark, not two separate ones.
      const wdt = Math.max(
        0.15,
        p.lineWidth * (1 + (rand() - 0.5) * 2 * p.widthVar),
      );

      // Heading is settled once, off the cell's own centre, before any position
      // is tried — see PLACE_TRIES. Facet choice: noise-led families vs. loose
      // scatter.
      const field = fbm(
        ((c + 0.5) * cell) / noiseCell,
        ((r + 0.5) * cell) / noiseCell,
        p.seed,
        2,
      );
      const pickNoise = rand() < p.align;
      const facet = pickNoise
        ? Math.floor(field * facets) % facets
        : Math.floor(rand() * facets);
      const a = facet * step + (rand() - 0.5) * 2 * wobble;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // Bundle siblings step off perpendicular to the heading.
      const px = -uy;
      const py = ux;

      let best: { sticks: number[][]; order: number; xn: number } | null = null;
      let bestCrossings = Infinity;

      for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
        const cx = (c + 0.5) * cell + (rand() - 0.5) * cell * p.jitter * 2;
        const cy = (r + 0.5) * cell + (rand() - 0.5) * cell * p.jitter * 2;

        const sticks: number[][] = [];
        for (let b = 0; b < count; b++) {
          const off = b * p.gap - spread;
          const len = p.length * (1 + (rand() - 0.5) * 2 * p.lengthVar);
          if (len < 4) continue;
          // Pure perpendicular offset — no slide along the heading. Staggering the
          // siblings reads as one angled bundle instead of two parallel marks.
          const mx = cx + px * off;
          const my = cy + py * off;
          const hx = (ux * len) / 2;
          const hy = (uy * len) / 2;
          const x0 = mx - hx;
          const y0 = my - hy;
          const x1 = mx + hx;
          const y1 = my + hy;
          // Fully off-canvas sticks cost draw time and never show.
          if (Math.max(x0, x1) < 0 || Math.min(x0, x1) > w) continue;
          if (Math.max(y0, y1) < 0 || Math.min(y0, y1) > h) continue;
          // Fade truncates a prefix, so store each stick pointing downward —
          // otherwise the upper half is what gets clipped away.
          sticks.push(y0 <= y1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0]);
        }

        let crossings = 0;
        for (const s of sticks) crossings += countCrossings(s);
        if (crossings < bestCrossings) {
          bestCrossings = crossings;
          best = {
            sticks,
            // One depth per cluster, taken at its centre. Read off each sibling's
            // own midpoint instead and the pair straddles the thinning threshold —
            // growth lands them a beat apart and the fade keeps one, leaving
            // stray singles.
            order: Math.min(1, Math.max(0, cy / Math.max(1, h))),
            xn: Math.min(1, Math.max(0, cx / Math.max(1, w))),
          };
        }
        if (bestCrossings === 0) break;
      }
      if (!best) continue;

      for (const s of best.sticks) {
        addStick(s);
        lines.push({
          pts: s,
          w: wdt,
          // Order runs top-down so growth fills the dense band first.
          order: best.order,
          xn: best.xn,
          group: gid,
        });
      }
    }
  }

  return lines;
}

export function drawHatch(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  lines: HatchLine[],
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
      paintHatchLines(tctx, lines, ink, progress, fade, fadeSeed),
    );
    return;
  }
  paintHatchLines(ctx, lines, ink, progress, fade, fadeSeed);
}

/** Stroke every stick onto `ctx` (transform must already be set). */
function paintHatchLines(
  ctx: CanvasRenderingContext2D,
  lines: HatchLine[],
  ink: string,
  progress: number,
  fade: boolean,
  fadeSeed: number,
) {
  ctx.strokeStyle = ink;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";

  const SPREAD = 0.65;
  const denom = 1 - SPREAD;

  for (const line of lines) {
    // Keyed on the cluster, not the stick, so a bundle thins out whole and the
    // tail never breaks down into singles. Survivors keep their full length.
    if (fade && !survivesDepth(line.group, line.xn, line.order, fadeSeed))
      continue;
    const local =
      progress >= 1
        ? 1
        : denom <= 0
          ? progress > line.order
            ? 1
            : 0
          : (progress - line.order * SPREAD) / denom;
    if (local <= 0) continue;
    const t = local >= 1 ? 1 : local;

    const pts = line.pts;
    // Each stick draws itself from one end, so growth reads as strokes landing.
    const draw =
      t >= 1
        ? pts
        : [
            pts[0],
            pts[1],
            pts[0] + (pts[2] - pts[0]) * t,
            pts[1] + (pts[3] - pts[1]) * t,
          ];
    strokeFaded(ctx, draw, line.w, null);
  }
}

export function buildHatchSVG(
  w: number,
  h: number,
  lines: HatchLine[],
  ink: string,
  background: string,
  fade = false,
  fadeSeed = 1,
  stamp?: StampOpts,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="${background}"/>`,
  ];

  // Ink-stamp treatment: traced into real vector paths (see stampTreatment)
  // so the export survives design tools that ignore SVG filters.
  if (stampActive(stamp)) {
    const d = traceStampPathD(w, h, ink, stamp, (tctx) =>
      paintHatchLines(tctx, lines, ink, 1, fade, fadeSeed),
    );
    parts.push(`<path d="${d}" fill="${ink}" fill-rule="evenodd"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  }

  parts.push(`<g fill="none" stroke="${ink}" stroke-linecap="butt">`);
  for (const line of lines) {
    if (fade && !survivesDepth(line.group, line.xn, line.order, fadeSeed))
      continue;
    parts.push(svgFadedPaths(line.pts, line.w, null, f));
  }
  parts.push(`</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}
