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

// Infrastructure — PCB trace routing. Bundles of parallel conductors run only
// straight up, down, left or right — never on the diagonal — and change heading
// on square corners cut back into
// deep 45° mitres, the setback stepped per lane so the whole bundle stays
// parallel through the turn: the innermost lane cuts almost square, the outermost
// carries a long diagonal face. Every bundle holds a constant clearance from the
// lanes already laid down, and where one runs out of room it simply stops —
// which is where the blunt stubs and combed fringes come from, biased downward by
// `drop` so the board frays along its underside the way a real cable run does.
export const JW = FW;
export const JH = FH;
// Own colours rather than the flow field's — Infrastructure reverses out to
// cream on mid green while Healthcare's field moved to gold on cream.
export const INK = "#195519"; // Mid green
export const BG = "#F5F5F2"; // Cream

export interface JaggedParams extends FlowParams {
  bundles: number; // how many trace bundles to route
  traces: number; // parallel conductors in the widest bundle
  ribbonVar: number; // 0..1 how far narrower bundles fall short of `traces`
  run: number; // mean straight run between corners, px
  turns: number; // max corners a bundle takes before it leaves the board
  corner: number; // turn radius on the bundle's centre line, px (0 = square)
  facets: number; // straight faces per corner — 1 is a plain 45° mitre, more step it round
  curl: number; // 0..1 how strongly a bundle keeps turning the same way
  switchback: number; // 0..1 how often a turn becomes a 180° U instead of one corner
  margin: number; // 0..1 keep-out down the left edge, widening toward the bottom
  nest: number; // 0..1 how often a bundle routes alongside one already placed
  settle: number; // 0..1 how strongly bundles stop cornering and run straight down
                  // once they reach the lower left, so the board resolves that way
  fringe: number; // 0..1 how often a single lane stops short of the bundle
  drop: number; // 0..1 how strongly those stops land on a downward run
  trail: number; // 0..1 how far a downward lane carries on past its end as dashes
}

// `spacing` is the trace pitch, `jitter` the run-length variance and
// `lineWidth` the conductor weight — reused from the flow params so the shared
// slider plumbing and ink treatment keep working unchanged.
export const DEFAULT_JAGGED: JaggedParams = {
  ...DEFAULT_FLOW,
  seed: 32050,
  spacing: 11,
  lineWidth: 2,
  widthVar: 0,
  // Off by default: the fatten pass spreads each lane toward its neighbours, and
  // there is only about `spacing - lineWidth` of gap to give away before a ribbon
  // closes into a solid band. Exposed as a slider because that fusing is a usable
  // effect, not only a failure mode.
  stamp: 0,
  // A leg can only carry a mitre half its own length, so the deeper the bevel the
  // less a run may vary before the outer lanes start clamping and the bundle stops
  // being parallel through the turn. Keep the variance modest at this depth.
  jitter: 0.3,
  bundles: 45,
  traces: 9,
  ribbonVar: 0.5,
  // Sits under the floor that the deepest lane's two mitres impose at this pitch,
  // width and corner radius — `2·(corner + halfSpan) + 2·gap`, about 212px here —
  // so legs come out at that floor and Run Variance only ever lengthens them.
  // Raise `run` past the floor before reaching for Run Variance.
  run: 170,
  turns: 14,
  // Deep enough that the mitre on the outer lanes reads as a long 45° face rather
  // than a nicked corner, which is what makes the bundles turn like routed copper.
  corner: 40,
  facets: 2,
  curl: 0.24,
  switchback: 0.45,
  margin: 0.6,
  nest: 0.5,
  settle: 0.55,
  fringe: 0.35,
  cutout: 0.82,
  drop: 0.8,
  // Around three dashes past each blunt end, shortening as they go. Only lanes that
  // stopped heading straight down and with clear board below get any, so this reads
  // as the curtain dissolving into ticks rather than stippling the whole field.
  trail: 0.3,
};

export const JAGGED_RANGES: Record<
  keyof JaggedParams,
  [number, number, number]
> = {
  ...FLOW_RANGES,
  bundles: [2, 80, 1],
  traces: [1, 16, 1],
  ribbonVar: [0, 1, 0.02],
  run: [20, 260, 5],
  turns: [1, 16, 1],
  corner: [0, 80, 1],
  facets: [1, 10, 1],
  curl: [0, 1, 0.02],
  switchback: [0, 1, 0.02],
  margin: [0, 1, 0.02],
  nest: [0, 1, 0.02],
  settle: [0, 1, 0.02],
  fringe: [0, 1, 0.02],
  drop: [0, 1, 0.02],
  trail: [0, 1, 0.02],
};

export const JAGGED_LABELS: Record<keyof JaggedParams, string> = {
  ...FLOW_LABELS,
  spacing: "Pitch",
  lineWidth: "Line Weight",
  jitter: "Run Variance",
  bundles: "Bundles",
  traces: "Traces",
  ribbonVar: "Ribbon Var",
  run: "Run Length",
  turns: "Corners",
  corner: "Corner Radius",
  facets: "Corner Steps",
  curl: "Curl",
  switchback: "Switchback",
  margin: "Left Margin",
  nest: "Nest",
  settle: "Settle",
  fringe: "Fringe",
  drop: "Drop",
  trail: "Trail Off",
};

export const JAGGED_HINTS: Record<keyof JaggedParams, string> = {
  ...FLOW_HINTS,
  spacing: "Pitch — perpendicular gap between neighbouring traces, and the clearance a new bundle keeps from the ones already routed.",
  lineWidth: "Thickness of each conductor.",
  jitter: "How much straight runs vary in length. Zero routes on an even grid; higher staggers every corner.",
  bundles: "How many bundles to route. Later bundles are dropped once the board fills up, so this is a ceiling rather than an exact count.",
  traces: "Conductors in the widest bundle. Narrower bundles are drawn from this by Ribbon Var.",
  ribbonVar: "How much bundles vary in width. Zero makes every ribbon the same; higher mixes fat cable with thin.",
  run: "Average straight distance a bundle travels between corners.",
  turns: "How many corners a bundle takes before it runs off the board. Low values give long sweeping lanes.",
  corner: "Turn radius measured on the bundle's centre line. Lanes inside the turn ride tighter, lanes outside sweep wider — so the whole bundle stays parallel. Zero gives square corners.",
  facets: "How many straight faces a corner is cut into. One is the single 45° mitre of board layout; two or three step the turn round in stages; high counts read as a smooth arc.",
  curl: "How strongly a bundle keeps turning the same way. High values coil it into nested corners; zero wanders.",
  switchback: "How often a turn doubles into a 180° U — out, across, and back — instead of a single corner. This is what builds the nested hooks.",
  margin:
    "How much of the left edge is kept clear, widening toward the bottom so traces still reach the edge up high while the lower corner opens up for type. Lanes stop against it blunt and staggered, the same way they stop against other ink.",
  nest: "How often a new bundle routes alongside one already placed, sharing its corners at the same pitch instead of finding its own path.",
  settle:
    "How strongly a bundle gives up cornering and runs straight off the bottom once it reaches the lower left, so the board resolves from dense routing into a curtain of descending lanes. Zero treats every region alike.",
  fringe: "How often a single lane stops short of the rest of its bundle, combing the ends into staggered stubs.",
  drop: "How strongly those stops land where the lane is heading downward, so the stubs hang off the underside of the board as vertical drips.",
  trail:
    "How far a descending lane on the left carries on past its blunt end as dashes that shorten and space out — the trace dissolving into ticks. Only applies where the board has settled into its curtain; the cornered routing on the right is left continuous. A lane that stopped because it ran into other ink gets no trail either, since there is nowhere for it to go.",
};

// The only sliders exposed in the UI. Every other param stays at its default —
// `bundles`, `ribbonVar`, `switchback`, `nest`, `settle` and `drop` set the
// board's character rather than tune a composition, and so now do the routing
// dimensions `margin`, `spacing`, `run`, `turns`, `corner`, `facets`, `fringe` and
// `trail`: the geometry of the board is settled, and what is left on the rail is how
// it is inked. They are dialled in above and left alone. Move one back into this
// list if it turns out to need reaching for.
export const SLIDER_KEYS_SIMPLE_JAGGED: (keyof JaggedParams)[] = [
  "seed",
  "traces",
  "curl",
  "lineWidth",
  "stamp",
  "cutout",
];

// ---- geometry helpers ------------------------------------------------------

// How far in from the left edge the board counts as settled: where bundles give up
// cornering, and where trailing-off is allowed. Shared so the two agree on the
// boundary — the curtain and the dashes should start in the same place.
const SETTLE_REACH = 0.62;

// The four Manhattan directions, `d` counting clockwise from +x with y pointing
// down, so a 90° turn is ±1 step and a reversal ±2. Legs are axis-aligned and
// nothing else: the only 45° on the board comes from the mitres `facetCorners`
// cuts into each corner, never from a leg that travels diagonally.
//
// Capping every turn at 90° is also what keeps `offsetPath` well behaved. Its
// mitre divides by `1 + n₁·n₂`, which collapses toward zero as a turn approaches
// 180°, so a reversal throws every lane's mitre point to the same spot and the
// bundle converges into a spearhead instead of staying parallel.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const DOWN = 1; // index of +y above — the heading the composition resolves toward
const UP = 3;

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
 * One bundle's centre line: a walk on the Manhattan grid that enters the board and
 * takes `turns` square corners before running off an edge. Legs snap to the trace
 * pitch so bundles that meet stay in register, the way board routing does.
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
  // Every leg is axis-aligned, so one unit serves both axes.
  const quantRun = (len: number) =>
    Math.max(pitch, Math.round(len / pitch) * pitch);

  // Most bundles enter from an edge heading inward; a few start mid-board so the
  // interior still fills in once the borders are crowded.
  //
  // Entry is weighted toward the top and right so bundles travel down and left,
  // which is the direction the composition resolves in. Entering uniformly sends
  // as many bundles rightward *out* of the left side as settle into it, and the
  // curtain never forms.
  const roll = rand();
  const edge = roll < 0.14 ? 0 : roll < 0.52 ? 1 : roll < 0.84 ? 2 : 3;
  let d = edge; // left→+x, top→+y, right→−x, bottom→−y
  let x: number;
  let y: number;
  if (rand() < 0.7) {
    if (edge === 0) {
      x = -pad;
      y = quant(rand() * h);
    } else if (edge === 1) {
      x = quant(rand() * w);
      y = -pad;
    } else if (edge === 2) {
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

  // A switchback is two same-signed 90° turns with only a short leg between
  // them — the U that gives the reference its nested hooks. `pairLeft` counts
  // the turns still owed to one, and forces the leg between them short and
  // orthogonal so the U actually closes.
  let pairLeft = 0;
  const cross = minRun + pitch * 2;

  for (let i = 0; i < corners; i++) {
    const vary = 1 + (rand() - 0.5) * 2 * Math.min(1, p.jitter);
    // A bundle cannot turn back inside its own width, so no run is shorter
    // than the bundle is wide — the same constraint a real board layout has.
    const len =
      pairLeft > 0 ? quantRun(cross) : Math.max(minRun, quantRun(p.run * vary));
    x += DX[d] * len;
    y += DY[d] * len;
    v.push(x, y);
    if (i >= 1 && off(x, y)) break;
    // Composition bias. The board is meant to resolve from dense cornered routing
    // on the right into a curtain of descending lanes down the left, so once a
    // bundle has worked its way leftward it stops turning and runs straight off the
    // bottom — the tail of the run rather than more routing. Keyed on x alone: the
    // curtain hangs the full height of the left side, not just its bottom corner.
    const settled = Math.max(0, 1 - x / (w * SETTLE_REACH));
    // A bundle already heading up cannot swing straight down here: that is a 180°
    // reversal, and `offsetPath`'s mitre degenerates there — every lane in the
    // ribbon lands on the same point and the bundle fans out from a spearhead
    // instead of turning as a parallel family. Let it take its ordinary 90° turn
    // to horizontal instead; settle then catches it at the next corner.
    if (
      pairLeft === 0 &&
      p.settle > 0 &&
      d !== UP &&
      rand() < p.settle * settled
    ) {
      d = DOWN;
      // Stop the curtain at a staggered height rather than always running it off
      // the bottom. A lane that exits the edge has no interior end, so there is
      // nothing for the fringe or the trailing-off to act on — the reference's
      // curtain ends part-way down and dissolves into ticks below.
      const reach = (h - y) * (0.4 + rand() * 0.65);
      const drop = quantRun(Math.max(minRun, reach));
      x += DX[d] * drop;
      y += DY[d] * drop;
      v.push(x, y);
      break;
    }
    // Every branch turns exactly one step — a square corner. Nothing here may
    // compose two steps into a reversal; the U of a switchback is built from two
    // separate 90° corners with a leg between them, which is how board routing
    // doubles back.
    if (pairLeft > 0) {
      d = (d + turn + 4) % 4;
      pairLeft--;
    } else if (rand() < p.switchback) {
      d = (d + turn + 4) % 4;
      pairLeft = 1;
    } else {
      const sign = rand() < 0.5 + 0.5 * p.curl ? turn : -turn;
      d = (d + sign + 4) % 4;
    }
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
 * Parallel copy of a polyline at signed distance `t` (positive is left of
 * travel). Each corner vertex moves to the miter point `t·(n₁+n₂)/(1+n₁·n₂)`,
 * which at right angles reduces to `t·(n₁+n₂)` — the exact case this routing
 * used to be limited to — and stays exact for the 45° legs too.
 */
function offsetPath(v: number[], t: number): number[] {
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
    const k = 1 + (nx[i - 1] * nx[i] + ny[i - 1] * ny[i]);
    const m = k > 1e-6 ? t / k : t;
    out.push(
      v[i * 2] + m * (nx[i - 1] + nx[i]),
      v[i * 2 + 1] + m * (ny[i - 1] + ny[i]),
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

/**
 * Cut each corner back along both legs. The setback is measured on the centre
 * line and stepped per lane — from `base - sign·t` — so a bundle turns as one
 * parallel family: the lane inside the turn cuts almost square, the lane outside
 * carries a long face, and the pitch between them holds all the way round.
 *
 * `facets` is how many straight faces the turn is cut into: one gives the single
 * 45° mitre of real board layout, two or three step it round in stages, and a
 * high count reads as a smooth arc. `gap` is the straight remnant every leg must
 * keep between the corners at its two ends.
 */
function facetCorners(
  off: number[],
  turnSigns: number[],
  base: number,
  t: number,
  facets: number,
  gap: number,
): number[] {
  const n = off.length / 2;
  if (n < 3 || base <= 0) return off.slice();
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
    const s = turnSigns[i] ?? 0;
    if (!s || l1 < 1e-6 || l2 < 1e-6) {
      out.push(cx, cy);
      continue;
    }
    const ux = (cx - px) / l1;
    const uy = (cy - py) / l1;
    const vx = (qx - cx) / l2;
    const vy = (qy - cy) / l2;
    // φ is how far the path turns here — the arc's sweep. The tangent points sit
    // r·tan(φ/2) back from the corner, so a 45° leg tucks in tighter than a 90°.
    const phi = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (phi < 1e-3) {
      out.push(cx, cy);
      continue;
    }
    const half = Math.tan(phi / 2);
    let r = Math.max(0, base - s * t);
    let back = r * half;
    // Every leg is shared by the corner at each end, so a corner may claim at
    // most *half* of what that leg can spare. Allowing more lets two mitres meet
    // with no straight between them, and the pair of 45° faces reads as a
    // spearhead instead of a routed corner.
    const cap = (Math.min(l1, l2) - gap) / 2;
    if (back > cap) {
      back = cap;
      r = cap / half;
    }
    if (back < 0.4) {
      out.push(cx, cy);
      continue;
    }
    const t1x = cx - ux * back;
    const t1y = cy - uy * back;
    // Centre sits one radius off the first leg, on the side the path turns to.
    const ox = t1x - s * r * uy;
    const oy = t1y + s * r * ux;
    const a1 = Math.atan2(t1y - oy, t1x - ox);
    // Walk the turn in equal steps around that centre. k=0 and k=facets land
    // exactly on the two tangent points, so `facets: 1` emits the single straight
    // face of a plain 45° mitre and needs no special case; 2 or 3 step the corner
    // round in stages, and a high count reads as a smooth arc.
    const faces = Math.max(1, Math.round(facets));
    for (let k = 0; k <= faces; k++) {
      const a = a1 + (s * phi * k) / faces;
      out.push(ox + Math.cos(a) * r, oy + Math.sin(a) * r);
    }
  }
  out.push(off[(n - 1) * 2], off[(n - 1) * 2 + 1]);
  return out;
}

/**
 * Carry a lane on past its blunt end as a run of dashes that shorten and space
 * out as they go, so the trace dissolves into ticks rather than stopping dead.
 *
 * Only lanes already heading downward trail off — otherwise the effect sprouts
 * sideways all over the board instead of hanging off its underside. A lane that
 * stopped because it ran into other ink gets nothing: `blocked` is still true
 * just past its end, so the train breaks on the first dash.
 */
function trailDashes(
  pts: number[],
  weight: number,
  order: number,
  pitch: number,
  trail: number,
  leftOf: number,
  w: number,
  h: number,
  blocked: (x: number, y: number) => boolean,
): FlowLine[] {
  const n = pts.length;
  if (n < 4) return [];
  let x = pts[n - 2];
  let y = pts[n - 1];
  // Confined to the left, where the board has settled into its descending curtain.
  // The cornered routing on the right is meant to read as continuous cable, and
  // dashes breaking out of those turns just look like damage.
  if (x > leftOf) return [];
  const dx = x - pts[n - 4];
  const dy = y - pts[n - 3];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // The last segment must be running essentially straight down. A lane that stops
  // part-way through a mitre ends on a 45° or 22.5° facet, and following *that*
  // heading sends the dashes off diagonally instead of hanging them vertically.
  if (uy < 0.95 || Math.abs(ux) > 0.15) return [];

  const out: FlowLine[] = [];
  let dash = pitch * 1.3;
  let gap = pitch * 0.9;
  // Scaled straight off the slider with no floor, so a low value really means no
  // trail. A floor here left stray ticks behind at settings meant to switch it off.
  const steps = Math.round(trail * 9);
  for (let i = 0; i < steps; i++) {
    x += ux * gap;
    y += uy * gap;
    const ex = x + ux * dash;
    const ey = y + uy * dash;
    if (ex < 0 || ey < 0 || ex > w || ey > h) break;
    if (blocked(x, y) || blocked(ex, ey)) break;
    out.push({ pts: [x, y, ex, ey], w: weight, order, arrow: false });
    x = ex;
    y = ey;
    dash *= 0.74;
    gap *= 1.18;
    if (dash < pitch * 0.16) break;
  }
  return out;
}

interface Drop {
  from: number; // arc length where the descent starts
  to: number; // and where it ends
  y: number; // how low it gets — the lowest drop wins
}

/**
 * Arc-length spans where the path makes a sustained near-vertical descent.
 * Fringing a lane inside one of these leaves it hanging as a blunt downward stub
 * instead of stopping mid-traverse — how the reference board frays underneath.
 *
 * A span has to hold one direction throughout. A corner arc sweeps through every
 * heading on its way round, so without that test every turn would register as a
 * descent and lanes would end mid-corner rather than mid-drop.
 */
function descendingSpans(pts: number[], minLen: number): Drop[] {
  const spans: Drop[] = [];
  let acc = 0;
  let start = -1;
  let sx = 0;
  let sy = 0;
  const close = (to: number, y: number) => {
    if (start >= 0 && to - start >= minLen) spans.push({ from: start, to, y });
  };
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i];
    const dy = pts[i + 3] - pts[i + 1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const steep = uy > 0.85; // within ~32° of straight down
    if (steep && start >= 0 && ux * sx + uy * sy > 0.995) {
      acc += len; // still the same straight descent — keep extending it
      continue;
    }
    close(acc, pts[i + 1]);
    start = steep ? acc : -1;
    sx = ux;
    sy = uy;
    acc += len;
  }
  close(acc, pts[pts.length - 1]);
  return spans;
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
  // Straight remnant every leg keeps between the mitres at its two ends, so a
  // corner always reads as a cut corner rather than a point.
  const gap = pitch * 2;

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

  // Keep-out down the left edge, so the board has somewhere to breathe and the
  // type has ground to sit on. Seeded into the occupancy grid rather than clipped
  // afterwards: lanes then stop against it the same honest way they stop against
  // other ink — blunt, at staggered x, and trailing off if they were heading down.
  // The band widens toward the bottom, which keeps traces reaching the left edge
  // up high while clearing the lower corner.
  if (p.margin > 0) {
    const bandW = w * 0.42 * p.margin;
    // Random walk down the rows gives a ragged silhouette with no holes for a
    // lane to slip through, which a per-cell probability would leave behind.
    let edge = bandW * 0.5;
    for (let gy = 0; gy < rows; gy++) {
      edge += (rand() - 0.5) * grid * 2.2;
      const taper = 0.16 + 0.84 * (gy / Math.max(1, rows - 1));
      const limit = bandW * taper;
      edge = Math.max(limit * 0.45, Math.min(limit, edge));
      const gxMax = Math.min(cols - 1, Math.floor(edge / grid));
      for (let gx = 0; gx <= gxMax; gx++) occ[gy * cols + gx] = 1;
    }
  }

  const want = Math.max(1, Math.round(p.bundles));
  // Generous, because a bundle is thrown away whole if it lands in the keep-out or
  // if its lanes come out too short to read as conductors. Both rejections are
  // common, so a tight attempt budget quietly halves the density.
  const attempts = Math.min(1600, Math.round(want * (16 + 6 * p.margin)));
  const widest = Math.max(1, Math.round(p.traces));
  // A lane below this reads as a tick rather than a conductor, and a whole bundle
  // of them reads as a ladder of stray marks. Gate on the individual lane *and* on
  // the bundle's average, because a bundle that gets blocked early otherwise lays
  // down one stub per trace and clears a total-length test on sheer count.
  // The ladder artifact is a *cluster* of similar stubs, not any single short lane,
  // so the bundle average does the real work: an outer lane clipped a bit short
  // reads fine next to long neighbours, while a bundle whose lanes are all short
  // is the ladder. Gating hard on the individual lane instead cost half the
  // density for artifacts the average already catches.
  const minLane = pitch * 3;
  const minMean = pitch * 9;
  const minTotal = pitch * 24;
  const lines: FlowLine[] = [];
  let placed = 0;

  // Spines already on the board, each tracking the band of lateral offsets its
  // bundles have used. A nested bundle rides the same spine one clearance
  // outside that band, so it inherits the host's corners exactly — the radius
  // family `base - sign·t` just continues outward.
  interface Routed {
    spine: number[];
    signs: number[];
    base: number;
    lo: number;
    hi: number;
  }
  const routed: Routed[] = [];

  for (let a = 0; a < attempts && placed < want; a++) {
    // Ribbon width: `traces` is the widest bundle, `ribbonVar` how far the rest
    // fall short of it — the mix of fat and thin cable the reference runs.
    const count = Math.max(1, Math.round(widest * (1 - p.ribbonVar * rand())));
    const halfSpan = ((count - 1) / 2) * pitch;
    // Bundle width plus one pitch of clearance — the tightest turn it can make.
    const minSep = halfSpan * 2 + pitch;
    // A leg also has to carry a mitre at each end for the *deepest* lane in the
    // ribbon — `corner + halfSpan` — and still keep a straight between them.
    // Routing short of this is what makes two mitres merge into a spearhead.
    const minRun = Math.max(minSep, 2 * (p.corner + halfSpan) + gap * 2);

    let host: Routed | null = null;
    let lateral = 0;
    if (routed.length && rand() < p.nest) {
      const pick = routed[Math.floor(rand() * routed.length)];
      // A host stops taking neighbours once its stack is a few ribbons deep.
      // Without that cap, a high `nest` funnels every bundle onto one spine and
      // the rest of the board goes bare.
      const cap = (widest * pitch + pitch) * 3;
      if (pick.hi - pick.lo < cap) {
        host = pick;
        lateral =
          rand() < 0.5
            ? host.hi + pitch + halfSpan
            : host.lo - pitch - halfSpan;
      }
    }

    let spine: number[];
    let turnSigns: number[];
    let base: number;
    if (host) {
      // The host spine already cleared self-crossing at its own width. A wider
      // nested bundle can still run its inner lanes out of room, and trimReversed
      // below cuts those — which reads as a terminated trace, so it stays honest.
      spine = host.spine;
      turnSigns = host.signs;
      base = host.base;
    } else {
      spine = trimSelfCrossing(
        buildSpine(w, h, p, rand, minRun),
        minSep,
        Math.max(2, pitch),
      );
      if (spine.length < 6) continue;
      turnSigns = spineTurnSigns(spine);
      base = p.corner;
    }

    const batch: FlowLine[] = [];
    let total = 0;

    for (let k = 0; k < count; k++) {
      const t = lateral + (k - (count - 1) / 2) * pitch;
      const parallel = trimReversed(spine, offsetPath(spine, t));
      if (parallel.length < 4) continue;
      const cornered = facetCorners(parallel, turnSigns, base, t, p.facets, gap);
      const onBoard = clipToBoard(cornered, w, h);
      if (onBoard.length < 4) continue;

      const cutAt = firstBlockedLen(onBoard, step, blocked);
      let kept = Number.isFinite(cutAt) ? truncateAt(onBoard, cutAt) : onBoard;
      // Fringe: a lane that stops short of its neighbours. Drawn per lane so
      // the bundle's ends comb out instead of shearing off flat. `drop` steers
      // the cut into the lane's lowest descending run, so the stub hangs down.
      if (kept.length >= 4 && p.fringe > 0 && rand() < p.fringe) {
        const full = polylineLength(kept);
        // Only descents in the back half of the lane qualify, so a drip hangs
        // off the end of the run instead of lopping the lane down to a nub.
        let drip: Drop | null = null;
        if (p.drop > 0 && rand() < p.drop) {
          for (const s of descendingSpans(kept, pitch * 1.5)) {
            if (s.from < full * 0.4) continue;
            if (!drip || s.y > drip.y) drip = s; // the lowest drop wins
          }
        }
        kept = drip
          ? truncateAt(kept, drip.from + (drip.to - drip.from) * (0.15 + rand() * 0.85))
          : truncateAt(kept, full * (0.25 + rand() * 0.6));
      }
      if (kept.length < 4) continue;
      const len = polylineLength(kept);
      if (len < minLane) continue;

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

    // A ribbon that loses its outer lanes still reads fine — it is just narrower
    // cable — so this only rules out the degenerate case of one or two loose
    // strokes sitting at bundle pitch. Demanding most of the ribbon survive
    // instead starves the board: complete ribbons need long clear corridors, and
    // holding out for them cost well over half the density.
    const need = Math.min(3, count);
    if (
      batch.length < need ||
      total < minTotal ||
      total / batch.length < minMean
    ) {
      continue;
    }
    // Built against the board as it stood *before* this bundle landed, so a lane's
    // own freshly-marked ink does not block its own trail.
    const trails: FlowLine[] = [];
    if (p.trail > 0) {
      for (const line of batch) {
        trails.push(
          ...trailDashes(
            line.pts,
            line.w,
            placed,
            pitch,
            p.trail,
            w * SETTLE_REACH,
            w,
            h,
            blocked,
          ),
        );
      }
    }
    for (const line of batch) markPolyline(line.pts);
    for (const t of trails) markPolyline(t.pts);
    lines.push(...batch, ...trails);
    placed++;
    if (host) {
      // Widen the host's band so the next nest stacks outside this one.
      host.lo = Math.min(host.lo, lateral - halfSpan);
      host.hi = Math.max(host.hi, lateral + halfSpan);
    } else {
      routed.push({ spine, signs: turnSigns, base, lo: -halfSpan, hi: halfSpan });
    }
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
  // Only the params with a slider are randomised. The character params stay put,
  // so a shuffle can never land somewhere the panel gives no way back from.
  return {
    ...prev,
    seed: Math.floor(rand() * 99999) + 1,
    traces: pick(7, 12, 1),
    run: pick(120, 200, 5),
    turns: pick(10, 16, 1),
    corner: pick(4, 14, 1),
    facets: pick(1, 3, 1),
    curl: pick(0.14, 0.46, 0.02),
    fringe: pick(0.25, 0.5, 0.02),
    spacing: pick(9, 13, 1),
  };
}
