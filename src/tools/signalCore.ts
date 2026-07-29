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
export const INK = "#00280F"; // Dark green — matches Telecom vertical card
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
  centers: 4,
  rings: 9,
  spacing: 30,
  lineWidth: 0.6,
  breakiness: 0.34,
  // Barely out of round. The rings must read as drawn with a compass; anything
  // above ~0.12 tips them into ripples and loses the telecom feel.
  jitter: 0.06,
  // Same treatment defaults as the Root Brush / vertical-card references.
  stamp: 0.34,
  cutout: 0.34,
};

export const SIGNAL_RANGES: Record<
  keyof SignalParams,
  [number, number, number]
> = {
  seed: [1, 99999, 1],
  centers: [1, 12, 1],
  rings: [1, 24, 1],
  spacing: [8, 80, 1],
  lineWidth: [0.3, 2.5, 0.1],
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
    "How many circle families are on the canvas. The first sits in frame with a tight nested cluster beside it; the rest push off the edges so only wide sweeping arcs cross the canvas.",
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
  "centers",
  "spacing",
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
  sectors: Sector[];
  phaseA: number;
  phaseB: number;
}

/** Ring gap of the smallest and largest family, as a multiple of Scale. */
const SIZE_MIN = 0.45;
const SIZE_MAX = 1.4;

/**
 * Lay out the transmitters, smallest family first. The reference card reads as
 * a stack of ripples stepping up in scale, so family i always draws on a wider
 * ring gap than i-1 and is stroked over the top of it.
 *
 *   0     the tightest nest, set just off the anchor
 *   1     the hero — anchored in frame, rings climbing off canvas
 *   2..n  pushed clean outside the frame, so only broad near-parallel sweeps
 *         cross the canvas and cross-hatch against the hero
 */
function placeCenters(
  w: number,
  h: number,
  n: number,
  rand: () => number,
): Center[] {
  const min = Math.min(w, h);

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
      const ang = rand() * TAU;
      const dist = min * (0.14 + rand() * 0.14);
      out.push({
        x: anchorX + Math.cos(ang) * dist,
        y: anchorY + Math.sin(ang) * dist,
        sx,
        sy,
        rot,
        step,
        inset: 0.5,
        reach: 0,
        grow: 0.2 + rand() * 0.25,
        sectors: sectorsFor(1 + Math.floor(rand() * 2)),
        phaseA,
        phaseB,
      });
      continue;
    }

    if (i === 1) {
      out.push({
        x: anchorX,
        y: anchorY,
        sx,
        sy,
        rot,
        step,
        inset: 0.9 + rand() * 0.5,
        reach: 0,
        grow: 0.3 + rand() * 0.2,
        sectors: sectorsFor(1 + Math.floor(rand() * 2)),
        phaseA,
        phaseB,
      });
      continue;
    }

    // Off-frame families. Sit them beyond an edge and start the rings where
    // they first reach the canvas, so every ring drawn is a wide sweep.
    const edge = Math.floor(rand() * 4);
    const along = 0.1 + rand() * 0.8;
    const push = min * (0.25 + rand() * 0.75);
    let x: number;
    let y: number;
    if (edge === 0) {
      x = w + push;
      y = h * along;
    } else if (edge === 1) {
      x = -push;
      y = h * along;
    } else if (edge === 2) {
      x = w * along;
      y = -push;
    } else {
      x = w * along;
      y = h + push;
    }
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
      step,
      inset: 0,
      reach,
      grow: rand() * 0.15,
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
  const centers = placeCenters(w, h, Math.max(1, Math.round(p.centers)), rand);
  const lines: SignalLine[] = [];
  const ringCount = Math.max(1, Math.round(p.rings));
  const step = Math.max(8, p.spacing);
  const round = Math.max(0, p.jitter);
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
    // on distance to the far corner rather than on the index alone.
    const farthest = Math.hypot(
      Math.max(Math.abs(c.x), Math.abs(w - c.x)),
      Math.max(Math.abs(c.y), Math.abs(h - c.y)),
    );

    for (let i = 1; i <= ringCount; i++) {
      let radius = base + cStep * i * (1 + (c.grow * i) / ringCount);
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
        // A short nick now and then — the stray dashes in the reference.
        if (rand() < 0.3) {
          const nick = rand() * TAU;
          gaps.push({ start: nick, end: nick + 0.04 + rand() * 0.07 });
        }
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

  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
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
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
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
