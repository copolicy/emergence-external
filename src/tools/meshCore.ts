import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";

// FinTech — a rectangular mesh warped by domain noise. Reads like a flexible
// data grid draped over an invisible surface: denser than a street map, softer
// than engineered jag facets.
export const MW = 680;
export const MH = 580;
export const INK = "#C0B663"; // Gold — matches FinTech vertical card
export const BG = "#F5F5F2"; // Cream

export interface MeshParams {
  seed: number;
  spacing: number; // grid cell size in px
  warp: number; // displacement amplitude × cell size
  fieldScale: number; // noise feature size — cells across long edge
  lineWidth: number;
  jitter: number; // 0..1 node scatter before warping
}

export const DEFAULT_MESH: MeshParams = {
  seed: 41762,
  spacing: 18,
  warp: 1.35,
  fieldScale: 3.5,
  lineWidth: 1,
  jitter: 0.12,
};

export const MESH_RANGES: Record<keyof MeshParams, [number, number, number]> = {
  seed: [1, 99999, 1],
  spacing: [8, 40, 1],
  warp: [0, 2.5, 0.05],
  fieldScale: [1.5, 10, 0.5],
  lineWidth: [0.3, 2.5, 0.1],
  jitter: [0, 0.5, 0.02],
};

export const MESH_LABELS: Record<keyof MeshParams, string> = {
  seed: "Seed",
  spacing: "Density",
  warp: "Warp",
  fieldScale: "Field Scale",
  lineWidth: "Line Weight",
  jitter: "Jitter",
};

export const MESH_HINTS: Record<keyof MeshParams, string> = {
  seed: "Random starting value. Same seed always produces the same mesh.",
  spacing: "Grid cell size. Lower values pack a denser net.",
  warp: "How far nodes drift from the rectilinear lattice.",
  fieldScale: "Size of the warp waves. Lower values make broad drapes; higher packs tighter ripples.",
  lineWidth: "Thickness of the mesh strokes.",
  jitter: "Scatter applied to nodes before warping — softens the lattice.",
};

export const SLIDER_KEYS_SIMPLE_MESH: (keyof MeshParams)[] = [
  "seed",
  "spacing",
  "lineWidth",
];

export interface MeshLine {
  pts: number[];
  w: number;
  order: number;
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

/** Build a warped lattice: horizontal + vertical polylines through displaced nodes. */
export function computeMesh(w: number, h: number, p: MeshParams): MeshLine[] {
  const cell = Math.max(6, p.spacing);
  const cols = Math.ceil(w / cell) + 2;
  const rows = Math.ceil(h / cell) + 2;
  const noiseCell = Math.max(w, h) / Math.max(1.5, p.fieldScale);
  const amp = p.warp * cell;
  const rand = mulberry32(p.seed ^ 0x51ed);

  const xs = new Float64Array(cols * rows);
  const ys = new Float64Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let x = (c - 0.5) * cell;
      let y = (r - 0.5) * cell;
      if (p.jitter > 0) {
        x += (rand() - 0.5) * cell * p.jitter;
        y += (rand() - 0.5) * cell * p.jitter;
      }
      const nx = x / noiseCell;
      const ny = y / noiseCell;
      const dx =
        (fbm(nx, ny, p.seed, 3) - 0.5) * 2 * amp +
        (fbm(nx * 0.55 + 19, ny * 0.55, p.seed ^ 0xa341, 2) - 0.5) * amp * 0.55;
      const dy =
        (fbm(nx + 41, ny + 17, p.seed ^ 0xc801, 3) - 0.5) * 2 * amp +
        (fbm(nx * 0.55, ny * 0.55 + 7, p.seed ^ 0x9e37, 2) - 0.5) * amp * 0.55;
      xs[i] = x + dx;
      ys[i] = y + dy;
    }
  }

  const lines: MeshLine[] = [];
  const pushLine = (pts: number[], order: number) => {
    if (pts.length < 4) return;
    lines.push({ pts, w: p.lineWidth, order });
  };

  // Horizontal runs
  for (let r = 0; r < rows; r++) {
    const pts: number[] = [];
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      pts.push(xs[i], ys[i]);
    }
    pushLine(pts, r / Math.max(1, rows - 1) * 0.5);
  }

  // Vertical runs
  for (let c = 0; c < cols; c++) {
    const pts: number[] = [];
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c;
      pts.push(xs[i], ys[i]);
    }
    pushLine(pts, 0.5 + (c / Math.max(1, cols - 1)) * 0.5);
  }

  return lines;
}

export function drawMesh(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  lines: MeshLine[],
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

export function buildMeshSVG(
  w: number,
  h: number,
  lines: MeshLine[],
  ink: string,
  background: string,
  fade = false,
  fadeSeed = 1,
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
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
