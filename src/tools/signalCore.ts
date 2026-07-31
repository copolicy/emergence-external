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
  seed: 55555,
  // Fixed at the card's composition — the hero with its cluster of small
  // circles, and one off-frame family hatching in. Not on the rail: the count
  // is part of the vertical's look, not a knob.
  //
  // Three, not four. A fourth puts a second large circle in frame, nested into
  // the hero — its outer rings sweep the top of the canvas and cut through the
  // cluster, which is the whole of the busyness. The card has ONE big circle.
  centers: 3,
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
  seed: [1, 99999, 1],
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
  seed: "Random starting value. Same seed always produces the same signal field.",
  centers:
    "How many circle families are on the canvas. The smallest always draws with two slightly larger companions alongside it, on whichever side the seed picks; the next sits in frame as the hero. After that they alternate — one pushed off the edge so only wide sweeping arcs cross the canvas, then one more circle nested into the hero.",
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

export const SLIDER_KEYS_SIMPLE_SIGNAL: (keyof SignalParams)[] = [
  "seed",
  "lineWidth",
  "cutout",
];

export interface SignalLine {
  pts: number[];
  w: number;
  order: number;
  family: number; // index of the family that drew it — sets the stacking order
}

const TAU = Math.PI * 2;

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
 * How far an off-frame family keeps drawing past the point its wave first
 * reaches the canvas, as a fraction of the short side. The card reads as ONE
 * circle family with sweeps hatching in from an edge — let the off-frame
 * waves run the full width and they stop being an accent and start being a
 * mesh laid over the hero.
 */
const SWEEP_MIN = 0.3;
const SWEEP_MAX = 0.55;

/**
 * How far the first extra in-frame circle sits from the hero's center, as a
 * fraction of the hero's own reach, and how much further each one after it
 * steps. Small on purpose: the extras nest inside the hero so their rings
 * interleave with it. Push them out toward half the reach and the two ring
 * fields start crossing at right angles, which reads as collision rather than
 * as one system knocked off-center.
 */
const NEST_MIN = 0.14;
const NEST_GROWTH = 0.55;

/**
 * The two companions alongside the smallest circle. Each runs a wider ring gap
 * than the one before it, draws a short run of rings, and is set clear of its
 * predecessor by the two outer radii plus CLEARANCE — they sit next to the
 * smallest circle, never over it.
 */
const NEST_RINGS = 0.3;
const NEST_SIBLING_SIZE = 0.2;
const NEST_SIBLING_RINGS = 0.3;
const NEST_SIBLING_CLEARANCE = 0.06;
/** Width of the arc, in radians, the group is dealt across on its side. */
const NEST_SIBLING_ARC = 2.6;

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
 * Lay out the transmitters, smallest family first. The reference card reads as
 * a stack of ripples stepping up in scale, so the ring gap ramps with the
 * family index and each family is stroked over the top of the last.
 *
 *   0     the tightest nest, set just off the anchor
 *   1     the hero — anchored in frame, rings climbing off canvas
 *   2..n  alternating: even indices push clean outside the frame, so only
 *         broad near-parallel sweeps cross the canvas and cross-hatch against
 *         the hero; odd indices land in frame as further circles, dropped into
 *         whatever open ground is left.
 *
 * The alternation is what makes Circles read as a count. Send every family
 * past the hero off-frame and the slider only ever thickens one band of
 * sweeps — you can run it to 12 and never see a second circle.
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
    (inset + stepMul * Math.max(1, Math.round(ringCount * ringShare)) * (1 + grow)) *
    spacing;

  const sectorsFor = (count: number): Sector[] =>
    Array.from({ length: count }, () => ({
      base: rand() * TAU,
      span: (0.5 + rand() * 0.75) * TAU * 0.25,
      // Slow rotation only: a fast drift shreds the family into confetti.
      drift: (rand() - 0.5) * 0.34,
    }));

  // The two in-frame families share this point so their rings nest together.
  const anchorX = w * (0.28 + rand() * 0.2);
  const anchorY = h * (0.32 + rand() * 0.16);

  // Every in-frame center placed so far, with the reach of its outermost ring.
  // Later circles are set a fraction of that reach away, so they always land
  // inside a neighbour's ring field and the two interleave.
  const inFrame: { x: number; y: number; r: number }[] = [];
  // Direction the first extra circle steps off the hero; the rest turn from it.
  const nestBase = rand() * TAU;
  // Which side of the smallest circle its two companions fall on.
  const nestSide = rand() < 0.5 ? -1 : 1;

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
      // Tightest nest: sits just off the anchor, inside the hero's inner rings.
      // It reads as a detail in the hero's core, so it draws a short run of
      // rings — carry it out to the full count and the two families stack into
      // one over-ringed blob instead of a nest inside a circle.
      const ang = rand() * TAU;
      const dist = min * (0.08 + rand() * 0.08);
      const grow = 0.2 + rand() * 0.25;
      const nestX = anchorX + Math.cos(ang) * dist;
      const nestY = anchorY + Math.sin(ang) * dist;
      out.push({
        x: nestX,
        y: nestY,
        sx,
        sy,
        rot,
        step,
        inset: 0.5,
        reach: 0,
        grow,
        rings: NEST_RINGS,
        span: Infinity,
        sectors: sectorsFor(1 + Math.floor(rand() * 2)),
        phaseA,
        phaseB,
      });

      // Three companions alongside it, each a step larger than the last, set
      // clear of it and of each other: the four sit shoulder to shoulder as
      // separate circles, never interleaving. Each one is pushed off its
      // PREDECESSOR by the two outer radii plus a margin, so the clearance
      // holds whatever Scale and Rings are doing to the circle sizes.
      //
      // They fall on ONE side — which side is the seed's to pick — so the core
      // reads as a little run of ripples leaning off the nest rather than a
      // symmetrical rosette around it.
      const nestR = outerRadius(step, 0.5, grow, NEST_RINGS);
      // Sizes 2 and 3 of the ramp, not 1: the ×1.2 companion sat too close to
      // the nest's own size and read as a duplicate in the middle of the
      // group. Skipping it steps the three sizes apart clearly.
      const sibs = [2, 3].map((k) => ({
        stepMul: step * (1 + NEST_SIBLING_SIZE * k),
        grow: 0.2 + rand() * 0.25,
        // Tilted a little off the horizontal so the three centers don't line
        // up dead level.
        tilt: (rand() - 0.5) * 0.7,
        sx: 0.97 + rand() * 0.06,
        sy: 0.97 + rand() * 0.06,
        rot: rand() * TAU,
        sectors: sectorsFor(1 + Math.floor(rand() * 2)),
        phaseA: rand() * TAU,
        phaseB: rand() * TAU,
      }));

      // Pack them rather than chain them. Setting each circle off the LAST one
      // walks a path, and a path of four reads as a line however much it's
      // curled. Setting each one tangent to ANY circle already down lets the
      // group bunch — one tucked under the nest, one out past it — which is
      // what the reference reads as.
      //
      // How far a circle pokes past the frame. A ring clipping the edge still
      // reads; a center off canvas is just stray arcs, so the radius counts
      // only partly.
      const escape = (x: number, y: number, r: number) =>
        Math.max(
          0,
          -x + r * 0.35,
          x + r * 0.35 - w,
          -y + r * 0.35,
          y + r * 0.35 - h,
        );

      const packed = [{ x: nestX, y: nestY, r: nestR }];
      const sideAng = nestSide > 0 ? 0 : Math.PI;
      for (const s of sibs) {
        const r = outerRadius(s.stepMul, 0.5, s.grow, NEST_SIBLING_RINGS);
        let bx = nestX;
        let by = nestY;
        let best = -Infinity;
        for (let t = 0; t < 24; t++) {
          const host = packed[Math.floor(rand() * packed.length)];
          // Biased to the seed's side, but over a wide enough arc that the
          // group leans without lining up.
          const ang = sideAng + s.tilt + (rand() - 0.5) * NEST_SIBLING_ARC;
          const d = (host.r + r) * (1 + NEST_SIBLING_CLEARANCE);
          const px = host.x + Math.cos(ang) * d;
          const py = host.y + Math.sin(ang) * d;
          // Clearance against every circle already down — negative means it
          // cuts into one, which disqualifies the spot outright.
          let gap = Infinity;
          for (const o of packed) {
            gap = Math.min(gap, Math.hypot(px - o.x, py - o.y) - (o.r + r));
          }
          if (gap < 0) continue;
          // Staying in frame outweighs breathing room; past a point extra
          // clearance just spreads the group out again.
          const score = Math.min(gap, r * 0.5) - escape(px, py, r) * 4;
          if (score > best) {
            best = score;
            bx = px;
            by = py;
          }
        }
        packed.push({ x: bx, y: by, r });
      }

      for (let k = 0; k < sibs.length; k++) {
        const s = sibs[k];
        out.push({
          x: packed[k + 1].x,
          y: packed[k + 1].y,
          sx: s.sx,
          sy: s.sy,
          rot: s.rot,
          step: s.stepMul,
          inset: 0.5,
          reach: 0,
          grow: s.grow,
          // A ring or two shorter than the nest itself — three full runs of
          // rings sitting side by side would crowd the core right out to the
          // frame edges.
          rings: NEST_SIBLING_RINGS,
          span: Infinity,
          sectors: s.sectors,
          phaseA: s.phaseA,
          phaseB: s.phaseB,
        });
      }
      continue;
    }

    if (i === 1) {
      const inset = 0.9 + rand() * 0.5;
      const grow = 0.3 + rand() * 0.2;
      inFrame.push({
        x: anchorX,
        y: anchorY,
        r: outerRadius(step, inset, grow, 1),
      });
      out.push({
        x: anchorX,
        y: anchorY,
        sx,
        sy,
        rot,
        step,
        inset,
        reach: 0,
        grow,
        rings: 1,
        span: Infinity,
        sectors: sectorsFor(1 + Math.floor(rand() * 2)),
        phaseA,
        phaseB,
      });
      continue;
    }

    if (i % 2 === 1) {
      // A further circle, in frame. It nests INSIDE the hero rather than being
      // dealt its own patch of canvas: the card reads as one system of rings
      // knocked slightly off-center, not as separate circles colliding. So the
      // offset is a small step measured in the hero's reach — enough that the
      // rings interleave, never so much that they cross at a right angle.
      //
      // Measured in reach, not in canvas, so the nesting survives the Scale
      // slider: a canvas-relative gap only closes once Scale is cranked up far
      // enough, and by then the rings have run off the edges.
      const inset = 0.6 + rand() * 0.4;
      const grow = 0.2 + rand() * 0.3;
      const mine = step * 0.7;
      const hero = inFrame[0];

      // Each successive circle steps a little further out, turning by the
      // golden angle so the cores fan around the hero instead of drifting off
      // one side. Deliberate, not dealt.
      const nth = inFrame.length - 1;
      const d = hero.r * NEST_MIN * (1 + nth * NEST_GROWTH);
      const ang = nestBase + nth * 2.39996 + (rand() - 0.5) * 0.5;
      // Kept off the very edge — a center outside the frame turns the family
      // into another set of edge sweeps, which is what the off-frame ones
      // are already for.
      const bx = Math.min(Math.max(hero.x + Math.cos(ang) * d, w * 0.1), w * 0.9);
      const by = Math.min(Math.max(hero.y + Math.sin(ang) * d, h * 0.1), h * 0.9);

      inFrame.push({ x: bx, y: by, r: outerRadius(mine, inset, grow, 0.7) });
      out.push({
        x: bx,
        y: by,
        sx,
        sy,
        rot,
        // Held under the hero's gap so it stays the second circle in the
        // composition rather than a rival for it.
        step: mine,
        inset,
        reach: 0,
        grow,
        rings: 0.7,
        span: Infinity,
        sectors: sectorsFor(1 + Math.floor(rand() * 2)),
        phaseA,
        phaseB,
      });
      continue;
    }

    // Off-frame families. Sit them beyond the frame and start the rings where
    // they first reach the canvas, so every ring drawn is a wide sweep.
    //
    // They go on the far side of the anchor, never the hero's own side: a
    // transmitter sitting behind the hero drives its sweeps straight through
    // the circles and the composition closes up. Out here they hatch in
    // against the hero's outer rings and leave the anchor's own quarter open.
    const awayX = w * 0.5 - anchorX;
    const awayY = h * 0.5 - anchorY;
    const away =
      awayX === 0 && awayY === 0 ? 0 : Math.atan2(awayY, awayX);
    const ang = away + (rand() - 0.5) * 1.5;
    // Well clear of the frame. Park one just outside and its first rings land
    // as tight little arcs hugging that edge — the family has to be far enough
    // out that everything it draws on canvas is a broad, near-parallel sweep.
    const dist = min * (0.95 + rand() * 0.8);
    const x = w * 0.5 + Math.cos(ang) * dist;
    const y = h * 0.5 + Math.sin(ang) * dist;
    // Distance to the nearest point of the frame — the first ring that lands.
    const dx = Math.max(0, Math.max(-x, x - w));
    const dy = Math.max(0, Math.max(-y, y - h));
    const reach = Math.hypot(dx, dy);
    out.push({
      x,
      y,
      sx,
      sy,
      rot,
      // Tighter gap than an in-frame family of the same size. The sweeps only
      // read as a hatch when several of them cross the hero's rings; on the
      // hero's own gap a band this narrow fits three arcs and reads as strays.
      step: step * 0.6,
      inset: 0,
      reach,
      grow: rand() * 0.15,
      rings: 1,
      span: min * (SWEEP_MIN + rand() * (SWEEP_MAX - SWEEP_MIN)),
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
  const step = Math.max(8, p.spacing);
  const round = Math.max(0, p.jitter);
  // Placement needs the ring scale: how far apart the in-frame circles sit is
  // measured in ring reach, so the composition holds as Scale moves.
  const centers = placeCenters(
    w,
    h,
    Math.max(1, Math.round(p.centers)),
    rand,
    step,
    ringCount,
  );
  // Widest radius worth tracing, measured from anywhere in or near the frame.
  const diag = Math.hypot(w, h);

  for (let family = 0; family < centers.length; family++) {
    const c = centers[family];
    const cosR = Math.cos(c.rot);
    const sinR = Math.sin(c.rot);
    const cStep = c.step * step;
    // Ring i sits at reach + inset + cStep·i, the gap widening outward by `grow`.
    const base = c.reach + c.inset * step;
    // Off-frame families need the same visible ring count as the hero, so cut
    // on distance to the far corner rather than on the index alone — then
    // pull that in to the family's own sweep span, so its waves hatch a band
    // of the canvas instead of crossing the whole of it.
    const farthest = Math.min(
      Math.hypot(
        Math.max(Math.abs(c.x), Math.abs(w - c.x)),
        Math.max(Math.abs(c.y), Math.abs(h - c.y)),
      ),
      c.reach + c.span,
    );
    const famRings = Math.max(1, Math.round(ringCount * c.rings));

    for (let i = 1; i <= famRings; i++) {
      let radius = base + cStep * i * (1 + (c.grow * i) / famRings);
      // Ring-to-ring drift: the family stays related without being mechanical.
      radius *= 1 + (rand() - 0.5) * round * 0.5;
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

  const fieldFade = fade ? makeFade(w, h, { ...SIGNAL_FADE, seed: fadeSeed }) : null;
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
  const fieldFade = fade ? makeFade(w, h, { ...SIGNAL_FADE, seed: fadeSeed }) : null;
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
