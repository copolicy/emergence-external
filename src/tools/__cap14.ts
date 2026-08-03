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
import type { FadeOptions } from "./dissolveFade";

// A much lighter dissolve than the shared default, which was tuned for fields of
// soft vectors running the full height. This board is the opposite: hard-edged
// cable of even weight, whose ends are already deliberate — the fringe and the
// trail ticks do the work of stopping a trace. The default's taper runs over the
// last 28% of each line's depth, which on a cut around 0.9 of the height began
// thinning cable from two thirds of the way up, and carried the ends to nothing so
// the blunt stops it had been at pains to place dissolved into wisps.
//
// So: only the last tenth of the frame may end a line, the taper is an edge
// treatment rather than a wash, and a tip keeps enough weight to still read as a
// cut trace.
const JAGGED_FADE: FadeOptions = {
  start: 0.9,
  floor: 0.99,
  tipFrac: 0.07,
  endWidth: 0.3,
  endAlpha: 0.3,
};

// The trail ticks below a curtain run from about a pitch and a half down to a
// couple of pixels, and `strokeFaded` drops any stroke under ten by default —
// which culled all but the first tick or two of every trail, wherever on the board
// it sat and whether the fade reached it or not. They are deliberate marks, so the
// floor only needs to be low enough to keep them.
const JAGGED_FADE_MIN_LEN = 1.5;

/**
 * Optional post-scale about a focal point. Kept at 1 — magnification pushes ink
 * off-frame and hollows the centre; the reference bleed is handled by routing
 * entries off the edges instead.
 */
const JAGGED_ZOOM = 1;
const JAGGED_FOCAL_X = 0.55;
const JAGGED_FOCAL_Y = 0.45;

// How wide a cable may grow, in trace pitches. The reference runs few cables but
// very wide ones — a dozen or more lanes hugging the same contour — so this is
// what makes the routing read as nested loops rather than scattered ribbons.
const STACK_CAP_PITCHES = 14;

/** Bottom-left corner kept clear for the vertical label stack on the card. */
const TYPE_PAD_X = 0.3;
const TYPE_PAD_Y = 0.2;

function zoomJaggedLines(lines: FlowLine[], w: number, h: number): void {
  const cx = w * JAGGED_FOCAL_X;
  const cy = h * JAGGED_FOCAL_Y;
  for (const line of lines) {
    for (let i = 0; i < line.pts.length; i += 2) {
      line.pts[i] = cx + (line.pts[i] - cx) * JAGGED_ZOOM;
      line.pts[i + 1] = cy + (line.pts[i + 1] - cy) * JAGGED_ZOOM;
    }
  }
}
// Infrastructure — PCB trace routing, under two rules the reference art holds to
// without exception:
//
//   1. Every leg runs on a multiple of 45° — the eight compass headings and
//      nothing else. Turns are rounded, but a fillet is only the transition
//      between two legs; it never leaves the routing on an off-grid heading.
//   2. No line ever crosses another.
//
// Rule 1 is structural. A bundle's centre line is walked on the Manhattan grid,
// then every square corner is cut back into a 45° diagonal *before* the lanes are
// offset off it. That order is the whole trick: the centre line becomes
// octilinear, and the parallel copy of an octilinear path holds full pitch along
// the diagonal just as it does along a straight. Cutting the chamfer into each
// lane afterwards instead spaces the diagonals at `pitch·cos(φ/2)`, so the ribbon
// narrows through every turn. Each 45° turn is then filleted, the radius stepped
// per lane so the bundle stays concentric through it: the lane inside the turn
// rides tighter, the lane outside sweeps wider, and the pitch holds all the way
// round.
//
// Rule 2 is enforced twice over. The occupancy grid keeps every bundle a clearance
// off the ink already on the board, and `firstCrossLen` catches what a grid of
// committed ink cannot see — a lane crossing the rest of its own ribbon, or its
// own earlier course where an offset taken deep inside a spiral closes on itself.
// A lane that meets either simply stops.
//
// Where those stops are allowed to happen is what makes the difference between a
// board that reads as dense routing and one that reads as broken routing. The
// reference is not short of blunt ends — it is short of blunt ends pointing
// *sideways*; nearly all of its interior ends hang downward, where the curtain
// frays. So a lane may stop against ink while heading down, and a bundle holding
// any lane that stops otherwise is abandoned and the attempt spent elsewhere.
//
// That refusal is expensive, and what pays for it is nesting. A ribbon stacked onto
// a spine already routed runs parallel to that cable at one clearance and so
// survives intact, where a ribbon carving a fresh path across a busy board is
// mostly refused — which is why `nest` runs high, why a fresh spine is laid out
// with room for the whole cable it may come to carry rather than for its first
// ribbon, and why the attempt budget is many times the bundle count.
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
  corner: number; // 45° cut taken off each leg at a square corner, px (0 = square)
  knee: number; // fillet radius where a diagonal meets a straight, px (0 = sharp)
  facets: number; // straight faces per fillet — 1 nicks the knee, high counts read as an arc
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
  seed: 23,
  spacing: 8,
  lineWidth: 1.5,
  widthVar: 0,
  // Barely on. The fatten pass spreads each lane toward its neighbours, and there
  // is only about `spacing - lineWidth` of gap to give away before a ribbon closes
  // into a solid band — so this is set just far enough to take the mechanical edge
  // off the ink without the lanes reaching each other.
  stamp: 0.03,
  // A leg carries a chamfer at each end, so the deeper the cut the less a run may
  // vary before the corners start clamping. Keep the variance modest at this depth.
  jitter: 0.35,
  bundles: 120,
  traces: 4,
  ribbonVar: 0.42,
  // Long runs and many corners are what make a cable loop back within the frame
  // instead of crossing it once and leaving — the nested contours the reference has.
  run: 200,
  turns: 18,
  corner: 68,
  // Small against the chamfer, so the diagonal stays straight through its middle
  // and only rounds where it meets the straight. Stepping this per lane runs the
  // family from a tight knee on the inside of the turn to a long sweep on the
  // outside, which is what a concentric bundle does.
  //
  // These three — `corner`, `knee` and `run` — were set together against the
  // reference art, matched on how its ink divides between the straights, the 45°
  // runs and the rounding: about 71% axial, 21% diagonal, 8% fillet. Moving one
  // alone pulls that split off.
  knee: 12,
  // High enough that a fillet reads as a drawn arc rather than a stepped bevel.
  facets: 8,
  // Not on the rail: how tightly the bundles coil is the vertical's look, not
  // something to tune per composition.
  curl: 0.86,
  switchback: 0.6,
  margin: 0.44,
  // High, because stacking ribbons onto a spine already down is how the board
  // reaches its density without lanes running into each other: a ribbon nesting
  // alongside cable runs parallel to it at one clearance, where one carving a
  // fresh path across a busy board mostly gets refused. It is also what builds the
  // reference's thick cables out of narrow ribbons.
  nest: 0.94,
  settle: 0.55,
  fringe: 0.2,
  // A fraction of the ink's own weight, so it stays a nick in the trace at this
  // line width rather than eroding lanes away.
  cutout: 0.74,
  drop: 0.8,
  // Around three dashes past each blunt end, shortening as they go. Only lanes that
  // stopped heading straight down and with clear board below get any, so this reads
  // as the curtain dissolving into ticks rather than stippling the whole field.
  trail: 0.38,
};

export const JAGGED_RANGES: Record<
  keyof JaggedParams,
  [number, number, number]
> = {
  ...FLOW_RANGES,
  // A short walk rather than the field tools' five-digit range. Every seed here
  // gives a fully routed board, so the slider is for picking between compositions
  // by eye — a range you can scrub end to end beats one you sample at random.
  seed: [1, 60, 1],
  bundles: [2, 200, 1],
  traces: [1, 16, 1],
  ribbonVar: [0, 1, 0.02],
  run: [20, 340, 5],
  turns: [1, 16, 1],
  corner: [0, 120, 1],
  knee: [0, 60, 1],
  facets: [1, 16, 1],
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
  corner: "Corner Cut",
  knee: "Knee Radius",
  facets: "Knee Steps",
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
  corner: "How far back a square corner is cut into a 45° diagonal, measured along each leg on the bundle's centre line. The cut is made before the lanes are offset, so the diagonal is a leg the whole bundle travels along at full pitch. High values turn the routing into long diagonals; zero gives square corners.",
  knee: "Radius of the arc where a diagonal meets a straight. Stepped per lane — lanes inside the turn ride tighter, lanes outside sweep wider — so the bundle stays concentric through the turn. Zero leaves the knee sharp; large values eat the diagonal until the corner reads as one continuous curve.",
  facets: "How finely each knee arc is stepped. Counted per knee-radius of arc rather than per fillet, so a wide outer sweep is stepped as smoothly as a tight inner knee instead of flattening into a polygon. One gives a single bevel across a tight knee; high counts read as a smoothly drawn arc.",
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
// board's character rather than tune a composition, and so do the routing
// dimensions `margin`, `spacing`, `run`, `turns`, `corner`, `knee`, `facets`,
// `fringe` and `trail`, and now the ink treatment `stamp` and `cutout` too: the
// board is settled, and what is left on the rail is which one you get and how
// heavily it is drawn. They are dialled in above and left alone. Move one back
// into this list if it turns out to need reaching for.
export const SLIDER_KEYS_SIMPLE_JAGGED: (keyof JaggedParams)[] = [
  "seed",
  "lineWidth",
];

// ---- geometry helpers ------------------------------------------------------

// How far down the board counts as settled: where bundles give up cornering, and
// where trailing-off is allowed. Shared so the two agree on the boundary — the
// curtain and the dashes should start in the same place.
const SETTLE_REACH = 0.72;

// The four Manhattan directions, `d` counting clockwise from +x with y pointing
// down, so a 90° turn is ±1 step and a reversal ±2. The walk itself is
// axis-aligned; the diagonals come from `chamferSpine`, which cuts each of these
// square corners into a 45° leg afterwards.
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

  // Every cable arrives off the right edge, heading in. Nothing enters from any
  // other side and nothing starts in open board: the composition is meant to read
  // as one bank of routing fed from the right, thinning out to the left into the
  // curtain and the type. Interior starts and other edges each left blunt ends
  // pointing the wrong way, which reads as a second, unrelated source of cable.
  let d = 2; // left→+x, top→+y, right→−x, bottom→−y
  let x = w + pad;
  // Spread over most of the height, biased high — the reference is densest in the
  // top-right and thins as the routing works down and left.
  let y = quant(rand() ** 1.3 * h * 0.94);

  const v = [x, y];
  // Which way the coil winds. Biased so the first corner carries the bundle down,
  // away from the edge it arrived on — with `curl` high the rest of the turns
  // follow, and the cable nests into C-shapes that stack back toward the right
  // instead of running straight off the far side.
  const turn = rand() < 0.8 ? -1 : 1;
  const corners = Math.max(1, Math.round(p.turns));
  const off = (px: number, py: number) =>
    px < -pad || py < -pad || px > w + pad || py > h + pad;

  // A switchback is two same-signed 90° turns with only a short leg between
  // them — the U that gives the reference its nested hooks. `pairLeft` counts
  // the turns still owed to one, and forces the leg between them short and
  // orthogonal so the U actually closes.
  let pairLeft = 0;
  const cross = minRun + pitch * 2;
  // The leg a bundle comes in on carries a chamfer at its far end only, so it
  // needs none of the clearance an interior leg does — that allowance is there so
  // a cable can turn back without meeting itself, and there is nothing behind the
  // entry to meet. Held to the full `minRun` it ringed the board with straight
  // runs, every cable travelling a good way in before it turned anything; the
  // reference starts turning close to the edge it came in on.
  const entryFloor = quantRun(p.corner + pitch * 2);

  for (let i = 0; i < corners; i++) {
    const vary = 1 + (rand() - 0.5) * 2 * Math.min(1, p.jitter);
    // A bundle cannot turn back inside its own width, so no interior run is
    // shorter than the cable is wide — the same constraint a real board has.
    const len =
      pairLeft > 0
        ? quantRun(cross)
        : i === 0
          ? Math.max(entryFloor, quantRun(p.run * vary * 0.45))
          : Math.max(minRun, quantRun(p.run * vary));
    x += DX[d] * len;
    y += DY[d] * len;
    v.push(x, y);
    if (i >= 1 && off(x, y)) break;
    // Composition bias. The board resolves from dense cornered routing up on the
    // right into descending lanes that trail off along the bottom, so a bundle
    // stops cornering and runs straight down once it has worked its way low —
    // the tail of the run rather than more routing.
    //
    // Keyed mostly on depth, with a mild leftward lean. On x alone the curtain
    // hung as a wall down one side wherever a bundle happened to be; on depth it
    // gathers along the underside of the board, which is where the reference's
    // ends and ticks are.
    const depth = Math.min(1, (y / h) / SETTLE_REACH);
    const settled = depth * (0.55 + 0.45 * Math.max(0, 1 - x / w));
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

/**
 * Cut each square corner of the centre line back into a 45° diagonal, replacing
 * the corner vertex with the two ends of the cut. The spine comes out octilinear —
 * only the eight compass headings, and every turn 45°.
 *
 * This runs *before* `offsetPath`, and that is the point. A parallel copy of an
 * octilinear path sits at full pitch along the diagonal exactly as it does along a
 * straight, so the ribbon keeps its width through the turn. Cutting the same
 * chamfer into each lane after offsetting instead spaces the diagonals at
 * `pitch·cos(φ/2)` and the bundle visibly narrows across every corner.
 *
 * `depth` is measured along each leg. A leg is shared by the corners at both its
 * ends, so neither may claim more than half of it, less the straight remnant
 * `gap` they have to leave between them.
 */
function chamferSpine(v: number[], depth: number, gap: number): number[] {
  const n = v.length / 2;
  if (n < 3 || depth <= 0) return v.slice();
  const out: number[] = [v[0], v[1]];
  for (let i = 1; i < n - 1; i++) {
    const px = v[(i - 1) * 2];
    const py = v[(i - 1) * 2 + 1];
    const cx = v[i * 2];
    const cy = v[i * 2 + 1];
    const qx = v[(i + 1) * 2];
    const qy = v[(i + 1) * 2 + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(qx - cx, qy - cy);
    if (l1 < 1e-6 || l2 < 1e-6) {
      out.push(cx, cy);
      continue;
    }
    const ux = (cx - px) / l1;
    const uy = (cy - py) / l1;
    const vx = (qx - cx) / l2;
    const vy = (qy - cy) / l2;
    // Nothing to cut where the path runs straight through.
    if (ux * vx + uy * vy > 1 - 1e-9) {
      out.push(cx, cy);
      continue;
    }
    const d = Math.min(depth, (l1 - gap) / 2, (l2 - gap) / 2);
    if (d < 0.5) {
      out.push(cx, cy);
      continue;
    }
    out.push(cx - ux * d, cy - uy * d, cx + vx * d, cy + vy * d);
  }
  out.push(v[(n - 1) * 2], v[(n - 1) * 2 + 1]);
  return out;
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
 * which at right angles reduces to `t·(n₁+n₂)` and stays exact for the 45° legs
 * the chamfer leaves behind. Every segment keeps its heading, so a copy of an
 * octilinear spine is octilinear too — this is what holds rule 1.
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
 * Round every turn of a lane. The spine reaching here has already been chamfered,
 * so each turn is 45° and the fillet is the knee where a diagonal meets a
 * straight. This is the rounding the reference art draws its turns with; the legs
 * either side of it keep their octilinear headings, so rule 1 still holds of the
 * routing itself.
 *
 * The radius is measured on the centre line and stepped per lane — `base - sign·t`
 * — which makes the lanes concentric through the turn: the lane inside rides
 * tighter, the lane outside sweeps wider, and the pitch between them holds all the
 * way round. `minR` floors it, for the innermost lanes of a nested stack that the
 * family would otherwise send negative.
 *
 * `facets` is how finely the arc is stepped — one face per knee-radius of arc at
 * `facets: 1`, so a single bevel across a tight knee, and high counts a drawn arc.
 * `gap` is the straight remnant every leg must keep between the fillets at its two
 * ends.
 */
function facetCorners(
  off: number[],
  turnSigns: number[],
  base: number,
  t: number,
  facets: number,
  gap: number,
  minR: number,
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
    // A lane riding nearer the turn centre than the centre line's own radius
    // cannot stay concentric with the rest of the stack — that wants a negative
    // radius — and it is the innermost lanes of a deeply nested bundle that get
    // there. Left unfloored they came out as bare mitres, on exactly the corners
    // that sit tightest in the turn and most need the rounding.
    let r = Math.max(minR, base - s * t);
    let back = r * half;
    // Every leg is shared by the fillet at each end, so a fillet may claim at
    // most *half* of what that leg can spare. Allowing more lets two arcs meet
    // with no straight between them, and the diagonal disappears into a single
    // continuous curve instead of reading as a leg of its own.
    //
    // The `gap` remnant is what protects that, but on a leg shorter than about
    // twice the gap it leaves nothing at all and the corner came out as a bare
    // mitre among rounded ones. Below that length there is no straight worth
    // protecting anyway, so such a leg gives a quarter of itself to each fillet.
    const shortest = Math.min(l1, l2);
    const cap = Math.max((shortest - gap) / 2, shortest * 0.25);
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
    // `facets` fixes how finely the arc is stepped rather than how many faces it
    // gets. A bundle nested well off its host spine turns on a radius many times
    // the knee's own, and holding the count fixed stepped those sweeps in chords
    // long enough to read as a polygon. Scaling with the radius steps every fillet
    // on the board at the same chord — one face per knee-radius of arc, at
    // `facets: 1` — and the cap bounds the point count on the widest sweeps.
    const faces = Math.max(
      1,
      Math.min(64, Math.round(facets * Math.max(1, r / base))),
    );
    for (let k = 0; k <= faces; k++) {
      const a = a1 + (s * phi * k) / faces;
      out.push(ox + Math.cos(a) * r, oy + Math.sin(a) * r);
    }
  }
  out.push(off[(n - 1) * 2], off[(n - 1) * 2 + 1]);
  return out;
}

/**
 * Where along `pts` it first crosses one of `others` or its own earlier course,
 * as an arc length, or Infinity if it stays clear.
 *
 * This is rule 2 enforced on the geometry itself. The occupancy grid covers the
 * bundles already on the board but cannot see the one being built, and within a
 * bundle the usual guards are not enough: `trimReversed` only catches an offset
 * segment doubling back on its spine, while an offset taken deep inside a spiral
 * closes the gap between two arms until they meet with every segment still
 * holding its heading, so nothing reverses.
 */
function firstCrossLen(pts: number[], others: number[][]): number {
  const segs = pts.length / 2 - 1;
  let acc = 0;
  // Parameter along AB where it properly crosses CD, or -1.
  const hit = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
  ) => {
    const rx = bx - ax;
    const ry = by - ay;
    const sx = dx - cx;
    const sy = dy - cy;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return -1; // parallel — a lane never overlaps one
    const u = ((cx - ax) * sy - (cy - ay) * sx) / den;
    const v = ((cx - ax) * ry - (cy - ay) * rx) / den;
    return u > 1e-9 && u < 1 - 1e-9 && v > 1e-9 && v < 1 - 1e-9 ? u : -1;
  };

  for (let i = 0; i < segs; i++) {
    const ax = pts[i * 2];
    const ay = pts[i * 2 + 1];
    const bx = pts[i * 2 + 2];
    const by = pts[i * 2 + 3];
    const len = Math.hypot(bx - ax, by - ay);
    let best = -1;
    // Its own earlier course. `j + 1 < i` skips the neighbour, which shares a
    // vertex by construction.
    for (let j = 0; j + 1 < i; j++) {
      const u = hit(ax, ay, bx, by, pts[j * 2], pts[j * 2 + 1], pts[j * 2 + 2], pts[j * 2 + 3]);
      if (u >= 0 && (best < 0 || u < best)) best = u;
    }
    for (const o of others) {
      for (let j = 0; j + 3 < o.length; j += 2) {
        const u = hit(ax, ay, bx, by, o[j], o[j + 1], o[j + 2], o[j + 3]);
        if (u >= 0 && (best < 0 || u < best)) best = u;
      }
    }
    if (best >= 0) return acc + best * len;
    acc += len;
  }
  return Infinity;
}

/** Whether (x, y) lies within `r` of any segment of a polyline. */
function nearPolyline(pts: number[], x: number, y: number, r: number): boolean {
  const r2 = r * r;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const dx = pts[i + 2] - ax;
    const dy = pts[i + 3] - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (ax + dx * t);
    const ey = y - (ay + dy * t);
    if (ex * ex + ey * ey <= r2) return true;
  }
  return false;
}

/**
 * Carry a lane on past its blunt end as a run of dashes that shorten and space
 * out as they go, so the trace dissolves into ticks rather than stopping dead.
 *
 * Only lanes already heading downward trail off — otherwise the effect sprouts
 * sideways all over the board instead of hanging off its underside. A lane that
 * stopped because it ran into other ink gets nothing: `blocked` is still true
 * just past its end, so the train breaks on the first dash.
 *
 * `hitsSibling` covers what `blocked` cannot. The grid handed in here still shows
 * the board as it stood *before* this bundle landed — deliberately, so a lane's
 * own fresh ink does not block its own trail — which leaves the rest of the
 * ribbon invisible to it. A lane fringed short mid-ribbon would then trail
 * straight across the neighbour that carried on, and that is a crossing.
 */
function trailDashes(
  pts: number[],
  weight: number,
  order: number,
  pitch: number,
  trail: number,
  below: number,
  w: number,
  h: number,
  blocked: (x: number, y: number) => boolean,
  hitsSibling: (x: number, y: number) => boolean,
): FlowLine[] {
  const n = pts.length;
  if (n < 4) return [];
  let x = pts[n - 2];
  let y = pts[n - 1];
  // Confined to the lower board, where the routing has settled into its descending
  // curtain. The cornered cable higher up is meant to read as continuous, and
  // dashes breaking out of those turns just look like damage.
  if (y < below) return [];
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
    // Midpoint too: a dash is short against the clearance, so testing both ends
    // and the middle cannot step over a lane lying across it.
    const mx = (x + ex) / 2;
    const my = (y + ey) / 2;
    if (hitsSibling(x, y) || hitsSibling(mx, my) || hitsSibling(ex, ey)) break;
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
  const clear = pitch * 0.72;
  const step = Math.max(1.5, pitch * 0.4);
  // Straight remnant every leg keeps between the chamfers at its two ends, so a
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
    const bandW = w * 0.34 * p.margin;
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

  // Bottom-left kept open for the card's type stack — the reference never routes
  // through the corner where "VERTICAL 02" and the vertical name sit.
  {
    const padX = w * TYPE_PAD_X;
    const padY = h * TYPE_PAD_Y;
    const gxMax = Math.min(cols - 1, Math.ceil(padX / grid));
    const gyMin = Math.max(0, Math.floor((h - padY) / grid));
    for (let gy = gyMin; gy < rows; gy++) {
      for (let gx = 0; gx <= gxMax; gx++) occ[gy * cols + gx] = 1;
    }
  }

  const want = Math.max(1, Math.round(p.bundles));
  // Very generous, because a bundle is thrown away whole if it lands in the
  // keep-out, if its lanes come out too short to read as conductors, or if it
  // could not be laid down substantially intact. That last one rejects most of
  // what it sees on a board this dense — holding out for cable that fits is
  // precisely the point — so the budget has to cover the retries or the board
  // comes out half empty.
  const attempts = Math.min(16000, Math.round(want * (80 + 24 * p.margin)));
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
  const minLane = pitch * 2.5;
  const minMean = pitch * 7;
  const minTotal = pitch * 18;
  // How wide a cable may grow. A host spine stops taking further ribbons once its
  // stack reaches this, so a high `nest` cannot funnel the whole board onto one
  // spine and leave the rest bare. Set in absolute terms rather than off `traces`,
  // because it is the width of the finished cable that matters, and the reference
  // runs cables of about this band whether they are built of narrow ribbons or
  // wide ones.
  const stackCap = pitch * STACK_CAP_PITCHES;
  const lines: FlowLine[] = [];
  let placed = 0;

  // Spines already on the board, each tracking the band of lateral offsets its
  // bundles have used. A nested bundle rides the same spine one clearance outside
  // that band, so it inherits the host's corners exactly — the radius family
  // `base - sign·t` just continues outward.
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
    // Clearance a fresh spine is laid out for: not this ribbon's width but the
    // width of the cable the spine may end up carrying, since nesting stacks
    // further ribbons onto it up to `stackCap`.
    //
    // Sized for the one ribbon, every spine coiled tighter than its finished cable
    // would be, and the ribbons later stacked around the outside of those coils ran
    // into each other in the turns. The survival gate then refused them, so cables
    // never grew thick and the board could not reach the density the reference has.
    // Laying the spine out for the cable up front is what lets a stack nest all the
    // way out and stay intact.
    const minSep = Math.max(halfSpan * 2, stackCap) + pitch;
    // A leg is shared by the chamfers at both its ends and still has to keep a
    // straight remnant between them. The fillets need no allowance here: a lane
    // whose radius will not fit the face it lands on is clamped to fit by
    // `facetCorners`, which is what keeps the diagonal straight through its middle
    // however wide the ribbon gets.
    const minRun = Math.max(minSep, 2 * p.corner + gap * 2);

    let host: Routed | null = null;
    let lateral = 0;
    if (routed.length && rand() < p.nest) {
      // Stacking is how the board reaches its density: a ribbon nesting alongside
      // cable already down runs parallel to it at one clearance and so survives
      // intact, where one carving its own path across a full board is usually
      // refused. So the pick is made among the spines that still have room —
      // choosing blind and giving up when the pick turned out to be full spent
      // most of the budget on fresh spines the board then refused, and cables
      // never grew to their full width.
      const open = routed.filter((r) => r.hi - r.lo < stackCap);
      if (open.length) {
        host = open[Math.floor(rand() * open.length)];
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
      // The host spine cleared self-crossing at its own width, and a bundle
      // nesting outside it rides further from that centre line than the clearance
      // was ever checked for. Its inner lanes can therefore run out of room; the
      // rule 2 cut below terminates them, which reads as a trace that gave up.
      spine = host.spine;
      turnSigns = host.signs;
      base = host.base;
    } else {
      const walk = trimSelfCrossing(
        buildSpine(w, h, p, rand, minRun),
        minSep,
        Math.max(2, pitch),
      );
      if (walk.length < 6) continue;
      // Chamfer before offsetting: the lanes are then parallel copies of an
      // octilinear centre line and hold full pitch along the diagonals.
      spine = chamferSpine(walk, p.corner, gap);
      if (spine.length < 6) continue;
      turnSigns = spineTurnSigns(spine);
      base = p.knee;
    }

    const batch: FlowLine[] = [];
    let total = 0;
    // Lanes that ran into ink while travelling along or across the board rather
    // than down. Counted before the fringe, which is a deliberate cut rather than
    // a bundle failing to fit.
    let sidewaysStops = 0;

    for (let k = 0; k < count; k++) {
      const t = lateral + (k - (count - 1) / 2) * pitch;
      const parallel = trimReversed(spine, offsetPath(spine, t));
      if (parallel.length < 4) continue;
      const cornered = facetCorners(
        parallel,
        turnSigns,
        base,
        t,
        p.facets,
        gap,
        pitch * 0.4,
      );
      const onBoard = clipToBoard(cornered, w, h);
      if (onBoard.length < 4) continue;

      const cutAt = firstBlockedLen(onBoard, step, blocked);
      let kept = Number.isFinite(cutAt) ? truncateAt(onBoard, cutAt) : onBoard;
      if (Number.isFinite(cutAt) && kept.length >= 4) {
        // Which way the lane was travelling where it stopped. Heading down it
        // reads as the curtain fraying; any other heading leaves a blunt end
        // pointing into open board, and the bundle is refused below.
        const n = kept.length;
        const dx = kept[n - 2] - kept[n - 4];
        const dy = kept[n - 1] - kept[n - 3];
        if (dy / (Math.hypot(dx, dy) || 1) < 0.85) sidewaysStops++;
      }
      // Fringe: a lane that stops short of its neighbours. Drawn per lane so
      // the bundle's ends comb out instead of shearing off flat. `drop` steers
      // the cut into the lane's lowest descending run, so the stub hangs down.
      if (kept.length >= 4 && p.fringe > 0 && rand() < p.fringe) {
        const full = polylineLength(kept);
        // A lane may only fray where it is already heading down, and only in the
        // back half of its run so the drip hangs off the end rather than lopping
        // the lane to a nub. A lane with nowhere to fray keeps its full length:
        // cutting one mid-way along a horizontal or a diagonal leaves an end
        // pointing sideways into open board, which reads as a broken trace rather
        // than as cable that ran out — the reference frays only where its curtain
        // hangs, and every interior end on it points down.
        const spans = descendingSpans(kept, pitch * 1.5).filter(
          (s) => s.from >= full * 0.4,
        );
        if (spans.length) {
          // `drop` steers the fray to the lowest of them. Without it any
          // qualifying descent will do, and the fraying scatters up the board
          // instead of hanging off its underside.
          let drip: Drop = spans[Math.floor(rand() * spans.length)];
          if (p.drop > 0 && rand() < p.drop) {
            for (const s of spans) if (s.y > drip.y) drip = s;
          }
          kept = truncateAt(
            kept,
            drip.from + (drip.to - drip.from) * (0.15 + rand() * 0.85),
          );
        }
      }
      if (kept.length < 4) continue;
      // Rule 2, applied to the geometry that will actually be inked and to the
      // one thing the occupancy grid cannot cover — the rest of this bundle. The
      // lane stops a clearance short of the crossing, so it reads as a terminated
      // trace like any other lane that ran out of room.
      const meets = firstCrossLen(
        kept,
        batch.map((l) => l.pts),
      );
      if (Number.isFinite(meets)) {
        kept = truncateAt(kept, Math.max(0, meets - clear));
        if (kept.length < 4) continue;
      }
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
    // cable — so the count test only rules out the degenerate case of one or two
    // loose strokes sitting at bundle pitch.
    //
    // The last test is what keeps the board from looking broken, and it is worth
    // the attempts it costs. The reference is not short of blunt ends; it is short
    // of blunt ends pointing *sideways*. Nearly all of its interior ends hang
    // downward, because that is the curtain fraying, and a lane that stops while
    // heading down reads as cable that ran out. One cut mid-traverse instead leaves
    // an end pointing into open board with nothing to explain it, and a field of
    // those is what makes routing look damaged rather than dense.
    //
    // Gating instead on how much of a ribbon survived was the wrong test: a long
    // cable is likely to meet something *somewhere*, so it refused the longest
    // bundles first and the board could not fill. This refuses the ones that stop
    // badly, whatever their length. Tolerating even a third of a ribbon stopping
    // sideways scattered a quarter more such ends over the board for no density.
    // Refuse only when a majority of lanes stop sideways — a single clipped outer
    // lane on an otherwise intact cable reads fine and rejecting the whole bundle
    // was leaving most of the board empty.
    const need = Math.min(3, count);
    if (
      batch.length < need ||
      total < minTotal ||
      total / batch.length < minMean ||
      sidewaysStops > Math.max(1, Math.floor(batch.length * 0.4))
    ) {
      continue;
    }
    // Built against the board as it stood *before* this bundle landed, so a lane's
    // own freshly-marked ink does not block its own trail. The rest of the ribbon,
    // and the dashes already hung off it, are handed over separately so a trail
    // cannot cut across them.
    const trails: FlowLine[] = [];
    if (p.trail > 0) {
      for (let bi = 0; bi < batch.length; bi++) {
        const siblings = batch
          .filter((_, i) => i !== bi)
          .map((l) => l.pts)
          .concat(trails.map((t) => t.pts));
        trails.push(
          ...trailDashes(
            batch[bi].pts,
            batch[bi].w,
            placed,
            pitch,
            p.trail,
            h * SETTLE_REACH * 0.6,
            w,
            h,
            blocked,
            (x, y) => siblings.some((o) => nearPolyline(o, x, y, clear)),
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
  zoomJaggedLines(lines, w, h);
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
  // Round caps match the reference card — blunt ends read as drawn traces, not
  // cut vectors, even with Fade off.
  ctx.lineCap = "round";
  ctx.lineJoin = fade ? "round" : "miter";

  const fieldFade = fade
    ? makeFade(w, h, { ...JAGGED_FADE, seed: fadeSeed })
    : null;

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
          minLength: JAGGED_FADE_MIN_LEN,
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
  // Canvas and SVG must share these or the export diverges from the preview.
  const fieldFade = fade
    ? makeFade(w, h, { ...JAGGED_FADE, seed: fadeSeed })
    : null;
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
    `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="${fade ? "round" : "miter"}" stroke-miterlimit="6">`,
  );
  let lineId = 0;
  for (const line of lines) {
    const id = lineId++;
    const fadeOpts = fieldFade
      ? {
          keep: (x: number, y: number) => fieldFade.keep(id, x, y),
          alpha: (x: number, y: number) => fieldFade.alpha(id, x, y),
          width: (x: number, y: number) => fieldFade.width(id, x, y),
          minLength: JAGGED_FADE_MIN_LEN,
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
    seed: Math.floor(rand() * 60) + 1,
    run: pick(200, 280, 10),
    turns: pick(10, 16, 1),
    // Kept around the dialled-in split of straights, diagonals and rounding, so a
    // shuffle moves the composition without changing how the routing turns.
    corner: pick(52, 72, 2),
    knee: pick(8, 18, 2),
    facets: pick(6, 10, 1),
    curl: pick(0.14, 0.46, 0.02),
    fringe: pick(0.25, 0.5, 0.02),
    spacing: pick(9, 13, 1),
  };
}
