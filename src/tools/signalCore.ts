import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";
import {
  drawStamped,
  stampActive,
  traceStampPathD,
  type StampOpts,
} from "./stampTreatment";

// Telecom — overlapping concentric signal rings. Broken arcs radiate from a
// handful of transmitters, like radio waves or ripples colliding on water.
export const SW = 680;
export const SH = 580;
export const INK = "#195519"; // Mid green
export const BG = "#F5F5F2"; // Cream

export interface SignalParams {
  seed: number;
  centers: number; // number of transmitters
  rings: number; // rings per center
  spacing: number; // radial gap between rings (px)
  lineWidth: number;
  breakiness: number; // 0..1 how much of each ring is missing
  jitter: number; // 0..1 radial noise on ring radius
  // ink treatment — the same stamp/cutout render pass the Root Brush runs
  stamp: number; // 0..1 ink-stamp fatten/smooth pass (0 = off)
  cutout: number; // 0..1 cutout break/simplify pass (0 = off)
}

export const DEFAULT_SIGNAL: SignalParams = {
  // Mid-range on purpose, so the slider scrubs both ways off the default.
  seed: 15,
  // Fixed at the card's composition — the hero with its nest of small circles,
  // and two larger companions parked on the right edge. Not on the rail: the
  // count is part of the vertical's look, not a knob.
  centers: 4,
  rings: 9,
  // Not on the rail: the ring scale sets the vertical's whole composition —
  // how much of the frame the hero fills and how the cluster nests inside it —
  // so it's fixed rather than left as a knob.
  spacing: 43,
  lineWidth: 0.5,
  // Off. The rings draw as whole circles and ALL the breaking comes from the
  // Line Breaks slider (the cutout pass) — cutting quiet sectors here as well
  // meant the arcs arrived pre-broken and the slider was breaking what was
  // already in pieces.
  breakiness: 0,
  // Barely out of round. The rings must read as drawn with a compass; anything
  // above ~0.12 tips them into ripples and loses the telecom feel.
  jitter: 0.06,
  stamp: 0.34,
  cutout: 0.7,
};

export const SIGNAL_RANGES: Record<
  keyof SignalParams,
  [number, number, number]
> = {
  // A short walk rather than the field tools' five-digit range. The composition
  // is fixed — hero, nest and sweeps land the same way on every seed — so the
  // slider is for picking between variations by eye, and a range you can scrub
  // end to end beats one you sample at random.
  seed: [1, 60, 1],
  centers: [1, 12, 1],
  rings: [1, 24, 1],
  spacing: [8, 80, 1],
  lineWidth: [0.3, 2.5, 0.01],
  breakiness: [0, 0.7, 0.02],
  jitter: [0, 0.25, 0.01],
  stamp: [0, 0.45, 0.01],
  cutout: [0, 1, 0.01],
};

export const SIGNAL_LABELS: Record<keyof SignalParams, string> = {
  seed: "Seed",
  centers: "Circles",
  rings: "Rings",
  spacing: "Scale",
  lineWidth: "Line Weight",
  breakiness: "Breaks",
  jitter: "Out of Round",
  stamp: "Stamp",
  cutout: "Line Breaks",
};

export const SIGNAL_HINTS: Record<keyof SignalParams, string> = {
  seed: "Which nest of smaller circles to draw inside the hero. The big circle stays put; scrub the slider to rearrange the ones inside it.",
  centers:
    "How many circle families are on the canvas. The nest of small circles and the hero always draw; anything past that parks larger companions on the right edge of the frame.",
  rings: "How many concentric rings each circle family draws.",
  spacing:
    "Size of the ring pattern — the gap between successive circles, so the whole family scales with it. Lower packs a small tight ripple; higher blows the circles up into wide sweeps.",
  lineWidth: "Thickness of the signal strokes.",
  breakiness:
    "How wide each family's quiet sectors open. The gaps drift slowly outward ring to ring, so the arcs sweep as a family instead of dashing at random.",
  jitter:
    "How far the rings drift out of round. Small values keep them compass-true; large values tip them into ripples.",
  stamp:
    "Ink-stamp fatten pass (à la Photoshop's Stamp filter). Spreads and smooths the linework into solid calligraphic ink, fusing fine clusters. Zero switches it off.",
  cutout:
    "Cutout pass (à la Photoshop's Cutout filter). Simplifies the stroke contours and pinches thin spots into organic breaks and dashes — never thickens the line. Zero switches it off.",
};

// Stamp and Line Breaks are locked at their tuned defaults — the vertical's ink
// character stays fixed rather than opened up on the rail.
export const SLIDER_KEYS_SIMPLE_SIGNAL: (keyof SignalParams)[] = [
  "seed",
  "lineWidth",
];

export interface SignalLine {
  pts: number[];
  w: number;
  order: number;
  family: number; // index of the family that drew it — sets the stacking order
}

const TAU = Math.PI * 2;

/**
 * Outermost ring radius for a family at the given ring spacing, with room for
 * the out-of-round wobble. Measures the ring the family WANTS to draw, whether
 * or not the frame cuts it: the callers are sizing and nesting against the
 * pattern itself, and clipping it first would scale the survivors up to
 * compensate. Only in-frame families are ever passed in.
 */
function familyOuter(
  c: Center,
  step: number,
  ringCount: number,
  jitter: number,
): number {
  const famRings = Math.max(1, Math.round(ringCount * c.rings));
  const base = c.reach + c.inset * step;
  const outer = base + c.step * step * famRings * (1 + c.grow);
  return outer * (1 + jitter * 0.5);
}

/** The hero family — the one big circle the composition is built around. */
function findHero(centers: Center[]): Center | undefined {
  return centers.find((c) => c.rings === 1 && c.inset >= 0.85);
}

/**
 * Radius the hero draws at, as a fraction of the frame's short side. FIXED, not
 * dealt: the hero is the composition, so it must land at the same size whatever
 * the seed — scrubbing the slider should rearrange the nest inside it, not
 * breathe the whole card in and out.
 */
const HERO_RADIUS_FRAC = 0.42;

/** Radius, in px, the hero draws at on this canvas. */
function heroTargetRadius(w: number, h: number): number {
  return Math.min(w, h) * HERO_RADIUS_FRAC;
}

/**
 * The hero's innermost ring and how much its gap widens outward — midpoints of
 * the ranges these used to be dealt from. Fixed for the same reason the radius
 * is: they set how the ring pattern divides the circle, which is the part of
 * the composition that should hold still while the seed works on the nest.
 */
const HERO_INSET = 1.15;
const HERO_GROW = 0.4;
/** Hero centre — dead center of the frame; seed only rearranges the nest inside. */
const HERO_ANCHOR_X = 0.5;
const HERO_ANCHOR_Y = 0.5;
/**
 * Quiet sectors on the hero. Fixed: a dealt break pattern would rotate the
 * gaps seed to seed and make the same-size circle read as breathing.
 */
const HERO_SECTORS: Sector[] = [
  { base: 0.55, span: 0.7, drift: 0.08 },
  { base: 3.4, span: 0.55, drift: -0.06 },
];

/**
 * Uniform scale for the in-frame families. With a hero on the canvas this is
 * whatever makes it draw at exactly `heroTargetRadius`; the nest rides the same
 * scale and is re-tucked inside the hero afterwards, so it cannot clip.
 *
 * Off-frame transmitters (reach > 0) are excluded — their centers sit outside
 * the frame on purpose and would drive the scale to nothing. Sweeps from those
 * families are capped separately via `farthest`.
 */
function patternFitScale(
  centers: Center[],
  w: number,
  h: number,
  step: number,
  ringCount: number,
  jitter: number,
  pad: number,
): number {
  const inFrame = centers.filter((c) => c.reach === 0);
  if (!inFrame.length) return 1;

  const hero = findHero(inFrame);
  if (hero) {
    const outer = familyOuter(hero, step, ringCount, jitter);
    // Measured on the wider of the two axes, so the hand tremor in sx/sy tips
    // the hero a touch out of round without changing how big it reads.
    const widest = outer * Math.max(hero.sx, hero.sy);
    if (widest > 0) {
      return Math.max(0.15, heroTargetRadius(w, h) / widest);
    }
  }

  // No hero (a one- or two-circle field): fall back to the largest scale that
  // keeps every in-frame family off the edges.
  const fits = (fit: number) => {
    for (const c of inFrame) {
      const outer = familyOuter(c, step, ringCount, jitter) * fit;
      if (c.x - outer * c.sx < pad) return false;
      if (c.x + outer * c.sx > w - pad) return false;
      if (c.y - outer * c.sy < pad) return false;
      if (c.y + outer * c.sy > h - pad) return false;
    }
    return true;
  };

  // Binary search — fit may be > 1 when the tuned pattern is smaller than the frame.
  let lo = 0.1;
  let hi = 4;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.max(0.15, lo * 0.98);
}

/** A quiet sector: an arc the family leaves open, drifting ring to ring. */
interface Sector {
  base: number; // opening angle at ring 0
  span: number; // angular width, before the Breaks scale
  drift: number; // radians the opening rotates per ring
}

interface Center {
  x: number;
  y: number;
  sx: number;
  sy: number;
  rot: number;
  step: number; // this family's own ring gap, as a multiple of Density
  inset: number; // innermost ring, as a multiple of Density
  reach: number; // px added before the first ring — off-frame families only
  grow: number; // 0..1 how much the gap widens outward
  rings: number; // 0..1 share of the Rings count this family draws
  span: number; // how far past `reach` the family keeps drawing, in px
  sectors: Sector[];
  phaseA: number;
  phaseB: number;
}

/** Ring gap of the smallest and largest family, as a multiple of Scale. */
const SIZE_MIN = 0.45;
const SIZE_MAX = 1.4;

/**
 * Right-edge companions — how far past the right edge their centres sit, and
 * how deep into the frame their rings run, as fractions of the short side.
 * Close enough that a real left half of the circle shows (reference card),
 * not a thin hatch of far-off sweeps.
 */
const RIGHT_OUTSET_MIN = 0.02;
const RIGHT_OUTSET_MAX = 0.12;
const RIGHT_SPAN_MIN = 0.72;
const RIGHT_SPAN_MAX = 0.95;
/** Ring gap of a right-edge companion, as a multiple of the hero's own gap. */
const RIGHT_SIZE = 0.92;
const RIGHT_RINGS = 0.9;

/**
 * The nest cluster and its companions. Sized to read through the hero's open
 * core (see HERO_RING_SKIP) — bumped from the original tight ripple scale.
 */
const CLUSTER_SIZE = 1.38;
const NEST_SIBLING_SIZE = 0.24;
const NEST_SIBLING_RINGS = 0.4;

/**
 * Reference card — four circles stacked through the hero's open core on a
 * mostly vertical column. Rings are meant to interleave, so clearance is
 * measured on a CORE fraction of each outer radius — enough that two members
 * never share a centre, not so much that four full discs refuse to fit.
 */
const CLUSTER_CORE_FRAC = 0.55;
const CLUSTER_CLEARANCE = 0.18;
/** How far the column may lean off the hero's vertical, as a fraction of reach. */
const CLUSTER_LEAN = 0.22;
/** Per-member left/right drift off the column, as a fraction of reach. */
const CLUSTER_DRIFT_X = 0.1;
const CLUSTER_SPECS: { sizeK: number; ringShare: number }[] = [
  { sizeK: 1, ringShare: 0.35 },
  { sizeK: 2.2, ringShare: NEST_SIBLING_RINGS },
  { sizeK: 2.8, ringShare: NEST_SIBLING_RINGS },
  { sizeK: 3.2, ringShare: NEST_SIBLING_RINGS * 0.88 },
];
/** Inset from the hero's outer ring when tucking a cluster member inside it. */
const HERO_NEST_MARGIN = 0.1;

/** Inner rings the hero skips so the nest cluster reads through its core. */
const HERO_RING_SKIP = 3;

/** Pull a circle center inward so its outer ring stays inside the hero. */
function tuckInsideHero(
  x: number,
  y: number,
  r: number,
  hx: number,
  hy: number,
  hr: number,
  margin: number,
): { x: number; y: number } {
  const dx = x - hx;
  const dy = y - hy;
  const dist = Math.hypot(dx, dy);
  const maxDist = Math.max(0, hr - r - margin);
  if (dist <= maxDist || dist === 0) return { x, y };
  const s = maxDist / dist;
  return { x: hx + dx * s, y: hy + dy * s };
}

/**
 * Push a centre clear of every already-placed sibling. Clearance uses the core
 * fraction of each outer radius so rings may still cross. Iterates a few times
 * so resolving one collision cannot leave it sitting on another; coincident
 * centres get an arbitrary push so they never stay stacked.
 *
 * When `preferVertical` is set the push keeps the member's X and resolves the
 * gap along Y, so a vertical column stays a column instead of being shoved
 * sideways into a fan.
 */
function clearOfSiblings(
  x: number,
  y: number,
  r: number,
  placed: { x: number; y: number; r: number }[],
  gap: number,
  coreFrac = CLUSTER_CORE_FRAC,
  preferVertical = false,
): { x: number; y: number } {
  let cx = x;
  let cy = y;
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const p of placed) {
      const dx = cx - p.x;
      const dy = cy - p.y;
      const dist = Math.hypot(dx, dy);
      const minD = (r + p.r) * coreFrac * (1 + gap);
      if (dist >= minD) continue;
      if (preferVertical) {
        // Hold X near where it was dealt; make up the rest of the gap in Y.
        const holdX = Math.abs(dx) < minD ? dx : Math.sign(dx || 1) * minD * 0.35;
        const yNeed = Math.sqrt(Math.max(0, minD * minD - holdX * holdX));
        const signY =
          Math.abs(dy) < 1e-6 ? (iter % 2 === 0 ? 1 : -1) : Math.sign(dy);
        cx = p.x + holdX;
        cy = p.y + signY * yNeed;
      } else {
        const ang = dist < 1e-6 ? iter * 0.9 : Math.atan2(dy, dx);
        cx = p.x + Math.cos(ang) * minD;
        cy = p.y + Math.sin(ang) * minD;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x: cx, y: cy };
}

/**
 * Seat a nest member inside the hero and clear of its siblings. Ends on a
 * clearance pass so a final tuck cannot drag two centres back on top of each
 * other — better a whisker past the hero edge than a stacked core.
 */
function seatNestMember(
  x: number,
  y: number,
  r: number,
  hx: number,
  hy: number,
  hr: number,
  margin: number,
  placed: { x: number; y: number; r: number }[],
  frame?: { w: number; h: number; pad: number },
  preferVertical = false,
): { x: number; y: number } {
  let cur = { x, y };
  for (let iter = 0; iter < 5; iter++) {
    cur = tuckInsideHero(cur.x, cur.y, r, hx, hy, hr, margin);
    if (frame) {
      cur = tuckInsideFrame(cur.x, cur.y, r, frame.w, frame.h, frame.pad);
    }
    const cleared = clearOfSiblings(
      cur.x,
      cur.y,
      r,
      placed,
      CLUSTER_CLEARANCE,
      CLUSTER_CORE_FRAC,
      preferVertical,
    );
    if (
      Math.hypot(cleared.x - cur.x, cleared.y - cur.y) < 0.5 &&
      iter > 0
    ) {
      cur = cleared;
      break;
    }
    cur = cleared;
  }
  return cur;
}

/** Pull a center so its outer ring stays inside the canvas. */
function tuckInsideFrame(
  x: number,
  y: number,
  r: number,
  w: number,
  h: number,
  pad: number,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, pad + r), w - pad - r),
    y: Math.min(Math.max(y, pad + r), h - pad - r),
  };
}

/**
 * Hand breakage — short nicks where the pen lifted, in PIXELS of arc length
 * so they read the same on a tight inner ring and a wide outer sweep. Kept
 * small on purpose: this is the fine interruption under the Line Breaks
 * treatment, not a second source of arcs.
 */
const NICK_MIN_PX = 4;
const NICK_MAX_PX = 15;
const NICK_MIN_PER_RING = 1;

/**
 * A lighter dissolve than the shared default. The fields the default was tuned
 * for run their vectors top to bottom, so a band starting at 0.78 of the height
 * softens the ENDS of the strokes. A ring has no end — the band just cuts a
 * chord off the bottom of every circle and tapers it away, which reads as the
 * circles dissolving rather than as the field settling. Held to the last tenth
 * of the frame, with a short tip, so the arcs stay whole.
 */
const SIGNAL_FADE = { start: 0.9, tipFrac: 0.15 } as const;

/**
 * Camera zoom — the finished ring field is magnified about the hero anchor so
 * the card reads closer in without reshaping the nest. Applied after tracing,
 * like Mesh, rather than by cranking Scale: that keeps spacing and placement
 * tuned separately from how tight the frame crops.
 */
const SIGNAL_ZOOM = 1.5;

/** Scale every traced point about a focal centre. */
function zoomSignalLines(
  lines: SignalLine[],
  cx: number,
  cy: number,
  zoom: number,
): void {
  if (zoom === 1) return;
  for (const line of lines) {
    for (let i = 0; i < line.pts.length; i += 2) {
      line.pts[i] = cx + (line.pts[i] - cx) * zoom;
      line.pts[i + 1] = cy + (line.pts[i + 1] - cy) * zoom;
    }
  }
}

/**
 * Lay out the transmitters, smallest family first. The reference card reads as
 * a stack of ripples stepping up in scale, so the ring gap ramps with the
 * family index and each family is stroked over the top of the last.
 *
 *   0     the nest — small circles stacked through the hero's open core
 *   1     the hero — centred in frame, fixed size
 *   2..n  larger companions parked just past the right edge, stacked
 *         top-to-bottom so their left halves fill the right of the card
 */
function placeCenters(
  w: number,
  h: number,
  n: number,
  rand: () => number,
  spacing: number,
  ringCount: number,
): Center[] {
  const min = Math.min(w, h);

  /** Roughly where a family's outermost ring lands, in px. */
  const outerRadius = (
    stepMul: number,
    inset: number,
    grow: number,
    ringShare: number,
  ) =>
    (inset +
      stepMul * Math.max(1, Math.round(ringCount * ringShare)) * (1 + grow)) *
    spacing;

  /** Hero ring gap — deterministic from the family count. */
  const heroStep =
    n > 1 ? SIZE_MIN + (SIZE_MAX - SIZE_MIN) * (1 / (n - 1)) : SIZE_MAX;
  const heroOuterEstimate = outerRadius(heroStep, HERO_INSET, HERO_GROW, 1);
  const heroNestMargin = spacing * HERO_NEST_MARGIN;

  const sectorsFor = (count: number): Sector[] =>
    Array.from({ length: count }, () => ({
      base: rand() * TAU,
      span: (0.5 + rand() * 0.75) * TAU * 0.25,
      // Slow rotation only: a fast drift shreds the family into confetti.
      drift: (rand() - 0.5) * 0.34,
    }));

  // Hero anchor — fixed center-right. Size AND seat stay put seed to seed; the
  // slider only rearranges the nest inside. Clamped so the fixed radius draws
  // whole on short canvases.
  const heroR = heroTargetRadius(w, h);
  const anchorPad = heroR + spacing * 0.15;
  const anchorX = Math.min(Math.max(w * HERO_ANCHOR_X, anchorPad), w - anchorPad);
  const anchorY = Math.min(Math.max(h * HERO_ANCHOR_Y, anchorPad), h - anchorPad);

  // Every in-frame center placed so far, with the reach of its outermost ring.
  const inFrame: { x: number; y: number; r: number }[] = [];

  const out: Center[] = [];
  for (let i = 0; i < n; i++) {
    // Near-round: the ellipse is a hand tremor, not an oval.
    const sx = 0.97 + rand() * 0.06;
    const sy = 0.97 + rand() * 0.06;
    const rot = rand() * TAU;
    const phaseA = rand() * TAU;
    const phaseB = rand() * TAU;
    // Size ramp — spread across however many families there are, so the
    // smallest and largest stay the same scale whatever Circles is set to.
    const ramp = n > 1 ? i / (n - 1) : 0;
    const step = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * ramp;

    if (i === 0) {
      const clusterStep = step * CLUSTER_SIZE;
      const grow = 0.2 + rand() * 0.25;
      const framePad = spacing * 0.15;
      // Vertical column through the hero. Seed picks a light lean left or
      // right and how tall the stack runs — the members stay lined up rather
      // than fanning across the interior.
      const innerReach = heroOuterEstimate * (0.52 + rand() * 0.26);
      const lean =
        (rand() < 0.5 ? -1 : 1) * CLUSTER_LEAN * (0.35 + rand() * 0.65);
      const colX = anchorX + heroOuterEstimate * lean;
      const ySpan = innerReach * (1.15 + rand() * 0.35);
      const yStart = anchorY - ySpan * 0.5;
      const yStep =
        CLUSTER_SPECS.length > 1 ? ySpan / (CLUSTER_SPECS.length - 1) : 0;

      const placed: { x: number; y: number; r: number }[] = [];

      for (let p = 0; p < CLUSTER_SPECS.length; p++) {
        const spec = CLUSTER_SPECS[p];
        const stepMul =
          clusterStep * (1 + NEST_SIBLING_SIZE * Math.max(0, spec.sizeK - 1));
        const cr = outerRadius(stepMul, 0.5, grow, spec.ringShare);
        const cx =
          colX +
          heroOuterEstimate * CLUSTER_DRIFT_X * (rand() - 0.5) * 2;
        const cy =
          yStart + yStep * p + innerReach * 0.06 * (rand() - 0.5);
        const seated = seatNestMember(
          cx,
          cy,
          cr,
          anchorX,
          anchorY,
          heroOuterEstimate,
          heroNestMargin,
          placed,
          { w, h, pad: framePad },
          true,
        );
        out.push({
          x: seated.x,
          y: seated.y,
          sx: 0.97 + rand() * 0.06,
          sy: 0.97 + rand() * 0.06,
          rot: rand() * TAU,
          step: stepMul,
          inset: 0.5,
          reach: 0,
          grow,
          rings: spec.ringShare,
          span: Infinity,
          sectors: sectorsFor(1 + Math.floor(rand() * 2)),
          phaseA: rand() * TAU,
          phaseB: rand() * TAU,
        });
        placed.push({ x: seated.x, y: seated.y, r: cr });
      }
      continue;
    }

    if (i === 1) {
      // Fully fixed — size, seat, roundness, quiet sectors. Seed must not spend
      // any of its randomness here; that is for the nest below.
      const inset = HERO_INSET;
      const grow = HERO_GROW;
      const heroOuter = outerRadius(step, inset, grow, 1);
      inFrame.push({
        x: anchorX,
        y: anchorY,
        r: heroOuter,
      });
      out.push({
        x: anchorX,
        y: anchorY,
        sx: 1,
        sy: 1,
        rot: 0,
        step,
        inset,
        reach: 0,
        grow,
        rings: 1,
        span: Infinity,
        sectors: HERO_SECTORS,
        phaseA: 0,
        phaseB: 0,
      });
      // The nest was laid out against an estimate of the hero. Re-seat each
      // member inside the real outer ring, keeping cores clear of one another.
      const nestPlaced: { x: number; y: number; r: number }[] = [];
      for (let j = 0; j < out.length - 1; j++) {
        const c = out[j];
        const cr = outerRadius(c.step, c.inset, c.grow, c.rings);
        const seated = seatNestMember(
          c.x,
          c.y,
          cr,
          anchorX,
          anchorY,
          heroOuter,
          heroNestMargin,
          nestPlaced,
          { w, h, pad: spacing * 0.15 },
          true,
        );
        c.x = seated.x;
        c.y = seated.y;
        nestPlaced.push({ x: c.x, y: c.y, r: cr });
      }
      continue;
    }

    // Right-edge companions. Larger than the nest, stacked upper then lower.
    // Targets are where they should sit AFTER the camera zoom (just past the
    // right edge); invert that zoom about the hero so they land there once
    // magnified. Tiny `reach` keeps them out of the fit scale so they cannot
    // shrink the hero, without cutting their first rings away.
    const rightIndex = i - 2;
    const rightCount = Math.max(1, n - 2);
    const t = rightCount === 1 ? 0.45 : rightIndex / (rightCount - 1);
    const targetX =
      w +
      min *
        (RIGHT_OUTSET_MIN +
          rand() * (RIGHT_OUTSET_MAX - RIGHT_OUTSET_MIN));
    const targetY = h * (0.24 + t * 0.52) + (rand() - 0.5) * h * 0.05;
    const x = anchorX + (targetX - anchorX) / SIGNAL_ZOOM;
    const y = anchorY + (targetY - anchorY) / SIGNAL_ZOOM;
    out.push({
      x,
      y,
      sx,
      sy,
      rot,
      // Sized off the hero's gap so they read as the next tier up from the
      // nest — a little larger, not a rival for the main circle.
      step: heroStep * RIGHT_SIZE,
      inset: 0,
      reach: 1,
      grow: 0.15 + rand() * 0.2,
      rings: RIGHT_RINGS,
      span: min * (RIGHT_SPAN_MIN + rand() * (RIGHT_SPAN_MAX - RIGHT_SPAN_MIN)),
      sectors: sectorsFor(1 + Math.floor(rand() * 2)),
      phaseA,
      phaseB,
    });
  }
  return out;
}

/**
 * Trace concentric rings as broken polylines. Rings stay compass-true — the
 * only deviation is a two-harmonic out-of-round, so an arc never wobbles.
 * Each family carries its own quiet sectors, which rotate slowly outward
 * through the rings: that coherence is what makes the arcs sweep together
 * instead of reading as randomly dashed circles.
 */
export function computeSignal(
  w: number,
  h: number,
  p: SignalParams,
): SignalLine[] {
  const rand = mulberry32(p.seed ^ 0xb5f7);
  const lines: SignalLine[] = [];
  const ringCount = Math.max(1, Math.round(p.rings));
  const baseStep = Math.max(8, p.spacing);
  const round = Math.max(0, p.jitter);
  // Placement at the tuned scale — composition stays as designed; a uniform
  // fit scale grows or shrinks every ring together so the pattern fills most
  // of the frame without clipping.
  const centers = placeCenters(
    w,
    h,
    Math.max(1, Math.round(p.centers)),
    rand,
    baseStep,
    ringCount,
  );
  const pad = p.lineWidth + 4;
  const fit =
    patternFitScale(centers, w, h, baseStep, ringCount, round, pad) /
    Math.max(1, SIGNAL_ZOOM);
  const step = baseStep * fit;
  // The nest is packed against an ESTIMATE of the hero's reach, taken before
  // the fit scale is known. The fit shrinks every radius but leaves the centers
  // where they were, so a member tucked just inside the estimate can end up
  // sitting outside the hero once it is actually drawn — small circles adrift
  // off the hero's edge rather than nested in its ring field. Re-tuck against
  // the radii the families really draw at, sliding each one straight back along
  // its own line to the hero so the composition keeps its spread.
  const anchor = findHero(centers);
  if (anchor) {
    const heroR = familyOuter(anchor, step, ringCount, round);
    const margin = baseStep * HERO_NEST_MARGIN * fit;
    const nestPlaced: { x: number; y: number; r: number }[] = [];
    for (const c of centers) {
      if (c === anchor || c.reach !== 0) continue; // off-frame families stay put
      const cr = familyOuter(c, step, ringCount, round);
      const seated = seatNestMember(
        c.x,
        c.y,
        cr,
        anchor.x,
        anchor.y,
        heroR,
        margin,
        nestPlaced,
        undefined,
        true,
      );
      c.x = seated.x;
      c.y = seated.y;
      nestPlaced.push({ x: c.x, y: c.y, r: cr });
    }
  }
  // Widest radius worth tracing, measured from anywhere in or near the frame.
  const diag = Math.hypot(w, h);

  for (let family = 0; family < centers.length; family++) {
    const c = centers[family];
    const cosR = Math.cos(c.rot);
    const sinR = Math.sin(c.rot);
    const cStep = c.step * step;
    // Ring i sits at reach + inset + cStep·i, the gap widening outward by `grow`.
    const base = c.reach * fit + c.inset * step;
    // Off-frame families need the same visible ring count as the hero, so cut
    // on distance to the far corner rather than on the index alone — then
    // pull that in to the family's own sweep span, so its waves hatch a band
    // of the canvas instead of crossing the whole of it.
    const farthest = Math.min(
      Math.hypot(
        Math.max(Math.abs(c.x), Math.abs(w - c.x)),
        Math.max(Math.abs(c.y), Math.abs(h - c.y)),
      ),
      (c.reach + c.span) * fit,
    );
    const famRings = Math.max(1, Math.round(ringCount * c.rings));
    const isHero = c.rings === 1 && c.inset >= 0.85;
    const ringSkip = isHero ? HERO_RING_SKIP : 0;

    for (let i = 1 + ringSkip; i <= famRings; i++) {
      let radius = base + cStep * i * (1 + (c.grow * i) / famRings);
      // Ring-to-ring drift on every family but the hero — the nest and sweeps
      // can wander; the hero's radius is the constant the card is measured by.
      if (!isHero) radius *= 1 + (rand() - 0.5) * round * 0.5;
      if (radius > farthest) break;

      const ringSeed = rand();
      const gaps: { start: number; end: number }[] = [];
      if (p.breakiness > 0.01) {
        for (const s of c.sectors) {
          // Scaled off the 0.34 default so Breaks reads as "how wide".
          const span = s.span * (p.breakiness / 0.34) * (0.8 + ringSeed * 0.4);
          const start = s.base + s.drift * i + (ringSeed - 0.5) * 0.3;
          gaps.push({ start, end: start + Math.min(span, TAU * 0.62) });
        }
      }

      // Hand breakage: the pen lifting for a moment, once or twice a ring.
      // Measured in PIXELS of arc rather than radians, so a nick reads the
      // same size on a tight inner ring as on a wide outer sweep — in radians
      // the inner rings would gape and the outer ones would close up.
      //
      // Separate from Breaks, which cuts the wide quiet sectors. This is the
      // fine interruption the card carries even where its rings run whole.
      const nicks = NICK_MIN_PER_RING + Math.floor(rand() * 2 + radius / 340);
      for (let g = 0; g < nicks; g++) {
        const at = rand() * TAU;
        const len =
          (NICK_MIN_PX + rand() * (NICK_MAX_PX - NICK_MIN_PX)) /
          Math.max(1, radius);
        gaps.push({ start: at, end: at + len });
      }

      const inGap = (a: number) => {
        const ang = ((a % TAU) + TAU) % TAU;
        return gaps.some((g) => {
          const s = ((g.start % TAU) + TAU) % TAU;
          const e = s + (g.end - g.start);
          if (ang >= s && ang <= e) return true;
          if (e > TAU && ang <= e - TAU) return true;
          return false;
        });
      };

      // Dense sampling so polylines read as continuous curves, not polygons.
      const samples = Math.max(120, Math.round((radius * TAU) / 2.5));
      let current: number[] = [];
      // Measured from where the family's wave enters the frame, not from its
      // center — otherwise the off-frame sweeps would all be "late" at once.
      const order = Math.min(1, (radius - c.reach) / (diag * 0.9));
      const flush = () => {
        if (current.length >= 4) {
          lines.push({ pts: current, w: p.lineWidth, order, family });
        }
        current = [];
      };

      for (let k = 0; k <= samples; k++) {
        const a = (k / samples) * TAU;
        if (inGap(a)) {
          flush();
          continue;
        }

        // Two low harmonics, phase-drifting with the ring index. Smooth by
        // construction — no noise lookup, so there is nothing to wobble.
        const off =
          Math.sin(a * 2 + c.phaseA + i * 0.35) * 0.62 +
          Math.sin(a * 3 + c.phaseB - i * 0.22) * 0.38;
        const rr = radius * (1 + off * round * 0.5);

        const lx = Math.cos(a) * rr * c.sx;
        const ly = Math.sin(a) * rr * c.sy;
        const x = c.x + lx * cosR - ly * sinR;
        const y = c.y + lx * sinR + ly * cosR;
        current.push(x, y);
      }
      flush();
    }
  }

  // Stack smallest family to largest, then radially within each. The growth
  // animation still ripples outward from every transmitter at once, since it
  // keys off `order` rather than position in this list.
  lines.sort((a, b) => a.family - b.family || a.order - b.order);

  const hero = findHero(centers);
  if (hero) zoomSignalLines(lines, hero.x, hero.y, SIGNAL_ZOOM);

  return lines;
}

export function drawSignal(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  lines: SignalLine[],
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
      paintSignalLines(tctx, w, h, lines, ink, progress, fade, fadeSeed),
    );
    return;
  }
  paintSignalLines(ctx, w, h, lines, ink, progress, fade, fadeSeed);
}

/** Stroke every signal arc onto `ctx` (transform must already be set). */
function paintSignalLines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lines: SignalLine[],
  ink: string,
  progress: number,
  fade: boolean,
  fadeSeed: number,
) {
  ctx.strokeStyle = ink;
  ctx.lineCap = fade ? "round" : "butt";
  ctx.lineJoin = "round";

  const fieldFade = fade
    ? makeFade(w, h, { ...SIGNAL_FADE, seed: fadeSeed })
    : null;
  const SPREAD = 0.7;
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

export function buildSignalSVG(
  w: number,
  h: number,
  lines: SignalLine[],
  ink: string,
  background: string,
  fade = false,
  fadeSeed = 1,
  stamp?: StampOpts,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const fieldFade = fade
    ? makeFade(w, h, { ...SIGNAL_FADE, seed: fadeSeed })
    : null;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="${background}"/>`,
  ];

  // Ink-stamp treatment: traced into real vector paths (see stampTreatment)
  // so the export survives design tools that ignore SVG filters.
  if (stampActive(stamp)) {
    const d = traceStampPathD(w, h, ink, stamp, (tctx) =>
      paintSignalLines(tctx, w, h, lines, ink, 1, fade, fadeSeed),
    );
    parts.push(`<path d="${d}" fill="${ink}" fill-rule="evenodd"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  }

  parts.push(
    `<g fill="none" stroke="${ink}" stroke-linecap="${fade ? "round" : "butt"}" stroke-linejoin="round">`,
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
