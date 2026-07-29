import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";
import {
  drawStamped,
  stampActive,
  traceStampPathD,
  type StampOpts,
} from "./stampTreatment";
import {
  DEFAULT_FLOW,
  FH,
  FLOW_HINTS,
  FLOW_LABELS,
  FLOW_RANGES,
  FW,
  type FlowLine,
  type FlowParams,
} from "./flowFieldCore";

// Infrastructure — PCB trace routing. Bundles of parallel conductors take
// Manhattan runs across the board, corner on 45° bevels, and hold a constant
// clearance from every lane already laid down. Where a lane runs out of room it
// simply stops, which is where the blunt stubs and combed fringes come from.
export const JW = FW;
export const JH = FH;
// Own colours rather than the flow field's — Infrastructure stays dark green on
// pale green while Healthcare's field moved to gold on cream.
export const INK = "#00280F";
export const BG = "#EBFADC";

export interface JaggedParams extends FlowParams {
  bundles: number; // how many trace bundles to route
  traces: number; // parallel conductors per bundle
  run: number; // mean straight run between corners, px
  turns: number; // max corners a bundle takes before it leaves the board
  chamfer: number; // 45° bevel cut at each corner, px (0 = square)
  curl: number; // 0..1 how strongly a bundle keeps turning the same way
  fringe: number; // 0..1 how often a single lane stops short of the bundle
}

// `spacing` is the trace pitch, `jitter` the run-length variance and
// `lineWidth` the conductor weight — reused from the flow params so the shared
// slider plumbing and ink treatment keep working unchanged.
export const DEFAULT_JAGGED: JaggedParams = {
  ...DEFAULT_FLOW,
  seed: 48218,
  spacing: 11,
  lineWidth: 1.4,
  widthVar: 0,
  jitter: 0.45,
  bundles: 44,
  traces: 8,
  run: 150,
  turns: 6,
  chamfer: 20,
  curl: 0.55,
  fringe: 0.35,
};

export const JAGGED_RANGES: Record<
  keyof JaggedParams,
  [number, number, number]
> = {
  ...FLOW_RANGES,
  bundles: [2, 80, 1],
  traces: [1, 16, 1],
  run: [20, 240, 5],
  turns: [1, 16, 1],
  chamfer: [0, 60, 1],
  curl: [0, 1, 0.02],
  fringe: [0, 1, 0.02],
};

export const JAGGED_LABELS: Record<keyof JaggedParams, string> = {
  ...FLOW_LABELS,
  spacing: "Pitch",
  lineWidth: "Trace Weight",
  jitter: "Run Variance",
  bundles: "Bundles",
  traces: "Traces",
  run: "Run Length",
  turns: "Corners",
  chamfer: "Bevel",
  curl: "Curl",
  fringe: "Fringe",
};

export const JAGGED_HINTS: Record<keyof JaggedParams, string> = {
  ...FLOW_HINTS,
  spacing: "Pitch — perpendicular gap between neighbouring traces, and the clearance a new bundle keeps from the ones already routed.",
  lineWidth: "Thickness of each conductor.",
  jitter: "How much straight runs vary in length. Zero routes on an even grid; higher staggers every corner.",
  bundles: "How many bundles to route. Later bundles are dropped once the board fills up, so this is a ceiling rather than an exact count.",
  traces: "Parallel conductors carried side by side in each bundle.",
  run: "Average straight distance a bundle travels between corners.",
  turns: "How many corners a bundle takes before it runs off the board. Low values give long sweeping lanes.",
  chamfer: "Size of the 45° cut at each corner. Zero gives square corners; high values round the turns off into long diagonals.",
  curl: "How strongly a bundle keeps turning the same way. High values coil it into nested corners; zero wanders.",
  fringe: "How often a single lane stops short of the rest of its bundle, combing the ends into staggered stubs.",
};

// The only sliders exposed in the UI. Every other param stays at its default.
export const SLIDER_KEYS_SIMPLE_JAGGED: (keyof JaggedParams)[] = [
  "seed",
  "bundles",
  "spacing",
  "traces",
  "run",
  "turns",
  "chamfer",
  "curl",
  "fringe",
  "lineWidth",
  "cutout",
];

// ---- geometry helpers ------------------------------------------------------

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

// Bevelling a right angle by `c` then offsetting the path by `t` leaves a bevel
// of `c - t·(2-√2)` on the inside of the turn (and `c + t·(2-√2)` outside) —
// the cut that keeps every lane in the bundle exactly parallel.
const BEVEL_K = 2 - Math.SQRT2;

function polylineLength(pts: number[]): number {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  }
  return len;
}

/** Liang–Barsky: the sub-range of a segment that lies inside the board. */
function clipSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: number,
  h: number,
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  // Each edge is one `p·t <= q` constraint.
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, ax)) return null;
  if (!clip(dx, w - ax)) return null;
  if (!clip(-dy, ay)) return null;
  if (!clip(dy, h - ay)) return null;
  return [t0, t1];
}

/** First run of a polyline that lies on the board, cut exactly at the edge. */
function clipToBoard(pts: number[], w: number, h: number): number[] {
  const out: number[] = [];
  let started = false;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const span = clipSegment(ax, ay, bx, by, w, h);
    if (!span) {
      if (started) break;
      continue;
    }
    const [t0, t1] = span;
    if (!started) {
      out.push(ax + (bx - ax) * t0, ay + (by - ay) * t0);
      started = true;
    }
    out.push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
    if (t1 < 1 - 1e-9) break; // left the board mid-segment — first run only
  }
  return out;
}

/** Prefix of a polyline up to `maxLen` of arc length. */
function truncateAt(pts: number[], maxLen: number): number[] {
  if (maxLen <= 0) return [];
  const out: number[] = [pts[0], pts[1]];
  let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const seg = Math.hypot(bx - ax, by - ay);
    if (acc + seg >= maxLen) {
      const f = seg > 0 ? (maxLen - acc) / seg : 0;
      out.push(ax + (bx - ax) * f, ay + (by - ay) * f);
      return out;
    }
    acc += seg;
    out.push(bx, by);
  }
  return out;
}

/**
 * Arc length at which a lane first runs into something already routed, or
 * Infinity if it stays clear the whole way.
 */
function firstBlockedLen(
  pts: number[],
  step: number,
  blocked: (x: number, y: number) => boolean,
): number {
  let acc = 0;
  if (blocked(pts[0], pts[1])) return 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const seg = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(seg / step));
    for (let s = 1; s <= n; s++) {
      const f = s / n;
      if (blocked(ax + (bx - ax) * f, ay + (by - ay) * f)) {
        // Back off one sample so the lane stops before the clearance zone.
        return Math.max(0, acc + (seg * (s - 1)) / n - step);
      }
    }
    acc += seg;
  }
  return Infinity;
}

/**
 * One bundle's centre line: an orthogonal walk that enters the board and takes
 * `turns` corners before running off an edge. Runs snap to the trace pitch so
 * bundles that meet stay in register, the way board routing does.
 */
function buildSpine(
  w: number,
  h: number,
  p: JaggedParams,
  rand: () => number,
  minRun: number,
): number[] {
  const pitch = Math.max(3, p.spacing);
  const pad = pitch * 3;
  const quant = (v: number) => Math.round(v / pitch) * pitch;
  let d = Math.floor(rand() * 4) % 4;
  let x: number;
  let y: number;

  // Most bundles enter from an edge; a few start mid-board so the interior
  // still fills in once the borders are crowded.
  if (rand() < 0.7) {
    if (d === 0) {
      x = -pad;
      y = quant(rand() * h);
    } else if (d === 1) {
      x = quant(rand() * w);
      y = -pad;
    } else if (d === 2) {
      x = w + pad;
      y = quant(rand() * h);
    } else {
      x = quant(rand() * w);
      y = h + pad;
    }
  } else {
    x = quant(rand() * w);
    y = quant(rand() * h);
  }

  const v = [x, y];
  const turn = rand() < 0.5 ? 1 : -1;
  const corners = Math.max(1, Math.round(p.turns));
  const off = (px: number, py: number) =>
    px < -pad || py < -pad || px > w + pad || py > h + pad;

  for (let i = 0; i < corners; i++) {
    const vary = 1 + (rand() - 0.5) * 2 * Math.min(1, p.jitter);
    // A bundle cannot turn back inside its own width, so no run is shorter
    // than the bundle is wide — the same constraint a real board layout has.
    const len = Math.max(minRun, quant(p.run * vary));
    x += DX[d] * len;
    y += DY[d] * len;
    v.push(x, y);
    if (i >= 1 && off(x, y)) break;
    d = (d + (rand() < 0.5 + 0.5 * p.curl ? turn : -turn) + 4) % 4;
  }
  return v;
}

/**
 * A spine that coils in on itself would carry its outer lanes straight through
 * its inner ones. Cut it at the corner before it first comes back within a
 * bundle width of ground it has already covered — the coil becomes a sweeping
 * arc that terminates, which is how a real bundle behaves when it runs out of
 * board. Points close together *along* the path are ignored, so ordinary
 * corners survive.
 */
function trimSelfCrossing(v: number[], minSep: number, step: number): number[] {
  const n = v.length / 2;
  if (n < 4) return v;
  const sx: number[] = [];
  const sy: number[] = [];
  const arc: number[] = [];
  const seg: number[] = [];
  let acc = 0;
  for (let i = 0; i + 1 < n; i++) {
    const ax = v[i * 2];
    const ay = v[i * 2 + 1];
    const bx = v[(i + 1) * 2];
    const by = v[(i + 1) * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const m = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < m; s++) {
      const f = s / m;
      sx.push(ax + (bx - ax) * f);
      sy.push(ay + (by - ay) * f);
      arc.push(acc + len * f);
      seg.push(i);
    }
    acc += len;
  }

  const min2 = minSep * minSep;
  const window = minSep * 1.6;
  for (let i = 0; i < sx.length; i++) {
    for (let j = 0; j < i; j++) {
      if (arc[i] - arc[j] < window) break; // arc is increasing — the rest are nearer still
      const dx = sx[i] - sx[j];
      const dy = sy[i] - sy[j];
      if (dx * dx + dy * dy < min2) return v.slice(0, (seg[i] + 1) * 2);
    }
  }
  return v;
}

/** +1 where the spine turns left at that vertex, -1 right, 0 straight. */
function spineTurnSigns(v: number[]): number[] {
  const n = v.length / 2;
  const signs = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const ax = v[i * 2] - v[(i - 1) * 2];
    const ay = v[i * 2 + 1] - v[(i - 1) * 2 + 1];
    const bx = v[(i + 1) * 2] - v[i * 2];
    const by = v[(i + 1) * 2 + 1] - v[i * 2 + 1];
    const cross = ax * by - ay * bx;
    signs[i] = cross > 0 ? 1 : cross < 0 ? -1 : 0;
  }
  return signs;
}

/**
 * Parallel copy of an orthogonal polyline at signed distance `t` (positive is
 * left of travel). Each corner vertex moves by both adjacent normals, which for
 * right angles is exact — no miter maths needed.
 */
function offsetOrtho(v: number[], t: number): number[] {
  const n = v.length / 2;
  if (n < 2) return v.slice();
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = v[(i + 1) * 2] - v[i * 2];
    const dy = v[(i + 1) * 2 + 1] - v[i * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    nx.push(-dy / len);
    ny.push(dx / len);
  }
  const out: number[] = [v[0] + t * nx[0], v[1] + t * ny[0]];
  for (let i = 1; i < n - 1; i++) {
    out.push(
      v[i * 2] + t * (nx[i - 1] + nx[i]),
      v[i * 2 + 1] + t * (ny[i - 1] + ny[i]),
    );
  }
  const last = n - 2;
  out.push(v[(n - 1) * 2] + t * nx[last], v[(n - 1) * 2 + 1] + t * ny[last]);
  return out;
}

/**
 * Inside a tight coil the inner lanes lose length at every corner. Once a run
 * would double back on itself the lane has nowhere left to go, so cut it there —
 * that dead end is the honest result, and reads as a terminated trace.
 */
function trimReversed(v: number[], off: number[]): number[] {
  const segs = v.length / 2 - 1;
  for (let i = 0; i < segs; i++) {
    const ox = off[(i + 1) * 2] - off[i * 2];
    const oy = off[(i + 1) * 2 + 1] - off[i * 2 + 1];
    const dx = v[(i + 1) * 2] - v[i * 2];
    const dy = v[(i + 1) * 2 + 1] - v[i * 2 + 1];
    if (ox * dx + oy * dy <= 0) return off.slice(0, (i + 1) * 2);
  }
  return off;
}

/** Cut each corner to 45°, widening the bevel outside the turn and tightening it inside. */
function bevelCorners(
  off: number[],
  turnSigns: number[],
  c: number,
  t: number,
): number[] {
  const n = off.length / 2;
  if (n < 3 || c <= 0) return off.slice();
  const out: number[] = [off[0], off[1]];
  for (let i = 1; i < n - 1; i++) {
    const px = off[(i - 1) * 2];
    const py = off[(i - 1) * 2 + 1];
    const cx = off[i * 2];
    const cy = off[i * 2 + 1];
    const qx = off[(i + 1) * 2];
    const qy = off[(i + 1) * 2 + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(qx - cx, qy - cy);
    let cut = c - t * (turnSigns[i] ?? 0) * BEVEL_K;
    cut = Math.min(cut, l1 * 0.48, l2 * 0.48);
    if (!(cut > 0.4)) {
      out.push(cx, cy);
      continue;
    }
    out.push(cx + ((px - cx) / l1) * cut, cy + ((py - cy) / l1) * cut);
    out.push(cx + ((qx - cx) / l2) * cut, cy + ((qy - cy) / l2) * cut);
  }
  out.push(off[(n - 1) * 2], off[(n - 1) * 2 + 1]);
  return out;
}

// ---- routing ---------------------------------------------------------------

export function computeJagged(
  w: number,
  h: number,
  p: JaggedParams,
): FlowLine[] {
  const pitch = Math.max(3, p.spacing);
  // Clearance grid. A lane is refused wherever it would come within `clear` of
  // ink already on the board, which is what keeps the field evenly combed.
  const grid = Math.max(2, pitch * 0.5);
  const cols = Math.ceil(w / grid) + 1;
  const rows = Math.ceil(h / grid) + 1;
  const occ = new Uint8Array(cols * rows);
  const clear = pitch * 0.85;
  const step = Math.max(1.5, pitch * 0.4);

  const blocked = (x: number, y: number) => {
    const gx = Math.floor(x / grid);
    const gy = Math.floor(y / grid);
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return true;
    return occ[gy * cols + gx] === 1;
  };

  const markPoint = (x: number, y: number) => {
    const r2 = clear * clear;
    const gx0 = Math.max(0, Math.floor((x - clear) / grid));
    const gx1 = Math.min(cols - 1, Math.floor((x + clear) / grid));
    const gy0 = Math.max(0, Math.floor((y - clear) / grid));
    const gy1 = Math.min(rows - 1, Math.floor((y + clear) / grid));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = (gx + 0.5) * grid - x;
        const dy = (gy + 0.5) * grid - y;
        if (dx * dx + dy * dy <= r2) occ[gy * cols + gx] = 1;
      }
    }
  };

  const markPolyline = (pts: number[]) => {
    markPoint(pts[0], pts[1]);
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const ay = pts[i + 1];
      const bx = pts[i + 2];
      const by = pts[i + 3];
      const seg = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(seg / (step * 0.5)));
      for (let s = 1; s <= n; s++) {
        const f = s / n;
        markPoint(ax + (bx - ax) * f, ay + (by - ay) * f);
      }
    }
  };

  const rand = mulberry32(p.seed ^ 0x9e3779b9);
  const want = Math.max(1, Math.round(p.bundles));
  const attempts = Math.min(600, want * 6);
  const count = Math.max(1, Math.round(p.traces));
  const minTotal = pitch * 12;
  // Bundle width plus one pitch of clearance — the tightest turn it can make.
  const minSep = (count - 1) * pitch + pitch;
  const lines: FlowLine[] = [];
  let placed = 0;

  for (let a = 0; a < attempts && placed < want; a++) {
    const spine = trimSelfCrossing(
      buildSpine(w, h, p, rand, minSep),
      minSep,
      Math.max(2, pitch),
    );
    if (spine.length < 6) continue;
    const turnSigns = spineTurnSigns(spine);
    const batch: FlowLine[] = [];
    let total = 0;

    for (let k = 0; k < count; k++) {
      const t = (k - (count - 1) / 2) * pitch;
      const parallel = trimReversed(spine, offsetOrtho(spine, t));
      if (parallel.length < 4) continue;
      const beveled = bevelCorners(parallel, turnSigns, p.chamfer, t);
      const onBoard = clipToBoard(beveled, w, h);
      if (onBoard.length < 4) continue;

      const cutAt = firstBlockedLen(onBoard, step, blocked);
      let kept = Number.isFinite(cutAt) ? truncateAt(onBoard, cutAt) : onBoard;
      // Fringe: a lane that stops short of its neighbours. Drawn per lane so
      // the bundle's ends comb out instead of shearing off flat.
      if (kept.length >= 4 && p.fringe > 0 && rand() < p.fringe) {
        kept = truncateAt(kept, polylineLength(kept) * (0.25 + rand() * 0.6));
      }
      if (kept.length < 4) continue;
      const len = polylineLength(kept);
      if (len < pitch * 2) continue;

      total += len;
      const wdt = p.lineWidth * (1 + (rand() - 0.5) * 2 * p.widthVar);
      // `order` carries the bundle index here; normalised to 0..1 below so the
      // growth animation lays the board down bundle by bundle.
      batch.push({
        pts: kept,
        w: Math.max(0.15, wdt),
        order: placed,
        arrow: false,
      });
    }

    if (batch.length < 2 || total < minTotal) continue;
    for (const line of batch) markPolyline(line.pts);
    lines.push(...batch);
    placed++;
  }

  const denom = Math.max(1, placed - 1);
  for (const line of lines) line.order = line.order / denom;
  return lines;
}

/** Each trace is stroked on its own so bevels stay crisp lines, not filled joins. */
export function drawJagged(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  lines: FlowLine[],
  _p: JaggedParams,
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
      paintJaggedLines(tctx, w, h, lines, ink, progress, fade, fadeSeed),
    );
    return;
  }
  paintJaggedLines(ctx, w, h, lines, ink, progress, fade, fadeSeed);
}

/** Stroke every trace onto `ctx` (transform must already be set). */
function paintJaggedLines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lines: FlowLine[],
  ink: string,
  progress: number,
  fade: boolean,
  fadeSeed: number,
) {
  ctx.strokeStyle = ink;
  ctx.lineCap = fade ? "round" : "butt";
  ctx.lineJoin = fade ? "round" : "miter";

  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;

  const SPREAD = 0.65;
  const denom = 1 - SPREAD;

  let lineId = 0;
  for (const line of lines) {
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
        }
      : null;
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
    const segs = pts.length / 2 - 1;
    if (segs < 1) continue;
    const grown = segs * t;
    const full = Math.floor(grown);
    const frac = grown - full;

    const draw: number[] = [pts[0], pts[1]];
    const last = Math.min(full, segs);
    for (let i = 1; i <= last; i++) draw.push(pts[i * 2], pts[i * 2 + 1]);
    if (frac > 0 && full < segs) {
      const ax = pts[full * 2];
      const ay = pts[full * 2 + 1];
      const bx = pts[(full + 1) * 2];
      const by = pts[(full + 1) * 2 + 1];
      draw.push(ax + (bx - ax) * frac, ay + (by - ay) * frac);
    }
    strokeFaded(ctx, draw, line.w, fadeOpts);
  }
}

export function buildJaggedSVG(
  w: number,
  h: number,
  lines: FlowLine[],
  _p: JaggedParams,
  ink: string,
  background: string,
  fade = false,
  fadeSeed = 1,
  stamp?: StampOpts,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="${background}"/>`,
  ];

  // Ink-stamp treatment: traced into real vector paths (see stampTreatment)
  // so the export survives design tools that ignore SVG filters.
  if (stampActive(stamp)) {
    const d = traceStampPathD(w, h, ink, stamp, (tctx) =>
      paintJaggedLines(tctx, w, h, lines, ink, 1, fade, fadeSeed),
    );
    parts.push(`<path d="${d}" fill="${ink}" fill-rule="evenodd"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  }

  parts.push(
    `<g fill="none" stroke="${ink}" stroke-linecap="${fade ? "round" : "butt"}" stroke-linejoin="${fade ? "round" : "miter"}" stroke-miterlimit="6">`,
  );
  let lineId = 0;
  for (const line of lines) {
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
        }
      : null;
    parts.push(svgFadedPaths(line.pts, line.w, fadeOpts, f));
  }
  parts.push(`</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

export function randomJaggedParams(prev: JaggedParams): JaggedParams {
  const rand = mulberry32((prev.seed * 2654435761) >>> 0);
  const pick = (min: number, max: number, step: number) => {
    const steps = Math.floor((max - min) / step);
    return min + Math.round(rand() * steps) * step;
  };
  return {
    ...prev,
    seed: Math.floor(rand() * 99999) + 1,
    bundles: pick(14, 40, 1),
    traces: pick(4, 11, 1),
    run: pick(60, 160, 5),
    turns: pick(4, 12, 1),
    chamfer: pick(8, 28, 1),
    curl: pick(0.4, 1, 0.02),
    fringe: pick(0.1, 0.6, 0.02),
    spacing: pick(8, 16, 1),
  };
}
