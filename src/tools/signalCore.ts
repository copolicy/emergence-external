import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";

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
}

export const DEFAULT_SIGNAL: SignalParams = {
  seed: 62841,
  centers: 4,
  rings: 9,
  spacing: 28,
  lineWidth: 1.15,
  breakiness: 0.32,
  jitter: 0.08,
};

export const SIGNAL_RANGES: Record<
  keyof SignalParams,
  [number, number, number]
> = {
  seed: [1, 99999, 1],
  centers: [1, 8, 1],
  rings: [3, 16, 1],
  spacing: [12, 48, 1],
  lineWidth: [0.3, 2.5, 0.1],
  breakiness: [0, 0.7, 0.02],
  jitter: [0, 0.35, 0.02],
};

export const SIGNAL_LABELS: Record<keyof SignalParams, string> = {
  seed: "Seed",
  centers: "Sources",
  rings: "Rings",
  spacing: "Density",
  lineWidth: "Line Weight",
  breakiness: "Breaks",
  jitter: "Jitter",
};

export const SIGNAL_HINTS: Record<keyof SignalParams, string> = {
  seed: "Random starting value. Same seed always produces the same signal field.",
  centers: "How many transmitters radiate rings.",
  rings: "Concentric rings drawn from each source.",
  spacing: "Gap between successive rings. Lower packs a denser ripple.",
  lineWidth: "Thickness of the signal strokes.",
  breakiness: "Fraction of each ring left open — dashed, interrupted arcs.",
  jitter: "Radial noise that softens perfect circles into organic ripples.",
};

export const SLIDER_KEYS_SIMPLE_SIGNAL: (keyof SignalParams)[] = [
  "seed",
  "spacing",
  "lineWidth",
];

export interface SignalLine {
  pts: number[];
  w: number;
  order: number;
}

/** Place centers with a light rejection sample so they don't stack. */
function placeCenters(
  w: number,
  h: number,
  n: number,
  rand: () => number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const marginX = w * 0.12;
  const marginY = h * 0.1;
  const minDist = Math.min(w, h) * 0.22;
  const minDist2 = minDist * minDist;
  let attempts = 0;
  while (pts.length < n && attempts < n * 80) {
    attempts++;
    const x = marginX + rand() * (w - marginX * 2);
    const y = marginY + rand() * (h - marginY * 2);
    if (pts.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < minDist2)) continue;
    pts.push({ x, y });
  }
  while (pts.length < n) {
    pts.push({
      x: marginX + rand() * (w - marginX * 2),
      y: marginY + rand() * (h - marginY * 2),
    });
  }
  return pts;
}

/**
 * Trace concentric rings as broken polylines. Gaps are seeded per-ring so
 * neighbouring rings don't share the same open sectors.
 */
export function computeSignal(
  w: number,
  h: number,
  p: SignalParams,
): SignalLine[] {
  const rand = mulberry32(p.seed ^ 0xb5f7);
  const centers = placeCenters(w, h, Math.max(1, Math.round(p.centers)), rand);
  const lines: SignalLine[] = [];
  const maxR = Math.hypot(w, h) * 0.72;
  const ringCount = Math.max(1, Math.round(p.rings));
  const step = Math.max(8, p.spacing);

  let order = 0;
  const totalApprox = centers.length * ringCount;

  for (let ci = 0; ci < centers.length; ci++) {
    const c = centers[ci];
    for (let r = 1; r <= ringCount; r++) {
      let radius = r * step;
      if (p.jitter > 0) {
        radius *= 1 + (rand() - 0.5) * 2 * p.jitter;
      }
      if (radius > maxR) break;

      // Decide open sectors for this ring
      const gaps: { start: number; end: number }[] = [];
      if (p.breakiness > 0.01) {
        const gapCount = 2 + Math.floor(rand() * 3);
        for (let g = 0; g < gapCount; g++) {
          const span = (0.15 + rand() * 0.55) * p.breakiness * Math.PI * 2;
          const start = rand() * Math.PI * 2;
          gaps.push({ start, end: start + span });
        }
      }

      const inGap = (a: number) => {
        const ang = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        return gaps.some((g) => {
          const s = ((g.start % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          const e = s + (g.end - g.start);
          if (ang >= s && ang <= e) return true;
          if (e > Math.PI * 2 && ang <= e - Math.PI * 2) return true;
          return false;
        });
      };

      // Sample the circle; split into arc segments where gaps open
      const samples = Math.max(48, Math.round((radius * Math.PI * 2) / 6));
      let current: number[] = [];
      const flush = () => {
        if (current.length >= 4) {
          lines.push({
            pts: current,
            w: p.lineWidth,
            order: order / Math.max(1, totalApprox),
          });
        }
        current = [];
      };

      for (let i = 0; i <= samples; i++) {
        const a = (i / samples) * Math.PI * 2;
        if (inGap(a)) {
          flush();
          continue;
        }
        // Subtle radial ripple along the arc
        const ripple =
          p.jitter > 0
            ? 1 + Math.sin(a * (3 + ci) + r) * p.jitter * 0.35
            : 1;
        const rr = radius * ripple;
        current.push(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
      }
      flush();
      order++;
    }
  }

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
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.strokeStyle = ink;
  ctx.lineCap = fade ? "round" : "butt";
  ctx.lineJoin = "round";

  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed, start: 0.62 }) : null;
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
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const fieldFade = fade
    ? makeFade(w, h, { seed: fadeSeed, start: 0.62 })
    : null;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="${background}"/>`,
    `<g fill="none" stroke="${ink}" stroke-linecap="${fade ? "round" : "butt"}" stroke-linejoin="round">`,
  ];
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
