import { growthAlpha } from "../hooks/useCanvasRecorder";
import { mulberry32 } from "./specimenTreeCore";
import { sampleLuminance, toneAt, type LumBuffer } from "./flowFieldCore";
import {
  drawStamped,
  drawStampedReveal,
  stampActive,
  stampRevealPad,
  traceStampPathD,
  type StampOpts,
} from "./stampTreatment";

// The ink-stamp/cutout treatment lives in stampTreatment.ts, shared with the
// field tools so the whole family carries the same treated ink.
export type { StampOpts } from "./stampTreatment";

// Generative canvas size — portrait, to read as depth/foundation rather than
// the landscape circulation of Vascular.
export const RW = 640;
export const RH = 700;
// Default palette: text-green linework on cream, the same ground the field
// generators reversed out to.
export const INK = "#0F3214"; // Text green
export const BG = "#F8F5EC"; // Cream

/**
 * Root system. A descendant of the Vascular space-colonization engine, inverted
 * to grow DOWNWARD from a fixed bedrock line — the shared foundation everything
 * descends from. Crowns sit on the bedrock datum; each sends a dominant taproot
 * down through the soil, with lateral roots colonizing territory below, and a
 * faint mycelial hair layer threading the negative space. Where Vascular reads
 * as circulation (veins, deltas) flowing across the frame, Root System reads as
 * rootstock anchored to common ground. Optional image input clusters roots in
 * the dark areas of a picture (below the bedrock line).
 */
export interface RootParams {
  seed: number;
  crowns: number; // seed points along the bedrock line
  density: number; // number of attractor points in the soil
  downwardBias: number; // 0..1 gravity pull — deeper taproots vs wider spread
  lateralReach: number; // influence radius — how far a root tip senses attractors
  taprootThickness: number; // stroke width of the main descending taproot
  thickness: number; // base stroke width for lateral roots
  taper: number; // width-vs-subtree exponent (lower = sharper taper)
  coil: number; // 0..1 how much each root end coils into a tendril curl
  endThickness: number; // engineered: ×base width the trace ends fatten to
  stamp: number; // 0..1 organic ink-stamp fatten/smooth pass (0 = off)
  cutout: number; // 0..1 organic cutout break/simplify pass (0 = off)
  hairDensity: number; // 0..1 amount of fine root-hair / mycelial fill
  bedrockOffset: number; // 0..0.4 where the bedrock datum sits from the top
  // image
  threshold: number; // 0..1 ignore areas lighter than this
  contrast: number; // tone curve exponent
}

export const DEFAULT_ROOT: RootParams = {
  seed: 38928,
  crowns: 1,
  density: 1350,
  downwardBias: 0.35,
  lateralReach: 42,
  taprootThickness: 1.5,
  thickness: 0.15,
  // Gentle end shaping and moderate tendril curl.
  taper: 0.14,
  coil: 0.25,
  endThickness: 2.6,
  // Ink treatment values matched against the handoff PSD reference. Locked
  // in (no UI sliders for now) — the treatment always runs at these.
  stamp: 0.34,
  cutout: 0.34,
  // Root Brush's organic mode is clean linework — no mycelial hair layer.
  // (The Health tool keeps its own mycelium via a separate default.)
  hairDensity: 0,
  bedrockOffset: 0,
  threshold: 0.08,
  contrast: 1.2,
};

export const ROOT_RANGES: Record<keyof RootParams, [number, number, number]> = {
  seed: [1, 99999, 1],
  crowns: [1, 8, 1],
  density: [200, 3000, 50],
  downwardBias: [0, 1, 0.01],
  lateralReach: [20, 120, 1],
  taprootThickness: [0.1, 3, 0.01],
  thickness: [0.1, 0.25, 0.01],
  taper: [-0.5, 0.5, 0.01],
  coil: [0, 1, 0.01],
  endThickness: [0.5, 8, 0.1],
  stamp: [0, 0.45, 0.01],
  // Floored rather than run down to zero, so the pass is always on and the slider
  // spans how heavily it breaks the ink rather than whether it breaks at all.
  // Ceiling well short of the full erode: the pass eats a fraction of the ink's
  // own half-width, and the top of that range takes linework this thin away
  // altogether rather than nicking it (see CUTOUT_MAX_ERODE in stampTreatment).
  cutout: [0.2, 0.4, 0.01],
  hairDensity: [0, 1, 0.01],
  bedrockOffset: [0, 0.4, 0.01],
  threshold: [0, 0.6, 0.01],
  contrast: [0.3, 3, 0.05],
};

export const ROOT_LABELS: Record<keyof RootParams, string> = {
  seed: "Seed",
  crowns: "Crowns",
  density: "Density",
  downwardBias: "Downward Bias",
  lateralReach: "Lateral Reach",
  taprootThickness: "Main Root",
  thickness: "Line Weight",
  taper: "Taper",
  coil: "Coil",
  endThickness: "End Thickness",
  stamp: "Stamp",
  cutout: "Line Breaks",
  hairDensity: "Mycelium",
  bedrockOffset: "Bedrock",
  threshold: "Threshold",
  contrast: "Contrast",
};

export const ROOT_HINTS: Record<keyof RootParams, string> = {
  seed: "Random starting value. Same seed always grows the same root system.",
  crowns:
    "Number of seed points spaced along the bedrock line, each sending a taproot down. Keep at 1 for a single dominant rootstock.",
  density:
    "How many attractor points the roots grow toward in the soil. More points = finer, busier systems.",
  downwardBias:
    "Gravity pull. High values drive deep, vertical taproots; low values let roots spread sideways into a shallow mat.",
  lateralReach:
    "How far a root tip senses attractors. Larger reach makes longer, straighter runs.",
  taprootThickness:
    "Stroke width of the central descending taproot. Independent of lateral root thickness.",
  thickness:
    "Base stroke width for lateral roots. Branches scale up from here by how much subtree feeds them.",
  taper:
    "Shapes the ends of the roots. Negative wisps them to a fine point; zero keeps a uniform weight; positive swells them into rounded, balled tips.",
  coil: "How much each root end coils into a tendril curl. Zero leaves the ends straight; higher winds a tighter, longer spiral.",
  endThickness:
    "Engineered brush: absolute width of the terminal pad at each trace end, independent of the connecting trace — so thin and thick traces get the same-size end.",
  stamp:
    "Organic brush: ink-stamp fatten pass (à la Photoshop's Stamp filter). Spreads and smooths the linework into solid calligraphic ink, fusing fine clusters. Zero switches it off.",
  cutout:
    "Organic brush: cutout pass (à la Photoshop's Cutout filter). Simplifies the stroke contours and pinches thin spots into organic breaks and dashes — never thickens the line. The slider bottoms out at a light break rather than at none.",
  hairDensity:
    "Amount of fine root-hair / mycelial threads filling the negative space — the hidden web beneath the structural roots.",
  bedrockOffset:
    "Where the bedrock line sits, measured from the top. Everything grows down from this shared datum.",
  threshold:
    "Brightness cutoff. Raise it to keep roots out of the lightest areas of an image.",
  contrast:
    "Tone curve. Above 1 concentrates roots in the shadows of an image.",
};

// The only sliders exposed in the UI. Every other param stays at its default.
// "line weight" is the base lateral stroke width (`thickness`).
export const SLIDER_KEYS_SIMPLE: (keyof RootParams)[] = [
  "seed",
  "density",
  "thickness",
  "cutout",
];

export const SLIDER_KEYS_GROW: (keyof RootParams)[] = [
  "seed",
  "crowns",
  "density",
  "downwardBias",
  "lateralReach",
];

export const SLIDER_KEYS_ROOT: (keyof RootParams)[] = [
  "taprootThickness",
  "thickness",
  "taper",
  "coil",
  "endThickness",
  "hairDensity",
  "bedrockOffset",
];

export const SLIDER_KEYS_IMAGE: (keyof RootParams)[] = [
  "threshold",
  "contrast",
];

export type RootTier = "taproot" | "lateral" | "hair";

// A brush is two coupled decisions: how a growing tip TURNS, and how the
// finished roots are DRAWN.
//   organic    — free turning (the original Root System): roots curve smoothly
//                along the noise field and render as tapered round-capped strokes.
//   engineered — turns snap to a 45° lattice (PCB routing) and roots render as
//                uniform-width traces — technical, almost circuitry rather than
//                rootstock.
export type RootBrush = "organic" | "engineered";

// Lattice each brush snaps growth headings to. `q` is the angular quantum;
// `offset` rotates the lattice so straight-down (+y, π/2) stays on it — that
// keeps the dominant taproot vertical and only the breaks land on the grid.
const BRUSH_SNAP: Record<RootBrush, { q: number; offset: number } | null> = {
  organic: null,
  engineered: { q: Math.PI / 4, offset: 0 },
};

function snapAngle(a: number, s: { q: number; offset: number }) {
  return Math.round((a - s.offset) / s.q) * s.q + s.offset;
}

export interface RootEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  order: number; // 0..1 when this segment starts growing
  orderEnd: number; // 0..1 when this segment finishes
  tier: RootTier;
  soft?: boolean; // render with round cap/join (engineered terminal swell) so the
  // overlapping sub-segments merge seamlessly across corners and width steps
}

export interface RootResult {
  edges: RootEdge[]; // structural roots (taproot + lateral)
  hairs: RootEdge[]; // fine mycelial threads
  bedrockY: number;
}

// ---- coherent noise --------------------------------------------------------
// Smooth value-noise used to (a) steer growth so roots curve along a continuous
// field instead of kinking, and (b) cluster attractors so density varies.

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

function fbm(x: number, y: number, seed: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 911);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---- attractor seeding -----------------------------------------------------

interface Attractors {
  x: number[];
  y: number[];
}

// Soil attractors live BELOW the bedrock line. A vertical weight biases points
// deeper as downwardBias rises, so the system reaches down rather than spreads.
function soilAttractors(
  w: number,
  h: number,
  bedrockY: number,
  count: number,
  rng: () => number,
  p: RootParams,
): Attractors {
  // Match the growth inset (marginB in growRoots) so attractors never sit
  // outside the clamp region density/seed scramble can otherwise pack against.
  const m = 28;
  const x: number[] = [];
  const y: number[] = [];
  const scale = 0.012;
  const top = bedrockY + 6;
  const span = Math.max(1, h - m - top);
  let tries = 0;
  const maxTries = count * 50;
  while (x.length < count && tries < maxTries) {
    tries++;
    const sx = m + rng() * (w - 2 * m);
    // Vertical placement: a power curve pushes points deeper as bias rises.
    const t = rng();
    const depthPow = 1 + p.downwardBias * 1.6; // >1 skews toward the bottom
    const sy = top + Math.pow(t, 1 / depthPow) * span;
    const d = fbm(sx * scale, sy * scale, p.seed);
    if (rng() < 0.15 + 0.85 * d * d) {
      x.push(sx);
      y.push(sy);
    }
  }
  return { x, y };
}

function imageAttractors(
  buf: LumBuffer,
  bedrockY: number,
  p: RootParams,
  count: number,
  rng: () => number,
): Attractors {
  const x: number[] = [];
  const y: number[] = [];
  const m = 28;
  let tries = 0;
  const maxTries = count * 80;
  while (x.length < count && tries < maxTries) {
    tries++;
    const sx = m + rng() * Math.max(1, buf.width - 2 * m);
    const sy = rng() * buf.height;
    if (sy < bedrockY + 6 || sy > buf.height - m) continue; // soil inset only
    const d = toneAt(buf, sx, sy, p);
    if (d < p.threshold) continue;
    if (rng() < d) {
      x.push(sx);
      y.push(sy);
    }
  }
  return { x, y };
}

// ---- avoid mask ------------------------------------------------------------
// An optional area the roots grow AROUND (e.g. an uploaded image). `dist` is a
// per-pixel distance (px, in the w×h growth space) to the nearest masked pixel;
// growth never steps within `clearance` of it, so roots part around the shape
// and leave it as clean negative space.
export interface AvoidMask {
  dist: Float32Array;
  w: number;
  h: number;
  clearance: number;
}

// 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
function edt1d(f: Float64Array, n: number, out: Float64Array) {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}

/**
 * Build a distance field from whatever `paint` draws: any pixel with alpha
 * above ~15% counts as the shape (a photo = its rectangle, a transparent PNG
 * or SVG = its silhouette). Enclosed transparent holes (badge interiors,
 * letter counters, etc.) are filled so roots can't grow inside the shape.
 */
export function buildAvoidDistance(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Float32Array {
  const out = new Float32Array(w * h).fill(1e6);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return out;
  paint(ctx);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return out;
  }
  const n = w * h;
  // Opaque pixels are obstacles. Then flood-fill from the canvas border through
  // transparent pixels: anything left unmarked is an enclosed hole → treat as
  // obstacle too, so a hollow PNG (badge ring, "O") doesn't get roots inside.
  const obs = new Uint8Array(n);
  for (let i = 0; i < n; i++) obs[i] = data[i * 4 + 3] > 40 ? 1 : 0;
  const exterior = new Uint8Array(n);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (i < 0 || i >= n || exterior[i] || obs[i]) return;
    exterior[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + (w - 1));
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x + 1 < w) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i + w < n) seed(i + w);
  }
  for (let i = 0; i < n; i++) {
    if (!exterior[i]) obs[i] = 1;
  }

  const INF = 1e12;
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = obs[i] ? 0 : INF;
  const col = new Float64Array(h);
  const colOut = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = f[y * w + x];
    edt1d(col, h, colOut);
    for (let y = 0; y < h; y++) f[y * w + x] = colOut[y];
  }
  const row = new Float64Array(w);
  const rowOut = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = f[y * w + x];
    edt1d(row, w, rowOut);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(rowOut[x]);
  }
  return out;
}

// ---- growth ----------------------------------------------------------------

export function growRoots(
  w: number,
  h: number,
  p: RootParams,
  buf?: LumBuffer | null,
  brush: RootBrush = "organic",
  avoid?: AvoidMask | null,
): RootResult {
  const rng = mulberry32(p.seed);
  const snap = BRUSH_SNAP[brush];
  // Shorter steps → less angular polylines so the growing tip doesn't read as
  // corner-to-corner stepping. BRANCH is the step the fork rate, lateral
  // spacing, and whisker prune were tuned at, so a finer polyline does not
  // pack more branches along the taproot.
  const D = 3.5;
  const BRANCH = 6;
  const clr = avoid?.clearance ?? 0;
  // Distance to the avoid shape (px). Far away when there's no mask.
  const distAt = (x: number, y: number) => {
    if (!avoid) return 1e6;
    const ix = x < 0 ? 0 : x >= avoid.w ? avoid.w - 1 : (x | 0);
    const iy = y < 0 ? 0 : y >= avoid.h ? avoid.h - 1 : (y | 0);
    return avoid.dist[iy * avoid.w + ix];
  };
  // True inside the shape (plus clearance). `<=` so clearance 0 still keeps
  // the opaque interior — and filled holes — empty.
  const blocked = (x: number, y: number) => distAt(x, y) <= clr;
  // Outward gradient of the distance field (points away from the shape).
  const gradAt = (x: number, y: number) => {
    const e = 2;
    return {
      gx: distAt(x + e, y) - distAt(x - e, y),
      gy: distAt(x, y + e) - distAt(x, y - e),
    };
  };
  /**
   * Pick a free step heading that slides along the avoid shape instead of
   * stopping against it. Uses the distance-field tangent so tips wrap around
   * and keep growing on the far side.
   */
  const steerAround = (
    x: number,
    y: number,
    preferred: number,
    quantize: boolean,
  ): number | null => {
    const ok = (ang: number) =>
      !blocked(x + Math.cos(ang) * D, y + Math.sin(ang) * D);
    if (ok(preferred)) return preferred;

    // Tangents of the distance isocontour (±90° from the outward normal).
    const { gx, gy } = gradAt(x, y);
    const gl = Math.hypot(gx, gy);
    const candidates: number[] = [];
    if (gl > 1e-6) {
      const nx = gx / gl;
      const ny = gy / gl;
      // Prefer the tangent more aligned with the tip's intended heading, so a
      // descending root slides left or right around the obstacle rather than
      // reversing.
      const tA = Math.atan2(nx, -ny); // (-ny, nx)
      const tB = Math.atan2(-nx, ny); // (ny, -nx)
      const score = (t: number) =>
        Math.cos(t) * Math.cos(preferred) + Math.sin(t) * Math.sin(preferred);
      const ordered = score(tA) >= score(tB) ? [tA, tB] : [tB, tA];
      for (const t of ordered) {
        // Slight outward bias keeps the tip from hugging so tight it digs in.
        candidates.push(
          Math.atan2(Math.sin(t) + ny * 0.35, Math.cos(t) + nx * 0.35),
        );
        candidates.push(t);
      }
    }
    // Wide fan around the preferred heading as a fallback (and for flat grads).
    const stepA = quantize && snap ? snap.q : 0.25;
    const first = rng() < 0.5 ? 1 : -1;
    for (let k = 1; k <= 12; k++) {
      for (const sgn of [first, -first]) {
        candidates.push(preferred + sgn * k * stepA);
      }
    }
    for (const raw of candidates) {
      const ang = quantize && snap ? snapAngle(raw, snap) : raw;
      if (ok(ang)) return ang;
    }
    return null;
  };

  const hasImage = !!buf;
  const bedrockY = Math.round((hasImage ? buf!.height : h) * p.bedrockOffset);
  const count = Math.max(50, Math.round(p.density));
  const attr = buf
    ? imageAttractors(buf, bedrockY, p, count, rng)
    : soilAttractors(w, h, bedrockY, count, rng, p);
  if (avoid) {
    // Drop attractors inside the avoid shape so nothing is pulled into it.
    const kx: number[] = [];
    const ky: number[] = [];
    for (let i = 0; i < attr.x.length; i++) {
      if (!blocked(attr.x[i], attr.y[i])) {
        kx.push(attr.x[i]);
        ky.push(attr.y[i]);
      }
    }
    // Halo around the silhouette pulls colonization along the perimeter and
    // past it — without these, tips that bounce off the near edge never get a
    // reason to travel around to the far side.
    const kept = kx.length;
    const haloInner = clr + 6;
    const haloOuter = clr + Math.max(36, Math.min(w, h) * 0.08);
    const haloCount = Math.max(80, Math.round(count * 0.35));
    let tries = 0;
    while (kx.length - kept < haloCount && tries < haloCount * 40) {
      tries++;
      const sx = 8 + rng() * (w - 16);
      const sy = bedrockY + 8 + rng() * Math.max(16, h - bedrockY - 24);
      const d = distAt(sx, sy);
      if (d < haloInner || d > haloOuter) continue;
      kx.push(sx);
      ky.push(sy);
    }
    attr.x = kx;
    attr.y = ky;
  }
  if (attr.x.length === 0) return { edges: [], hairs: [], bedrockY };

  const di = p.lateralReach;
  const dk = Math.min(9, di * 0.9);
  const maxIter = 1400;
  const maxNodes = 26000;

  const TAU = Math.PI * 2;
  // Downward flow bias — the gravity lean of colonized laterals. Tracing an
  // image keeps a softer lean so the picture still reads.
  const flowBias = hasImage ? 0.1 : 0.15 + p.downwardBias * 0.5;
  const noiseScale = 0.006;
  const noiseW = hasImage ? 0 : 0.22;
  const maxTurn = hasImage ? 0.6 : 0.18;

  const px: number[] = [];
  const py: number[] = [];
  const parent: number[] = [];
  const isMain: boolean[] = [];
  const heading: number[] = [];

  const cell = Math.max(8, di);
  const cols = Math.ceil(w / cell) + 2;
  const nodeGrid = new Map<number, number[]>();
  const keyOf = (x: number, y: number) =>
    (Math.floor(y / cell) + 1) * cols + (Math.floor(x / cell) + 1);

  const addNode = (x: number, y: number, par: number, main = false) => {
    const idx = px.length;
    px.push(x);
    py.push(y);
    parent.push(par);
    isMain.push(main);
    // Initial heading points straight down (+y) for crown nodes.
    heading.push(par >= 0 ? Math.atan2(y - py[par], x - px[par]) : Math.PI / 2);
    const k = keyOf(x, y);
    const bucket = nodeGrid.get(k);
    if (bucket) bucket.push(idx);
    else nodeGrid.set(k, [idx]);
    return idx;
  };

  // Crown seeding + forking taproot pre-grow. Crowns sit on the bedrock line.
  // Rather than a single straight column (which reads as one central spine
  // with side branches), each crown descends and periodically SPLITS into two
  // diverging mains — a dichotomous fork — so the skeleton itself bifurcates
  // and laterals attach across several descending roots instead of one line.
  // Low downwardBias forks more freely (a spreading root mass); high bias
  // keeps deeper, taproot-like runs before splitting.
  const crownCount = Math.max(1, Math.min(p.crowns, 8));
  const fieldW = hasImage ? buf!.width : w;
  const fieldH = hasImage ? buf!.height : h;
  const marginB = 28;
  // Deeper taproots as downwardBias rises; always descend a meaningful depth.
  const taprootDepth =
    bedrockY + (fieldH - marginB - bedrockY) * (0.45 + 0.5 * p.downwardBias);
  const steps = Math.max(1, Math.floor((taprootDepth - bedrockY) / D));

  const MAX_MAIN_DEPTH = 3; // generations of forking
  const MAX_MAIN_TIPS = 6; // total descending mains per crown
  // Per growth step. Scaled by D/BRANCH so the chance of a fork per pixel
  // matches the spacing the taproot had at the coarser step.
  const splitChance =
    (0.06 + (1 - p.downwardBias) * 0.12) * (D / BRANCH);
  let mainTips = 0;
  // Spread cone: how far a main may lean off vertical. High downwardBias keeps
  // mains steep; low bias lets the fan splay wide. A fork's divergence becomes
  // each child's PERSISTENT heading — it holds its angle and keeps descending
  // diagonally rather than curling back to straight down.
  const maxDev = 0.5 + (1 - p.downwardBias) * 0.85;
  const devLo = Math.PI / 2 - maxDev;
  const devHi = Math.PI / 2 + maxDev;

  // Grow one main along a persistent heading `dir`; `dv` is a smoothed angular
  // velocity for gentle meander. On a fork the run ends and spawns two children
  // whose headings diverge from this one and stick.
  const growMain = (
    sx: number,
    sy: number,
    sprev: number,
    dir0: number,
    budget: number,
    depth: number,
  ) => {
    let x = sx;
    let y = sy;
    let prev = sprev;
    let dir = dir0;
    let dv = 0;
    let since = 0;
    // While sliding along the guide image, the downward cone is relaxed so the
    // main can travel sideways around it instead of dying against its face.
    let wrapping = false;
    // Same physical gap as 5 coarse steps, so the first fork doesn't land
    // closer to the crown just because each step is shorter.
    const minSeg = Math.max(5, Math.round((5 * BRANCH) / D));
    for (let s = 0; s < budget; s++) {
      since++;
      dv = dv * 0.9 + (rng() - 0.5) * 0.08; // smooth heading drift
      dir += dv;
      const nearAvoid = avoid ? distAt(x, y) < clr + D * 3 : false;
      if (!wrapping && !nearAvoid) {
        // Keep the heading inside the descending spread cone (sin stays > 0).
        if (dir < devLo) {
          dir = devLo;
          dv = Math.abs(dv);
        } else if (dir > devHi) {
          dir = devHi;
          dv = -Math.abs(dv);
        }
      } else if (wrapping || nearAvoid) {
        // Still prefer downward while wrapping, but allow a full sideways swing.
        if (dir < 0.05) {
          dir = 0.05;
          dv = Math.abs(dv);
        } else if (dir > Math.PI - 0.05) {
          dir = Math.PI - 0.05;
          dv = -Math.abs(dv);
        }
      }
      // Snapped brushes quantise the heading to the lattice (with wobble) so
      // mains descend in hard diagonal jogs; organic follows it smoothly.
      let a = snap ? snapAngle(dir + (rng() - 0.5) * 0.6, snap) : dir;
      if (blocked(x + Math.cos(a) * D, y + Math.sin(a) * D)) {
        const steered = steerAround(x, y, a, !!snap);
        if (steered == null) return; // truly boxed in
        a = steered;
        dir = steered;
        dv = 0;
        wrapping = true;
      } else if (wrapping && distAt(x, y) > clr + D * 4) {
        // Clear of the shape — resume the normal downward cone.
        wrapping = false;
        if (dir < devLo) dir = devLo;
        else if (dir > devHi) dir = devHi;
      }
      x += Math.cos(a) * D;
      y += Math.sin(a) * D;
      if (x < marginB) {
        x = marginB;
        dir = Math.PI - dir; // reflect horizontally, keep descending
        dv = 0;
      } else if (x > fieldW - marginB) {
        x = fieldW - marginB;
        dir = Math.PI - dir;
        dv = 0;
      }
      // Don't commit a node that landed inside the shape after side clamping.
      if (blocked(x, y)) return;
      prev = addNode(x, y, prev, true);
      if (
        depth < MAX_MAIN_DEPTH &&
        mainTips < MAX_MAIN_TIPS &&
        since >= minSeg &&
        s < budget - minSeg &&
        rng() < splitChance
      ) {
        mainTips++; // this run ends and two begin: net +1 descending tip
        const remain = budget - s - 1;
        const childBudget = Math.max(
          Math.round((8 * BRANCH) / D),
          Math.floor(remain * (0.7 + rng() * 0.25)),
        );
        const div = 0.4 + rng() * 0.5; // persistent divergence per child
        growMain(x, y, prev, dir - div, childBudget, depth + 1);
        growMain(x, y, prev, dir + div, childBudget, depth + 1);
        return;
      }
    }
  };

  for (let c = 0; c < crownCount; c++) {
    const fx = crownCount === 1 ? 0.5 : (c + 0.5) / crownCount;
    let cx = Math.min(
      fieldW - marginB,
      Math.max(marginB, fieldW * fx + (rng() - 0.5) * fieldW * 0.04),
    );
    // If the guide image covers this crown site, slide sideways onto clear soil
    // so a main doesn't start inside the shape and fill it from within.
    if (blocked(cx, bedrockY)) {
      let found = false;
      for (let d = 8; d < fieldW && !found; d += 8) {
        for (const sgn of [1, -1]) {
          const tx = Math.min(
            fieldW - marginB,
            Math.max(marginB, cx + sgn * d),
          );
          if (!blocked(tx, bedrockY)) {
            cx = tx;
            found = true;
            break;
          }
        }
      }
      if (!found) continue;
    }
    const crown = addNode(cx, bedrockY, -1, true);
    mainTips = 1;
    growMain(cx, bedrockY, crown, Math.PI / 2, steps, 0);
  }

  // Companion attractors strung along every main root so laterals sprout from
  // the taproot skeleton at regular intervals. Without them a main that dives
  // through soil whose attractors were already consumed runs bald and ends in a
  // bare point (with the odd lone stray offshoot). Each is placed downward-and-
  // outward on alternating sides, and far enough out (as a near+far pair) that
  // the lateral it grows clears the whisker-prune length instead of being cut.
  {
    const mainNodes: number[] = [];
    for (let i = 0; i < px.length; i++) {
      if (isMain[i] && parent[i] >= 0) mainNodes.push(i);
    }
    let side = 1;
    // Every ~3 coarse steps along the main, not every 3 fine nodes — otherwise
    // the shorter step sprouts laterals almost twice as close, starting at the
    // crown.
    const lateralStride = Math.max(1, Math.round((3 * BRANCH) / D));
    for (let m = 0; m < mainNodes.length; m += lateralStride) {
      const i = mainNodes[m];
      // Outward from the main's local heading, then leaned downward like a real
      // lateral angling into the soil.
      const base = heading[i] + side * (Math.PI / 2);
      let dx = Math.cos(base);
      let dy = Math.sin(base) + 0.8;
      const L = Math.hypot(dx, dy) || 1;
      dx /= L;
      dy /= L;
      side = -side;
      for (const r of [20 + rng() * 8, 36 + rng() * 12]) {
        const ax = px[i] + dx * r + (rng() - 0.5) * 6;
        const ay = py[i] + dy * r + (rng() - 0.5) * 6;
        if (
          ay <= bedrockY + 4 ||
          ax < marginB ||
          ax > fieldW - marginB ||
          ay > fieldH - marginB ||
          blocked(ax, ay)
        )
          continue;
        attr.x.push(ax);
        attr.y.push(ay);
      }
    }
  }

  const A = attr.x.length;
  const alive = new Uint8Array(A).fill(1);
  let remaining = A;
  const reach2 = di * di;
  const kill2 = dk * dk;

  const nearestNode = (ax: number, ay: number): number => {
    const cx = Math.floor(ax / cell) + 1;
    const cy = Math.floor(ay / cell) + 1;
    let best = -1;
    let bestD = reach2;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = nodeGrid.get((cy + oy) * cols + (cx + ox));
        if (!bucket) continue;
        for (const n of bucket) {
          const dx = ax - px[n];
          const dy = ay - py[n];
          const dd = dx * dx + dy * dy;
          if (dd < bestD) {
            bestD = dd;
            best = n;
          }
        }
      }
    }
    return best;
  };

  for (
    let iter = 0;
    iter < maxIter && remaining > 0 && px.length < maxNodes;
    iter++
  ) {
    const dirX = new Map<number, number>();
    const dirY = new Map<number, number>();

    for (let a = 0; a < A; a++) {
      if (!alive[a]) continue;
      const best = nearestNode(attr.x[a], attr.y[a]);
      if (best < 0) continue;
      let vx = attr.x[a] - px[best];
      let vy = attr.y[a] - py[best];
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      dirX.set(best, (dirX.get(best) ?? 0) + vx);
      dirY.set(best, (dirY.get(best) ?? 0) + vy);
    }

    if (dirX.size === 0) break;

    const newFrom = px.length;
    dirX.forEach((sx, nodeIdx) => {
      if (px.length >= maxNodes) return;
      const sy = dirY.get(nodeIdx) ?? 0;
      const nx = px[nodeIdx];
      const ny = py[nodeIdx];

      const pl = Math.hypot(sx, sy) || 1;
      let dx = sx / pl;
      let dy = sy / pl;
      const na =
        (fbm(nx * noiseScale, ny * noiseScale, p.seed + 7) - 0.5) * TAU;
      dx += Math.cos(na) * noiseW;
      dy += Math.sin(na) * noiseW;
      dy += flowBias; // gravity: bias growth downward (+y)
      const desired = Math.atan2(dy, dx);

      let a: number;
      if (snap) {
        // Snap to the lattice, but wobble the angle by up to half a lattice
        // cell first — the same trick that gives the taproot its jogged
        // descent. Without it, every lateral branching off the vertical trunk
        // is pulled sideways into the same horizontal cell, reading as uniform
        // perpendicular spurs with no randomized growth. The wobble tips
        // near-boundary directions into either neighbouring cell, staggering
        // the laterals into varied diagonal jogs instead.
        a = snapAngle(desired + (rng() - 0.5) * snap.q, snap);
      } else {
        const cur = heading[nodeIdx];
        let diff = desired - cur;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        if (diff > maxTurn) diff = maxTurn;
        else if (diff < -maxTurn) diff = -maxTurn;
        a = cur + diff;
      }
      // Clamp to the soil inset (same margin as taproots): density/seed can
      // pack attractors near the rim, and without side/bottom bounds the walk
      // keeps stepping past the canvas edge. Near the guide image, slide along
      // its edge so laterals wrap around instead of stalling against it.
      if (blocked(nx + Math.cos(a) * D, ny + Math.sin(a) * D)) {
        const steered = steerAround(nx, ny, a, !!snap);
        if (steered == null) return;
        a = steered;
      }
      let nx2 = nx + Math.cos(a) * D;
      let ny2 = Math.max(bedrockY, ny + Math.sin(a) * D);
      if (nx2 < marginB) nx2 = marginB;
      else if (nx2 > fieldW - marginB) nx2 = fieldW - marginB;
      if (ny2 > fieldH - marginB) ny2 = fieldH - marginB;
      if (blocked(nx2, ny2)) return;
      addNode(nx2, ny2, nodeIdx);
    });

    for (let a = 0; a < A; a++) {
      if (!alive[a]) continue;
      for (let n = newFrom; n < px.length; n++) {
        const dx = attr.x[a] - px[n];
        const dy = attr.y[a] - py[n];
        if (dx * dx + dy * dy < kill2) {
          alive[a] = 0;
          remaining--;
          break;
        }
      }
    }
  }

  // Root thickening: subtree size feeds each root's width. Parents are created
  // before children, so a single high→low pass accumulates sizes — the crown
  // node carries the whole system and is thickest at the bedrock.
  const N = px.length;
  const size = new Float64Array(N).fill(1);
  for (let i = N - 1; i > 0; i--) {
    const par = parent[i];
    if (par >= 0) size[par] += size[i];
  }

  // Reveal order — constant distance/sec, branches appearing through the whole
  // duration (not a front-loaded burst then one tendril crawling).
  //
  // Every segment grows at the same speed in px. Main paths start as soon as
  // their parent tip reaches the joint, so the longest tendril runs alongside
  // the mass from early on. Laterals may be delayed past that earliest time so
  // new branches keep starting through the timeline instead of all near t=0.
  const children: number[][] = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par >= 0) children[par].push(i);
  }

  const edgeStart = new Float64Array(N);
  const edgeEnd = new Float64Array(N);
  const schedRng = mulberry32((p.seed ^ 0x6d2b79f5) >>> 0);

  const pathLen = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par >= 0) {
      const dx = px[i] - px[par];
      const dy = py[i] - py[par];
      pathLen[i] = pathLen[par] + Math.hypot(dx, dy);
    }
  }
  const maxPath = pathLen.reduce((m, v) => (v > m ? v : m), 0);
  const invMax = maxPath > 0 ? 1 / maxPath : 0;

  const shuffle = (arr: number[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(schedRng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  // Crown offsets — small stagger so multiple plants don't ignite on one frame,
  // but nothing like the old multi-second waits that caused holds.
  const crownOffset = new Float64Array(N);
  const crownNodes: number[] = [];
  for (let i = 0; i < N; i++) {
    if (parent[i] < 0) crownNodes.push(i);
  }
  shuffle(crownNodes);
  const crownSpread = Math.max(D * 2, maxPath * 0.04);
  for (let ci = 0; ci < crownNodes.length; ci++) {
    const c = crownNodes[ci];
    crownOffset[c] =
      crownNodes.length <= 1
        ? 0
        : (ci / Math.max(1, crownNodes.length - 1)) * crownSpread;
  }
  // Push crown offset down each tree so pathLen-based times stay consistent.
  const rootOf = (i: number) => {
    let n = i;
    while (parent[n] >= 0) n = parent[n];
    return n;
  };

  // Pass 1: geometric schedule — duration === segment length (constant speed).
  const laterals: number[] = [];
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par < 0) continue;
    const len = Math.hypot(px[i] - px[par], py[i] - py[par]);
    const crown = crownOffset[rootOf(i)];
    const earliest = crown + pathLen[par];
    edgeStart[i] = earliest;
    edgeEnd[i] = earliest + Math.max(len, 1e-6);
    if (!isMain[i]) laterals.push(i);
  }

  // Pass 2: spread lateral *starts* across the main growth window so new
  // branches keep appearing while the long tendril is still extending. Never
  // start before the parent tip reaches the joint.
  laterals.sort((a, b) => edgeStart[a] - edgeStart[b] || a - b);
  const spreadUntil = maxPath * 0.88;
  for (let li = 0; li < laterals.length; li++) {
    const k = laterals[li];
    const par = parent[k];
    if (par < 0) continue;
    const len = Math.hypot(px[k] - px[par], py[k] - py[par]);
    const earliest = edgeStart[k];
    const rank =
      laterals.length <= 1 ? 0 : li / Math.max(1, laterals.length - 1);
    // Jitter the slot slightly so siblings don't ignite in lockstep, but keep
    // the spread monotonic enough that the tip count stays steady.
    const slot =
      rank * spreadUntil + (schedRng() - 0.5) * Math.min(D * 3, maxPath * 0.02);
    const start = Math.max(earliest, slot);
    edgeStart[k] = start;
    edgeEnd[k] = start + Math.max(len, 1e-6);
  }

  // Pass 3: enforce parent-before-child on the whole tree (mains + laterals
  // that sprout from delayed laterals). Preserve each segment's duration so
  // speed stays constant.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < N; i++) {
      const parentDone = parent[i] < 0 ? crownOffset[i] : edgeEnd[i];
      for (const k of children[i]) {
        if (edgeStart[k] + 1e-9 >= parentDone) continue;
        const dur = Math.max(1e-6, edgeEnd[k] - edgeStart[k]);
        edgeStart[k] = parentDone;
        edgeEnd[k] = parentDone + dur;
        moved = true;
      }
    }
    if (!moved) break;
  }

  let maxT = 0;
  for (let i = 0; i < N; i++) {
    if (parent[i] >= 0 && edgeEnd[i] > maxT) maxT = edgeEnd[i];
  }

  // ---- prune whiskers ------------------------------------------------------
  // Space colonization leaves short dead-end twigs: a tip chased one nearby
  // attractor, consumed it in a step or two, then stalled with nothing left to
  // reach. Drawn as little round-capped strokes they read as barbs and spurs
  // off the clean roots. Iteratively drop terminal lateral twigs shorter than a
  // few growth steps so only continuous strokes survive. The taproot skeleton
  // (isMain) is never cut.
  const keep = new Uint8Array(N).fill(1);
  const segLen = (i: number) => {
    const par = parent[i];
    return par < 0 ? 0 : Math.hypot(px[i] - px[par], py[i] - py[par]);
  };
  const MIN_TWIG = BRANCH * 6;
  for (let pass = 0; pass < 6; pass++) {
    const live = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const par = parent[i];
      if (keep[i] && par >= 0 && keep[par]) live[par]++;
    }
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (!keep[i] || isMain[i] || live[i] > 0) continue; // live lateral leaves
      // Walk up the single-child chain to its fork (or the trunk), summing the
      // twig length; if it stays under MIN_TWIG the whole chain is a whisker.
      let len = 0;
      let node = i;
      const chain: number[] = [i];
      while (true) {
        const par = parent[node];
        if (par < 0) break;
        len += segLen(node);
        if (isMain[par] || live[par] > 1) break; // fork/trunk — keep it
        chain.push(par);
        node = par;
      }
      if (len < MIN_TWIG) {
        for (const c of chain) keep[c] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Distance from each node down to the far end of its branch (longest kept
  // descendant chain). Leaves are 0; it climbs as you move back toward the
  // trunk. Organic uses this to taper only the last stretch before a tip.
  const tipDist = new Float64Array(N);
  for (let i = N - 1; i > 0; i--) {
    if (!keep[i]) continue;
    const par = parent[i];
    if (par < 0 || !keep[par]) continue;
    const d = tipDist[i] + segLen(i);
    if (d > tipDist[par]) tipDist[par] = d;
  }

  // Organic reads as even hand-drawn linework with a uniform body weight
  // (set by `thickness`); the `taper` slider is BIPOLAR and reshapes only the
  // last stretch before each tip. Negative wisps the ends to a fine point;
  // zero keeps them uniform; positive swells them into rounded, balled tips —
  // the round line cap turns the thicker final segment into a knob. The
  // taproot keeps its own slider and doesn't reshape.
  const taperAmt = p.taper;
  const organicBodyW = p.thickness * 3.2;
  // Width at the very tip, relative to the body. <1 wisps, >1 balls up.
  const organicTipScale =
    taperAmt >= 0 ? 1 + taperAmt * 4 : Math.max(0.05, 1 + taperAmt * 1.9);
  // Length of the wispy taper (negative side only) — a long, gradual point.
  const organicWispLen = 22 + Math.abs(taperAmt) * 90;
  // Balling stays at body weight then swells over just this short end stretch,
  // so a positive taper reads as a rounded knob rather than a long wedge.
  const organicBallLen = 12 + taperAmt * 30;

  // "Line weight" is the single width control exposed in the UI (`thickness`).
  // Laterals track it directly; this factor propagates the same relative change
  // to the otherwise-fixed widths (main taproot, engineered terminal pad) so the
  // slider scales EVERY line evenly rather than just the laterals. The 0.4
  // reference is fixed (not DEFAULT_ROOT.thickness) so retuning the default
  // slider position never changes what a given slider value renders.
  const lineScale = p.thickness / 0.4;

  // Engineered trace base width per tier. The main taproot tracks the `main root`
  // slider (scaled by line weight); laterals track `line weight` directly (×4
  // keeps the default ≈ 0.8).
  const engineeredBaseW = (main: boolean) =>
    main ? p.taprootThickness * lineScale : p.thickness * 4;

  const edges: RootEdge[] = [];
  const nodeW = new Float64Array(N); // final stroke width per node, for curls
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par < 0 || !keep[i]) continue;
    const main = isMain[i];
    const pathFrac = pathLen[i] * invMax;
    let w: number;
    if (brush === "engineered") {
      // Uniform trace width per tier. Lateral traces scale with the `thickness`
      // (lateral thickness) slider so branches other than the main root can be
      // fattened; the main taproot keeps its own constant. Terminals swell via
      // the separate pass below.
      w = engineeredBaseW(main);
    } else if (main) {
      // Taproot stem: slender width scaled by line weight — don't balloon with
      // subtree size.
      w = p.taprootThickness * lineScale * (1.05 - pathFrac * 0.2);
    } else {
      // Organic: even body weight, with the bipolar `taper` reshaping the tip.
      if (taperAmt > 0) {
        // Hold body weight, then swell to a knob concentrated at the very tip.
        // Smoothstep gives a gentle neck where the swell begins and a rounded
        // (not spiked) peak, so the end reads as a smooth ball.
        const u = 1 - Math.min(1, tipDist[i] / organicBallLen); // 0 body → 1 tip
        const e = u * u * (3 - 2 * u);
        w = organicBodyW * (1 + (organicTipScale - 1) * e);
      } else {
        // Wisp: gradual taper to a fine point over a longer stretch.
        const s = Math.min(1, tipDist[i] / organicWispLen);
        w = organicBodyW * (organicTipScale + (1 - organicTipScale) * s);
      }
    }
    nodeW[i] = w;
    edges.push({
      x1: px[par],
      y1: py[par],
      x2: px[i],
      y2: py[i],
      w,
      order: edgeStart[i],
      orderEnd: edgeEnd[i],
      tier: main ? "taproot" : "lateral",
    });
  }

  // ---- terminal curls ------------------------------------------------------
  // Each root end coils into a tendril / calligraphic-flourish spiral that
  // tapers to a fine point, instead of just stopping. The coil continues from
  // the tip's heading, tightens its turn each step (a log-spiral), and shrinks
  // its width from the tip weight down to nothing. Direction and tightness vary
  // per tip (hashed) so they don't all coil identically. Organic brush only.
  // `coil` scales how many segments each end winds through — 0 leaves the ends
  // straight, 1 winds the fullest spiral.
  const baseSegs = Math.round(p.coil * 16);
  if (brush === "organic" && baseSegs >= 2) {
    // Sample the coil at RES× finer resolution than the base segment count, so
    // the tapering point is built from many small width steps (a smooth spindle)
    // instead of a few coarse ones — the same coil shape, just finely subdivided.
    const RES = 4;
    const segs = baseSegs * RES;
    const turnMult = Math.pow(1.12, 1 / RES);
    const keptKids = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const par = parent[i];
      if (keep[i] && par >= 0 && keep[par]) keptKids[par]++;
    }
    for (let i = 0; i < N; i++) {
      if (!keep[i] || parent[i] < 0 || keptKids[i] > 0) continue; // kept tips
      const hsh = hash2(
        Math.round(px[i]),
        Math.round(py[i]),
        (p.seed ^ 0x9e37) >>> 0,
      );
      const dir = hsh < 0.5 ? 1 : -1;
      let x = px[i];
      let y = py[i];
      let ang = heading[i];
      let t = edgeEnd[i];
      let turn = (0.34 + hsh * 0.12) / RES; // per-fine-step turn
      const startW = nodeW[i] || organicBodyW;
      for (let s = 0; s < segs; s++) {
        const frac = s / (segs - 1);
        ang += dir * turn;
        turn *= turnMult; // tighten into a small coil
        const len = (2.4 / RES) * (1 - 0.45 * frac);
        const nx = x + Math.cos(ang) * len;
        const ny = y + Math.sin(ang) * len;
        // Stop the coil at the soil inset so tendrils don't wind off-canvas.
        if (
          nx < marginB ||
          nx > fieldW - marginB ||
          ny < bedrockY ||
          ny > fieldH - marginB ||
          blocked(nx, ny)
        )
          break;
        // Hold full weight through the body, then ease to a point over the last
        // stretch (smoothstep) — a smooth pointed tendril tip, not a stepped one.
        const TIP_POINT = 0.72; // frac after which the coil tapers to a point
        let wf = 1;
        if (frac > TIP_POINT) {
          const u = (frac - TIP_POINT) / (1 - TIP_POINT); // 0 → 1 toward the tip
          wf = 1 - u * u * (3 - 2 * u); // smoothstep down to 0
        }
        const w = Math.max(0.02, startW * wf);
        edges.push({
          x1: x,
          y1: y,
          x2: nx,
          y2: ny,
          w,
          order: t,
          orderEnd: t + len,
          tier: "lateral",
        });
        x = nx;
        y = ny;
        t += len;
      }
    }
  }

  // ---- engineered terminal swell -------------------------------------------
  // Engineered traces fatten toward each end into a thicker terminal — the
  // counterpart of the organic ball. Rather than widening the (few, ~6px) trace
  // segments — which steps coarsely and notches under the butt caps — we
  // overlay a finely-resampled run along the last stretch of the trace whose
  // width ramps up in small increments, so the swell reads as a smooth (but
  // still stepped, in the engineered idiom) taper into a fat tip.
  if (brush === "engineered") {
    const keptKids = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const par = parent[i];
      if (keep[i] && par >= 0 && keep[par]) keptKids[par]++;
    }
    const BALL_LEN = 20; // px of trace that fattens toward the tip
    // Terminal width is ABSOLUTE (px), independent of the connecting trace, so
    // thin and thick traces get the same-size end. Scaled by line weight so it
    // grows in step with every other stroke.
    const END_W = p.endThickness * lineScale;
    const STEP = 2; // fine sub-segment length → many small width steps
    for (let i = 0; i < N; i++) {
      if (!keep[i] || parent[i] < 0 || keptKids[i] > 0) continue; // kept ends
      const base = engineeredBaseW(isMain[i]);
      const ord = edgeEnd[i];
      // Collect the trace points from the tip backward, up to BALL_LEN.
      const poly: number[] = [px[i], py[i]];
      let node = i;
      let back = 0;
      while (parent[node] >= 0 && keep[parent[node]] && back < BALL_LEN) {
        const par = parent[node];
        back += segLen(node);
        poly.push(px[par], py[par]);
        node = par;
      }
      const tier = isMain[i] ? "taproot" : "lateral";
      // Ramp from the trace width (back) to the absolute end width (tip).
      const swellAt = (d: number) => {
        const u = 1 - Math.min(1, d / BALL_LEN); // 0 back → 1 tip
        const e = u * u * (3 - 2 * u);
        return base + (END_W - base) * e;
      };
      // Walk the polyline from the tip. Straight runs are widened with square
      // (butt) sub-segments so the ends and steps stay crisp/engineered; the
      // trace's corner vertices get a small round fill so the turns don't gap.
      let distFromTip = 0;
      for (let pi = 2; pi < poly.length; pi += 2) {
        const x1 = poly[pi - 2];
        const y1 = poly[pi - 1];
        const x2 = poly[pi];
        const y2 = poly[pi + 1];
        const segL = Math.hypot(x2 - x1, y2 - y1) || 1;
        const parts = Math.max(1, Math.ceil(segL / STEP));
        for (let k = 0; k < parts; k++) {
          const t0 = k / parts;
          const t1 = (k + 1) / parts;
          const dMid = distFromTip + segL * ((t0 + t1) / 2);
          const ww = swellAt(dMid);
          if (ww <= base + 0.02) continue; // nothing to add out here
          // Grow with the tip instead of popping in on a held frame.
          // distFromTip=0 at the tip → lands at `ord`; farther back arrives earlier.
          const swellStart = Math.max(0, ord - BALL_LEN * 0.35);
          const span = Math.max(1e-6, ord - swellStart);
          const u0 = 1 - Math.min(1, (distFromTip + segL * t0) / BALL_LEN);
          const u1 = 1 - Math.min(1, (distFromTip + segL * t1) / BALL_LEN);
          edges.push({
            x1: x1 + (x2 - x1) * t0,
            y1: y1 + (y2 - y1) * t0,
            x2: x1 + (x2 - x1) * t1,
            y2: y1 + (y2 - y1) * t1,
            w: ww,
            order: swellStart + span * Math.min(u0, u1),
            orderEnd: swellStart + span * Math.max(u0, u1),
            tier,
          });
        }
        distFromTip += segL;
        // Round fill at this corner vertex so the butt sub-segments on either
        // side of the turn meet seamlessly (only the turns are rounded, not the
        // ends). A zero-length round-capped edge renders as a filled dot.
        const ww = swellAt(distFromTip);
        if (ww > base + 0.02 && pi + 2 < poly.length) {
          const swellStart = Math.max(0, ord - BALL_LEN * 0.35);
          const span = Math.max(1e-6, ord - swellStart);
          const u = 1 - Math.min(1, distFromTip / BALL_LEN);
          const o = swellStart + span * u;
          edges.push({
            x1: x2,
            y1: y2,
            x2: x2,
            y2: y2,
            w: ww,
            order: o,
            orderEnd: o + 1e-4,
            tier,
            soft: true,
          });
        }
      }
    }
  }

  // ---- mycelial hair layer -------------------------------------------------
  // Fine filaments that SPROUT FROM the structural roots — fine root hairs and
  // mycelium clinging to the rootstock, not free-floating debris. Each hair
  // starts at a real root node and threads a short, faint, downward-leaning
  // walk, so the layer reads as texture on the roots rather than stragglers.
  const hairs: RootEdge[] = [];
  const soilTop = bedrockY + 6;
  // Candidate origins: skip the first node of each crown (the heavy taproot
  // head) so hairs emanate from the finer roots, where real root hairs live.
  // Mycelium is an organic-brush concept only; engineered grows no hairs.
  const hairCount = brush === "organic" ? Math.round(p.hairDensity * 360) : 0;
  if (N > crownCount + 2) {
    let placed = 0;
    let hairTries = 0;
    const maxHairTries = hairCount * 8 + 50;
    while (placed < hairCount && hairTries < maxHairTries) {
      hairTries++;
      const j = crownCount + Math.floor(rng() * (N - crownCount));
      if (!keep[j]) continue; // don't sprout hairs off pruned whiskers
      // Favor thinner roots (small subtree) as origins — that's where fine
      // hairs grow; thick trunks stay clean.
      if (size[j] > 40 && rng() > 0.25) continue;
      let hx = px[j];
      let hy = py[j];
      placed++;
      let hairT = edgeEnd[j];
      // Lean off the root's own heading, mostly downward/outward.
      let ang = heading[j] + (rng() - 0.5) * 2.0;
      if (Math.sin(ang) < 0) ang = -ang; // bias the walk downward
      const segs = 3 + Math.floor(rng() * 6);
      const slen = 3 + rng() * 4;
      for (let s = 0; s < segs; s++) {
        ang += (rng() - 0.5) * 0.7;
        const nxp = hx + Math.cos(ang) * slen;
        const nyp = hy + Math.sin(ang) * slen;
        if (
          nyp > fieldH - 4 ||
          nyp < soilTop ||
          nxp < 4 ||
          nxp > fieldW - 4 ||
          blocked(nxp, nyp)
        )
          break;
        // Same constant distance/sec as structural roots — no hold gaps.
        const hStart = hairT;
        hairT = hStart + slen;
        hairs.push({
          x1: hx,
          y1: hy,
          x2: nxp,
          y2: nyp,
          w: 0.35 * lineScale,
          order: hStart,
          orderEnd: hairT,
          tier: "hair",
        });
        hx = nxp;
        hy = nyp;
      }
    }
  }

  for (const e of edges) {
    if (e.orderEnd > maxT) maxT = e.orderEnd; // include terminal curls
  }
  for (const e of hairs) {
    if (e.orderEnd > maxT) maxT = e.orderEnd;
  }

  const invMaxT = maxT > 0 ? 1 / maxT : 1;
  for (const e of edges) {
    e.order *= invMaxT;
    e.orderEnd *= invMaxT;
  }
  for (const e of hairs) {
    e.order *= invMaxT;
    e.orderEnd *= invMaxT;
  }
  stitchTipContinuity(edges);
  stitchTipContinuity(hairs);
  return { edges, hairs, bedrockY };
}

/**
 * Tip chains should meet exactly at their join: parent.orderEnd === child.order.
 * Tiny schedule gaps (from lateral jitter / normalize rounding) read as a tip
 * that stops then restarts. Snap near-continuations so growth stays continuous.
 */
function stitchTipContinuity(edges: RootEdge[]) {
  const key = (x: number, y: number) =>
    `${(x * 4) | 0},${(y * 4) | 0}`;
  const byStart = new Map<string, RootEdge[]>();
  for (const e of edges) {
    if (e.soft) continue;
    const k = key(e.x1, e.y1);
    let list = byStart.get(k);
    if (!list) {
      list = [];
      byStart.set(k, list);
    }
    list.push(e);
  }

  const sorted = edges
    .filter((e) => !e.soft)
    .slice()
    .sort((a, b) => a.order - b.order || a.orderEnd - b.orderEnd);

  for (const a of sorted) {
    const kids = byStart.get(key(a.x2, a.y2));
    if (!kids || kids.length === 0) continue;
    let best: RootEdge | null = null;
    let bestGap = Infinity;
    for (const b of kids) {
      if (b === a) continue;
      const gap = b.order - a.orderEnd;
      // Near-continuations only — not laterals that sprout later along the tip.
      if (gap < -0.002 || gap > 0.02) continue;
      if (Math.abs(gap) < bestGap) {
        bestGap = Math.abs(gap);
        best = b;
      }
    }
    if (!best || bestGap < 1e-6) continue;
    const dur = Math.max(1e-6, best.orderEnd - best.order);
    best.order = a.orderEnd;
    best.orderEnd = Math.min(1, a.orderEnd + dur);
  }
}

function strokeRootSegment(
  ctx: CanvasRenderingContext2D,
  e: RootEdge,
  progress: number,
  widthOverride?: number,
) {
  if (progress <= e.order) return;
  // Canvas IGNORES a non-positive lineWidth and keeps whatever was set last, so
  // a stroke the treatment erases has to be skipped outright — left to fall
  // through it would be drawn at some other stroke's width.
  const width = widthOverride ?? e.w;
  if (!(width > 0)) return;
  let x2 = e.x2;
  let y2 = e.y2;
  const span = e.orderEnd - e.order;
  if (span > 1e-6 && progress < e.orderEnd) {
    // Linear: the tip advances at a constant speed along the segment.
    const t = (progress - e.order) / span;
    x2 = e.x1 + (e.x2 - e.x1) * t;
    y2 = e.y1 + (e.y2 - e.y1) * t;
  }
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(e.x1, e.y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// ---- rendering -------------------------------------------------------------

/** Stroke every root segment onto `ctx` (transform must already be set). */
function paintRootStrokes(
  ctx: CanvasRenderingContext2D,
  result: RootResult,
  ink: string,
  progress: number,
  brush: RootBrush,
  /** Overall ink opacity (growth fade-in/out). */
  fade = 1,
  /** Extra stroke width (reveal masks need to cover stamp fattening). */
  widthPad = 0,
) {
  const engineered = brush === "engineered";
  // Round caps on organic: they overlap to hide the seams between the many
  // little segments. The ends don't read as rounded nubs because the coil
  // tapers to ~0 width at the tip, so the cap there is effectively a point.
  // Engineered keeps butt caps for clean trace ends.
  // Reveal masks always use round caps so the advancing tip stays soft.
  ctx.lineCap = widthPad > 0 || !engineered ? "round" : "butt";
  ctx.lineJoin = "round";

  // Mycelial hairs — faint on screen; full coverage when painting a reveal mask
  // so destination-in doesn't thin the already-treated hair ink.
  ctx.strokeStyle = ink;
  ctx.globalAlpha = widthPad > 0 ? fade : 0.42 * fade;
  for (const e of result.hairs) {
    strokeRootSegment(ctx, e, progress, e.w + widthPad);
  }

  // Structural roots — taproot + laterals. Widths (including the engineered
  // terminal swell) are baked into each edge in growRoots.
  ctx.globalAlpha = fade;
  for (const e of result.edges) {
    if (!e.soft) strokeRootSegment(ctx, e, progress, e.w + widthPad);
  }
  // Soft edges (engineered terminal swell) get round cap/join so the overlapping
  // sub-segments merge seamlessly across corners and width steps.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const e of result.edges) {
    if (e.soft) strokeRootSegment(ctx, e, progress, e.w + widthPad);
  }
  ctx.globalAlpha = 1;
}

export function drawRoots(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  result: RootResult,
  ink: string,
  background: string,
  progress = 1,
  _showBedrock = true,
  brush: RootBrush = "organic",
  stamp?: StampOpts,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }

  // Fade the ink in/out around the growth; leave the canvas background solid.
  const alpha = growthAlpha(progress);
  if (alpha <= 0) return;

  if (brush !== "organic" || !stampActive(stamp)) {
    paintRootStrokes(ctx, result, ink, progress, brush, alpha);
    return;
  }

  // Stamp draws at full opacity into its buffer; fade the composited result.
  ctx.save();
  ctx.globalAlpha = alpha;
  if (progress >= 1) {
    drawStamped(ctx, dpr, w, h, ink, stamp, (tctx) =>
      paintRootStrokes(tctx, result, ink, 1, brush, 1),
    );
  } else {
    // Stamp once for the finished drawing, reveal through a progressing mask.
    // Re-running blur+threshold every frame quantized the tip into steps.
    const pad = stampRevealPad(stamp);
    const e0 = result.edges[0];
    const eN = result.edges[result.edges.length - 1];
    const cacheKey = [
      w,
      h,
      ink,
      stamp.amount,
      stamp.cutout,
      stamp.lineWeight ?? 0,
      result.edges.length,
      result.hairs.length,
      e0 ? `${e0.x1},${e0.y1},${e0.order}` : "0",
      eN ? `${eN.x2},${eN.y2},${eN.orderEnd}` : "0",
    ].join("|");
    drawStampedReveal(
      ctx,
      dpr,
      w,
      h,
      ink,
      stamp,
      cacheKey,
      (tctx) => paintRootStrokes(tctx, result, ink, 1, brush, 1),
      (tctx) => paintRootStrokes(tctx, result, "#000", progress, brush, 1, pad),
    );
  }
  ctx.restore();
}

export function buildRootsSVG(
  w: number,
  h: number,
  result: RootResult,
  ink: string,
  background: string,
  _showBedrock = true,
  brush: RootBrush = "organic",
  stamp?: StampOpts,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const engineered = brush === "engineered";
  // Match the canvas: round caps hide segment seams; engineered uses butt.
  const cap = engineered ? "butt" : "round";
  const parts: string[] = [];
  // Omit the ground rect for a transparent export, so the roots can drop onto
  // any surface; otherwise paint the canvas background.
  if (background !== "transparent")
    parts.push(`<rect width="${w}" height="${h}" fill="${background}"/>`);

  // Ink-stamp treatment: rather than embedding an SVG filter chain (which
  // design tools like Figma and Illustrator ignore, silently dropping the
  // whole treatment), the treated ink is traced into real vector paths — the
  // export is self-contained plain geometry, identical to the canvas.
  if (brush === "organic" && stampActive(stamp)) {
    const d = traceStampPathD(w, h, ink, stamp, (tctx) =>
      paintRootStrokes(tctx, result, ink, 1, brush),
    );
    parts.push(`<path d="${d}" fill="${ink}" fill-rule="evenodd"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  }

  // Mycelium group — faint hairs.
  parts.push(
    `<g fill="none" stroke="${ink}" stroke-opacity="0.42" stroke-linecap="${cap}" stroke-linejoin="round">`,
  );
  for (const e of result.hairs) {
    parts.push(
      `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke-width="${f(e.w)}"/>`,
    );
  }
  parts.push(`</g>`);

  // Structural roots group.
  parts.push(
    `<g fill="none" stroke="${ink}" stroke-linecap="${cap}" stroke-linejoin="round">`,
  );
  for (const e of result.edges) {
    if (e.soft) continue;
    parts.push(
      `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke-width="${f(e.w)}"/>`,
    );
  }
  parts.push(`</g>`);

  // Soft edges (engineered terminal swell) — round caps so they merge seamlessly.
  const soft = result.edges.filter((e) => e.soft);
  if (soft.length) {
    parts.push(
      `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const e of soft) {
      parts.push(
        `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke-width="${f(e.w)}"/>`,
      );
    }
    parts.push(`</g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

/**
 * Scale a grown result into a larger coordinate space. Used for export: rather
 * than re-growing at the export resolution (which diverges and truncates against
 * the node/iteration caps, dropping lines), we render the EXACT preview result
 * scaled up — so the export is what-you-see, every line included.
 */
export function scaleRootResult(r: RootResult, s: number): RootResult {
  if (s === 1) return r;
  const sc = (e: RootEdge): RootEdge => ({
    ...e,
    x1: e.x1 * s,
    y1: e.y1 * s,
    x2: e.x2 * s,
    y2: e.y2 * s,
    w: e.w * s,
  });
  return {
    edges: r.edges.map(sc),
    hairs: r.hairs.map(sc),
    bedrockY: r.bedrockY * s,
  };
}

export function randomRootParams(prev: RootParams): RootParams {
  const rand = mulberry32((prev.seed * 2654435761) >>> 0);
  const pick = (min: number, max: number, step: number) => {
    const steps = Math.floor((max - min) / step);
    return min + Math.round(rand() * steps) * step;
  };
  return {
    ...prev,
    // Keep crowns / bedrock untouched so regenerating reshapes the same
    // foundation rather than relocating it.
    seed: Math.floor(rand() * 99999) + 1,
    density: pick(1000, 1900, 50),
    downwardBias: pick(0.35, 0.8, 0.01),
    lateralReach: pick(58, 92, 1),
    taper: pick(-0.2, 0.3, 0.01),
  };
}

export { sampleLuminance };
