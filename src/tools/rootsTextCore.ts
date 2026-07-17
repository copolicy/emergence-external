import { mulberry32 } from "./specimenTreeCore";
import type { RootEdge, RootTier } from "./rootSystemCore";

// Roots Surrounding Text. A cousin of the Root System engine, but instead of
// descending from a bedrock line it grows INWARD from the frame edges and is
// pulled toward a word. The copy is rasterized to a glyph mask; attractors are
// seeded in a halo hugging the letterforms (densest right at the edges), so
// roots creep in from the margins, crowd the text, and wreathe around it. The
// glyphs themselves are obstacles — growth that would land inside a letter (plus
// a clearance band) is deflected or dropped — so the linework weaves around the
// copy and leaves it legible as clean negative space. The word is then drawn on
// top, so it reads as roots embracing the text.

export const TW = 900;
export const TH = 560;
// Light ground, dark linework — black-on-white per the studio's viz aesthetic.
export const INK = "#00280F";
export const BG = "#F8FFEE";

// A brush sets how a growing tip TURNS and how the roots are DRAWN — the same
// brushes the Root System family uses.
//   organic    — free smooth turning, tapered round-capped strokes (+ mycelium).
//   engineered — turns snap to a 45° lattice and roots render as uniform-width,
//                butt-capped traces — technical PCB routing rather than rootstock.
export type RootsTextBrush = "organic" | "engineered";

const BRUSH_SNAP: Record<RootsTextBrush, { q: number; offset: number } | null> = {
  organic: null,
  engineered: { q: Math.PI / 4, offset: 0 },
};

function snapAngle(a: number, s: { q: number; offset: number }) {
  return Math.round((a - s.offset) / s.q) * s.q + s.offset;
}

// Constant trace widths for the engineered brush, keyed by tier — uniform rather
// than tapered, so the network reads as wiring.
const ENGINEERED_W: Record<RootTier, number> = {
  taproot: 1.6,
  lateral: 0.8,
  hair: 0.4,
};

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const FONT_WEIGHT = 800;

// The default sans the copy renders in until the user uploads a font file.
export const DEFAULT_FONT_FAMILY = FONT_FAMILY;
export const DEFAULT_FONT_WEIGHT = FONT_WEIGHT;

// An uploaded @font-face, kept so SVG exports can embed the font and stay
// portable to machines that don't have it installed.
export interface FontFaceSpec {
  family: string; // the css family name we registered the font under
  dataUrl: string; // data:font/...;base64,... source
  format: string; // "truetype" | "opentype" | "woff" | "woff2"
}

// A glyph mask supplied as an image (the user's own SVG of text). Already loaded
// so it can be drawn synchronously when computing.
export interface GlyphImageInput {
  el: CanvasImageSource;
  w: number; // intrinsic width
  h: number; // intrinsic height
  href: string; // data URL, embedded into SVG exports
}

// Everything the engine needs to know about WHAT the roots grow around.
export interface GlyphInput {
  text: string;
  fontFamily?: string; // overrides the default sans
  fontWeight?: number;
  fontFace?: FontFaceSpec | null; // for portable SVG export
  image?: GlyphImageInput | null; // an uploaded SVG/image takes priority over text
}

export interface RootsTextParams {
  seed: number;
  fontSize: number; // glyph cap height in px on the render canvas
  textX: number; // px offset from centred copy
  textY: number;
  sources: number; // origin points spaced around the frame edge
  density: number; // number of attractor points seeded in the halo
  haloReach: number; // px band around the glyphs where attractors cluster
  approachReach: number; // influence radius — how far a tip senses attractors
  clearance: number; // px kept clear around the glyphs (roots won't enter)
  taprootThickness: number; // stroke width of the in-running leader roots
  thickness: number; // base stroke width for finer roots
  taper: number; // width-vs-subtree exponent (lower = sharper taper)
  hairDensity: number; // 0..1 amount of fine root-hair / mycelial fill
}

export const DEFAULT_ROOTS_TEXT: RootsTextParams = {
  seed: 4242,
  fontSize: 168,
  textX: 0,
  textY: 0,
  sources: 5,
  density: 1900,
  haloReach: 92,
  approachReach: 72,
  clearance: 4,
  taprootThickness: 1.4,
  thickness: 0.18,
  taper: 0.32,
  hairDensity: 0.4,
};

export const DEFAULT_TEXT = "emergence";

export const ROOTS_TEXT_RANGES: Record<
  keyof RootsTextParams,
  [number, number, number]
> = {
  seed: [1, 99999, 1],
  fontSize: [48, 300, 1],
  textX: [-450, 450, 1],
  textY: [-280, 280, 1],
  sources: [1, 24, 1],
  density: [400, 6000, 100],
  haloReach: [30, 200, 1],
  approachReach: [30, 140, 1],
  clearance: [0, 20, 1],
  taprootThickness: [0.5, 3, 0.01],
  thickness: [0.1, 1.5, 0.05],
  taper: [0.1, 0.45, 0.01],
  hairDensity: [0, 1, 0.01],
};

export const ROOTS_TEXT_LABELS: Record<keyof RootsTextParams, string> = {
  seed: "Seed",
  fontSize: "Text Size",
  textX: "Text X",
  textY: "Text Y",
  sources: "Sources",
  density: "Density",
  haloReach: "Halo",
  approachReach: "Reach",
  clearance: "Clearance",
  taprootThickness: "Leader",
  thickness: "Line Weight",
  taper: "Taper",
  hairDensity: "Mycelium",
};

export const ROOTS_TEXT_HINTS: Record<keyof RootsTextParams, string> = {
  seed: "Random starting value. Same seed always grows the same system.",
  fontSize: "Size of the copy on the canvas. Larger text leaves less room for roots to weave.",
  textX: "Horizontal position. Drag the canvas or use the slider to move the copy.",
  textY: "Vertical position. Drag the canvas or use the slider to move the copy.",
  sources: "How many points around the frame edge the roots creep in from.",
  density: "How many attractor points are seeded in the halo around the text. More points = busier wreathing.",
  haloReach: "Width of the band around the letters where attractors cluster. Wider pulls roots in from further out.",
  approachReach: "How far a root tip senses attractors. Larger reach makes longer, straighter runs inward.",
  clearance: "How wide a margin is kept clear around the glyphs. Higher values keep roots off the letters; 0 lets them touch.",
  taprootThickness: "Stroke width of the in-running leader roots from each source.",
  thickness: "Base stroke width for finer roots. Branches scale up by how much subtree feeds them.",
  taper: "How sharply roots thin toward the tips. Lower values keep bold leaders and wispy ends.",
  hairDensity: "Amount of fine root-hair / mycelial threads clinging to the roots around the text.",
};

// The only sliders exposed in the UI. Every other param stays at its default.
// "line weight" is the base finer-root stroke width (`thickness`).
export const SLIDER_KEYS_SIMPLE: (keyof RootsTextParams)[] = [
  "seed",
  "density",
  "thickness",
];

export const SLIDER_KEYS_GROW: (keyof RootsTextParams)[] = [
  "seed",
  "sources",
  "density",
  "approachReach",
];
export const SLIDER_KEYS_TEXT: (keyof RootsTextParams)[] = [
  "fontSize",
  "textX",
  "textY",
  "haloReach",
  "clearance",
];
export const SLIDER_KEYS_FORM: (keyof RootsTextParams)[] = [
  "taprootThickness",
  "thickness",
  "taper",
  "hairDensity",
];

interface TextLine {
  text: string;
  x: number; // left edge of the line
  baseline: number; // baseline y
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  fontPx: number;
  family: string;
  weight: number;
}

// What the roots wreathe around, resolved to something both the canvas and the
// SVG exporter can draw: laid-out text lines, or a placed image.
export type GlyphDescriptor =
  | { kind: "text"; layout: TextLayout; fontFace: FontFaceSpec | null }
  | {
      kind: "image";
      el: CanvasImageSource;
      href: string;
      dx: number;
      dy: number;
      dw: number;
      dh: number;
    };

export interface RootsTextResult {
  edges: RootEdge[];
  hairs: RootEdge[];
  glyph: GlyphDescriptor;
}

// Margin kept clear of the frame so the copy never runs off the canvas.
function fitMargin(w: number, h: number) {
  return Math.max(24, Math.min(w, h) * 0.07);
}

// ---- text layout + rasterization ------------------------------------------

// Lay out the copy, AUTO-FITTING it to the canvas: the slider sets the desired
// size, but if the widest line or the stacked block would overflow the frame
// (e.g. after an aspect-ratio change), the whole thing is scaled down to fit.
function layoutText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  fontPx: number,
  family: string,
  weight: number,
  offsetX = 0,
  offsetY = 0,
): TextLayout {
  const raw = (text || "").split("\n");
  const src = raw.length ? raw : [""];
  const m = fitMargin(w, h);

  const measureAt = (px: number) => {
    ctx.font = `${weight} ${px}px ${family}`;
    ctx.textBaseline = "alphabetic";
    let maxW = 0;
    const widths = src.map((t) => {
      const lw = ctx.measureText(t).width;
      if (lw > maxW) maxW = lw;
      return lw;
    });
    return { widths, maxW };
  };

  // Measure once at the requested size, then derive a fit scale. Canvas text
  // width is proportional to font size, so one measurement is enough.
  const base = measureAt(fontPx);
  const lineHeightK = 1.08;
  const totalH = fontPx * lineHeightK * src.length;
  const fitW = base.maxW > 0 ? (w - 2 * m) / base.maxW : 1;
  const fitH = totalH > 0 ? (h - 2 * m) / totalH : 1;
  const scale = Math.min(1, fitW, fitH);
  const finalPx = Math.max(4, fontPx * scale);

  const lineHeight = finalPx * lineHeightK;
  const total = lineHeight * src.length;
  const top = (h - total) / 2;
  const lines: TextLine[] = src.map((t, i) => {
    const width = base.widths[i] * scale;
    return {
      text: t,
      x: (w - width) / 2 + offsetX,
      // alphabetic baseline ~ top + ascent. 0.78 of the em sits above baseline.
      baseline: top + lineHeight * i + finalPx * 0.78 + offsetY,
      width,
    };
  });
  return { lines, fontPx: finalPx, family, weight };
}

// Place an uploaded glyph image: scale so its height is roughly the desired
// font size, then clamp so it always fits inside the frame margins.
function placeImage(
  w: number,
  h: number,
  img: GlyphImageInput,
  desiredPx: number,
  offsetX = 0,
  offsetY = 0,
): { dx: number; dy: number; dw: number; dh: number } {
  const m = fitMargin(w, h);
  const iw = img.w || 1;
  const ih = img.h || 1;
  const byHeight = desiredPx / ih;
  const scale = Math.min(byHeight, (w - 2 * m) / iw, (h - 2 * m) / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  return { dx: (w - dw) / 2 + offsetX, dy: (h - dh) / 2 + offsetY, dw, dh };
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
    let s =
      (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
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

// Rasterize the glyph shapes (via the supplied paint callback) and return a
// per-pixel distance (in px) to the nearest glyph pixel. Used to seed the halo
// of attractors and to keep growth clear of the letterforms.
function buildDistanceField(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Float64Array {
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Float64Array(w * h);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  paint(ctx);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // A tainted canvas (e.g. an SVG referencing external assets) blocks pixel
    // reads — fall back to an empty field so roots simply fill the frame.
    return new Float64Array(w * h).fill(1e6);
  }
  const INF = 1e12;
  const f = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    f[i] = data[i * 4 + 3] > 40 ? 0 : INF; // 0 on glyph, INF elsewhere
  }

  // Columns then rows.
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
    for (let x = 0; x < w; x++) f[y * w + x] = Math.sqrt(rowOut[x]);
  }
  return f; // distance in px to nearest glyph pixel
}

// ---- growth ----------------------------------------------------------------

interface Attractors {
  x: number[];
  y: number[];
}

function haloAttractors(
  w: number,
  h: number,
  dist: Float64Array,
  count: number,
  rng: () => number,
  p: RootsTextParams,
): Attractors {
  const x: number[] = [];
  const y: number[] = [];
  const m = 8;
  let tries = 0;
  const maxTries = count * 60;
  const halo = Math.max(8, p.haloReach);
  const clr = p.clearance;
  while (x.length < count && tries < maxTries) {
    tries++;
    const sx = m + rng() * (w - 2 * m);
    const sy = m + rng() * (h - 2 * m);
    const d = dist[Math.floor(sy) * w + Math.floor(sx)];
    if (d < clr) continue; // inside the letters or too close — skip
    let prob: number;
    if (d <= clr + halo) {
      // Halo band: densest right against the glyph edge, fading outward.
      const t = (d - clr) / halo; // 0 at edge .. 1 at outer rim
      prob = 0.25 + 0.75 * (1 - t) * (1 - t);
    } else {
      // Fill beyond the halo so roots track in from the frame and, at high
      // density, pack the whole field into a busy schematic web.
      prob = 0.18;
    }
    if (rng() < prob) {
      x.push(sx);
      y.push(sy);
    }
  }
  return { x, y };
}

export function growRootsText(
  w: number,
  h: number,
  p: RootsTextParams,
  glyph: GlyphInput | string,
  brush: RootsTextBrush = "organic",
): RootsTextResult {
  // Accept a bare string for convenience (thumbnails, simple callers).
  const g: GlyphInput = typeof glyph === "string" ? { text: glyph } : glyph;
  const rng = mulberry32(p.seed);
  const snap = BRUSH_SNAP[brush];

  // Resolve the glyph source — an uploaded image takes priority over text —
  // into a paint callback (for the mask) and a descriptor (for drawing/export).
  let paint: (ctx: CanvasRenderingContext2D) => void;
  let descriptor: GlyphDescriptor;
  if (g.image) {
    const place = placeImage(w, h, g.image, p.fontSize, p.textX, p.textY);
    const img = g.image;
    paint = (ctx) => ctx.drawImage(img.el, place.dx, place.dy, place.dw, place.dh);
    descriptor = { kind: "image", el: img.el, href: img.href, ...place };
  } else {
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const mctx = off.getContext("2d");
    const family = g.fontFamily || FONT_FAMILY;
    const weight = g.fontWeight ?? FONT_WEIGHT;
    const layout: TextLayout = mctx
      ? layoutText(mctx, w, h, g.text, p.fontSize, family, weight, p.textX, p.textY)
      : { lines: [], fontPx: p.fontSize, family, weight };
    paint = (ctx) => {
      ctx.textBaseline = "alphabetic";
      ctx.font = `${layout.weight} ${layout.fontPx}px ${layout.family}`;
      for (const ln of layout.lines) ctx.fillText(ln.text, ln.x, ln.baseline);
    };
    descriptor = { kind: "text", layout, fontFace: g.fontFace ?? null };
  }

  const dist = buildDistanceField(w, h, paint);
  const distAt = (x: number, y: number) => {
    const ix = x < 0 ? 0 : x >= w ? w - 1 : x | 0;
    const iy = y < 0 ? 0 : y >= h ? h - 1 : y | 0;
    return dist[iy * w + ix];
  };

  const count = Math.max(60, Math.round(p.density));
  const attr = haloAttractors(w, h, dist, count, rng, p);
  const A = attr.x.length;
  if (A === 0) return { edges: [], hairs: [], glyph: descriptor };

  const di = p.approachReach;
  const reach2 = di * di;
  const dk = Math.min(10, di * 0.85);
  const kill2 = dk * dk;
  const D = 6; // growth step length
  const maxIter = 1800;
  const maxNodes = 34000;
  const TAU = Math.PI * 2;
  const noiseW = 0.18;
  const maxTurn = 0.42;
  const clr = p.clearance;

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
    heading.push(
      par >= 0 ? Math.atan2(y - py[par], x - px[par]) : Math.atan2(0, 0),
    );
    const k = keyOf(x, y);
    const bucket = nodeGrid.get(k);
    if (bucket) bucket.push(idx);
    else nodeGrid.set(k, [idx]);
    return idx;
  };

  // Sources sit around the frame perimeter and aim inward (toward centre). A
  // short leader is pre-grown so each source visibly "runs in" before the
  // colonization takes over and the roots find the text.
  const cxC = w / 2;
  const cyC = h / 2;
  const srcCount = Math.max(1, Math.min(p.sources, 24));
  const perim = (t: number): { x: number; y: number } => {
    // Map t in [0,1) around the rectangle perimeter, inset slightly.
    const m = 6;
    const W = w - 2 * m;
    const H = h - 2 * m;
    const L = 2 * (W + H);
    let d = t * L;
    if (d < W) return { x: m + d, y: m };
    d -= W;
    if (d < H) return { x: w - m, y: m + d };
    d -= H;
    if (d < W) return { x: w - m - d, y: h - m };
    d -= W;
    return { x: m, y: h - m - d };
  };

  for (let s = 0; s < srcCount; s++) {
    const t = (s + 0.5) / srcCount + (rng() - 0.5) * (0.5 / srcCount);
    const sp = perim((t % 1 + 1) % 1);
    let hx = sp.x;
    let hy = sp.y;
    let prev = addNode(hx, hy, -1, true);
    // Aim at the text centre with a little jitter.
    let ang = Math.atan2(cyC - hy + (rng() - 0.5) * h * 0.2, cxC - hx + (rng() - 0.5) * w * 0.2);
    const leader = 6 + Math.floor(rng() * 6);
    for (let i = 0; i < leader; i++) {
      ang += (rng() - 0.5) * 0.2;
      // Snapped brushes jog the leader along the lattice as it runs in.
      const a = snap ? snapAngle(ang + (rng() - 0.5) * 0.6, snap) : ang;
      const nx = hx + Math.cos(a) * D;
      const ny = hy + Math.sin(a) * D;
      if (distAt(nx, ny) < clr) break; // ran into the text — stop the leader
      if (nx < 4 || nx > w - 4 || ny < 4 || ny > h - 4) break;
      prev = addNode(nx, ny, prev, true);
      hx = nx;
      hy = ny;
    }
  }

  const alive = new Uint8Array(A).fill(1);
  let remaining = A;

  // Static spatial grid of attractors (they never move), so the kill pass can
  // look up only the attractors near each new node instead of scanning all of
  // them — the difference between feasible and frozen at high density. Kill
  // radius (dk ≤ 10) is always < cell (≥ approachReach), so a 3×3 neighbourhood
  // around a node fully covers it.
  const attrGrid = new Map<number, number[]>();
  for (let a = 0; a < A; a++) {
    const k = keyOf(attr.x[a], attr.y[a]);
    const bucket = attrGrid.get(k);
    if (bucket) bucket.push(a);
    else attrGrid.set(k, [a]);
  }

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
      const na = (fbmless(nx, ny, p.seed) - 0.5) * TAU;
      dx += Math.cos(na) * noiseW;
      dy += Math.sin(na) * noiseW;
      const desired = Math.atan2(dy, dx);

      let a: number;
      if (snap) {
        // Snap to the lattice (with a wobble up to half a cell so laterals
        // stagger into varied diagonal jogs instead of identical spurs).
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

      // Obstacle avoidance: if the step would land inside the glyph clearance
      // band, fan the heading out to either side looking for a way around. If
      // every probe is blocked, skip growth from this node this round — the
      // root has been turned away by the letterform and wraps along its edge.
      // Snapped brushes fan (and re-snap) in whole lattice cells so detours
      // stay on the grid.
      let tx = nx + Math.cos(a) * D;
      let ty = ny + Math.sin(a) * D;
      if (distAt(tx, ty) < clr) {
        let found = false;
        const step = snap ? snap.q : 0.42;
        for (let s2 = 1; s2 <= 5 && !found; s2++) {
          const off2 = s2 * step;
          for (const sgn of [1, -1]) {
            const aa = snap ? snapAngle(a + sgn * off2, snap) : a + sgn * off2;
            const cx2 = nx + Math.cos(aa) * D;
            const cy2 = ny + Math.sin(aa) * D;
            if (distAt(cx2, cy2) >= clr && cx2 > 2 && cx2 < w - 2 && cy2 > 2 && cy2 < h - 2) {
              a = aa;
              tx = cx2;
              ty = cy2;
              found = true;
              break;
            }
          }
        }
        if (!found) return;
      }
      if (tx < 2 || tx > w - 2 || ty < 2 || ty > h - 2) return;
      addNode(tx, ty, nodeIdx);
    });

    for (let n = newFrom; n < px.length; n++) {
      const nxv = px[n];
      const nyv = py[n];
      const cx = Math.floor(nxv / cell) + 1;
      const cy = Math.floor(nyv / cell) + 1;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bucket = attrGrid.get((cy + oy) * cols + (cx + ox));
          if (!bucket) continue;
          for (const a of bucket) {
            if (!alive[a]) continue;
            const dx = attr.x[a] - nxv;
            const dy = attr.y[a] - nyv;
            if (dx * dx + dy * dy < kill2) {
              alive[a] = 0;
              remaining--;
            }
          }
        }
      }
    }
  }

  // Thicken by subtree size (parents precede children, so one high→low pass
  // accumulates). Schedule reveal by path length so roots run in from the
  // sources over time.
  const N = px.length;
  const size = new Float64Array(N).fill(1);
  for (let i = N - 1; i > 0; i--) {
    const par = parent[i];
    if (par >= 0) size[par] += size[i];
  }

  const pathLen = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par >= 0) {
      const dx = px[i] - px[par];
      const dy = py[i] - py[par];
      pathLen[i] = pathLen[par] + Math.hypot(dx, dy);
    }
  }
  let maxPath = 0;
  for (let i = 0; i < N; i++) if (pathLen[i] > maxPath) maxPath = pathLen[i];
  const invMax = maxPath > 0 ? 1 / maxPath : 0;
  const schedRng = mulberry32((p.seed ^ 0x6d2b79f5) >>> 0);

  const edges: RootEdge[] = [];
  for (let i = 0; i < N; i++) {
    const par = parent[i];
    if (par < 0) continue;
    const main = isMain[i];
    const jitterStart = (schedRng() - 0.5) * 0.04;
    const start = Math.max(0, pathLen[par] * invMax + jitterStart);
    const end = Math.min(1, pathLen[i] * invMax + (schedRng()) * 0.05);
    const w2 = main
      ? p.taprootThickness * (1.05 - pathLen[i] * invMax * 0.25)
      : p.thickness * Math.pow(size[i], p.taper);
    edges.push({
      x1: px[par],
      y1: py[par],
      x2: px[i],
      y2: py[i],
      w: w2,
      order: start,
      orderEnd: Math.max(end, start + 1e-3),
      tier: (main ? "taproot" : "lateral") as RootTier,
    });
  }

  // ---- mycelial hair layer -------------------------------------------------
  // Fine threads sprouting from the finer roots, leaning along the root's own
  // heading — texture clinging to the wreath, staying clear of the glyphs.
  const hairs: RootEdge[] = [];
  // Mycelium is an organic-brush concept only; engineered grows no hairs.
  const hairCount = brush === "organic" ? Math.round(p.hairDensity * 320) : 0;
  if (N > srcCount + 2) {
    let placed = 0;
    let hairTries = 0;
    const maxHairTries = hairCount * 8 + 50;
    while (placed < hairCount && hairTries < maxHairTries) {
      hairTries++;
      const j = srcCount + Math.floor(rng() * (N - srcCount));
      if (size[j] > 40 && rng() > 0.25) continue;
      let hx = px[j];
      let hy = py[j];
      placed++;
      let hairT = pathLen[j] * invMax;
      let ang = heading[j] + (rng() - 0.5) * 2.2;
      const segs = 3 + Math.floor(rng() * 5);
      const slen = 3 + rng() * 4;
      for (let s = 0; s < segs; s++) {
        ang += (rng() - 0.5) * 0.7;
        const nxp = hx + Math.cos(ang) * slen;
        const nyp = hy + Math.sin(ang) * slen;
        if (nxp < 4 || nxp > w - 4 || nyp < 4 || nyp > h - 4) break;
        if (distAt(nxp, nyp) < clr) break; // never thread into the letters
        const hStart = Math.min(1, hairT + schedRng() * 0.02);
        hairT = Math.min(1, hStart + 0.01 + schedRng() * 0.02);
        hairs.push({
          x1: hx,
          y1: hy,
          x2: nxp,
          y2: nyp,
          w: 0.35,
          order: hStart,
          orderEnd: hairT,
          tier: "hair",
        });
        hx = nxp;
        hy = nyp;
      }
    }
  }

  return { edges, hairs, glyph: descriptor };
}

// Cheap hashed pseudo-noise for heading wander (avoids importing the full fbm).
function fbmless(x: number, y: number, seed: number): number {
  let h =
    Math.imul(Math.round(x * 0.6), 374761393) +
    Math.imul(Math.round(y * 0.6), 668265263) +
    Math.imul(seed, 2654435761);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

// ---- rendering -------------------------------------------------------------

function strokeRootSegment(
  ctx: CanvasRenderingContext2D,
  e: RootEdge,
  progress: number,
  widthOverride?: number,
) {
  if (progress <= e.order) return;
  let x2 = e.x2;
  let y2 = e.y2;
  const span = e.orderEnd - e.order;
  if (span > 1e-6 && progress < e.orderEnd) {
    const raw = (progress - e.order) / span;
    const t = 1 - (1 - raw) * (1 - raw);
    x2 = e.x1 + (e.x2 - e.x1) * t;
    y2 = e.y1 + (e.y2 - e.y1) * t;
  }
  ctx.lineWidth = widthOverride ?? e.w;
  ctx.beginPath();
  ctx.moveTo(e.x1, e.y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: GlyphDescriptor,
  ink: string,
  alpha: number,
) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (glyph.kind === "image") {
    // An uploaded SVG/image is drawn as-is, on top of the roots.
    ctx.drawImage(glyph.el, glyph.dx, glyph.dy, glyph.dw, glyph.dh);
  } else {
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";
    ctx.font = `${glyph.layout.weight} ${glyph.layout.fontPx}px ${glyph.layout.family}`;
    for (const ln of glyph.layout.lines) ctx.fillText(ln.text, ln.x, ln.baseline);
  }
  ctx.restore();
}

export function drawRootsText(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  result: RootsTextResult,
  ink: string,
  background: string,
  progress = 1,
  brush: RootsTextBrush = "organic",
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }

  const engineered = brush === "engineered";
  // Engineered cuts square butt ends so traces meet cleanly; organic keeps
  // round caps (which also hide the seams between segments).
  ctx.lineCap = engineered ? "butt" : "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.42;
  for (const e of result.hairs)
    strokeRootSegment(ctx, e, progress, engineered ? ENGINEERED_W.hair : undefined);

  ctx.globalAlpha = 1;
  for (const e of result.edges)
    strokeRootSegment(ctx, e, progress, engineered ? ENGINEERED_W[e.tier] : undefined);
  ctx.globalAlpha = 1;

  // The copy emerges as the roots close in — fades up over the last third.
  const textAlpha = Math.max(0, Math.min(1, (progress - 0.6) / 0.4));
  drawGlyph(ctx, result.glyph, ink, textAlpha);
}

export function buildRootsTextSVG(
  w: number,
  h: number,
  result: RootsTextResult,
  ink: string,
  background: string,
  brush: RootsTextBrush = "organic",
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const engineered = brush === "engineered";
  const cap = engineered ? "butt" : "round";
  const parts: string[] = [];
  if (background !== "transparent")
    parts.push(`<rect width="${w}" height="${h}" fill="${background}"/>`);

  parts.push(
    `<g fill="none" stroke="${ink}" stroke-opacity="0.42" stroke-linecap="${cap}" stroke-linejoin="round">`,
  );
  for (const e of result.hairs) {
    parts.push(
      `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke-width="${f(engineered ? ENGINEERED_W.hair : e.w)}"/>`,
    );
  }
  parts.push(`</g>`);

  parts.push(
    `<g fill="none" stroke="${ink}" stroke-linecap="${cap}" stroke-linejoin="round">`,
  );
  for (const e of result.edges) {
    parts.push(
      `<line x1="${f(e.x1)}" y1="${f(e.y1)}" x2="${f(e.x2)}" y2="${f(e.y2)}" stroke-width="${f(engineered ? ENGINEERED_W[e.tier] : e.w)}"/>`,
    );
  }
  parts.push(`</g>`);

  const g = result.glyph;
  let defs = "";
  if (g.kind === "image") {
    // Embed the user's SVG/image as a placed <image>.
    parts.push(
      `<image href="${g.href}" x="${f(g.dx)}" y="${f(g.dy)}" width="${f(g.dw)}" height="${f(g.dh)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  } else {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const L = g.layout;
    // If the copy uses an uploaded font, embed it via @font-face so the export
    // renders the same on any machine.
    if (g.fontFace) {
      defs = `<defs><style>@font-face{font-family:${g.fontFace.family};src:url(${g.fontFace.dataUrl}) format('${g.fontFace.format}');}</style></defs>`;
    }
    parts.push(
      `<g fill="${ink}" font-family='${L.family.replace(/"/g, "&quot;")}' font-weight="${L.weight}" font-size="${f(L.fontPx)}">`,
    );
    for (const ln of L.lines) {
      if (!ln.text) continue;
      parts.push(
        `<text x="${f(ln.x)}" y="${f(ln.baseline)}">${esc(ln.text)}</text>`,
      );
    }
    parts.push(`</g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${parts.join("")}</svg>`;
}

/**
 * Scale a grown result into a larger coordinate space for export — renders the
 * EXACT preview (every line + the copy), just larger, instead of re-growing at
 * the export size (which diverges against the node/iteration caps and drops
 * lines).
 */
export function scaleRootsTextResult(
  r: RootsTextResult,
  s: number,
): RootsTextResult {
  if (s === 1) return r;
  const sc = (e: RootEdge): RootEdge => ({
    ...e,
    x1: e.x1 * s,
    y1: e.y1 * s,
    x2: e.x2 * s,
    y2: e.y2 * s,
    w: e.w * s,
  });
  let glyph: GlyphDescriptor;
  if (r.glyph.kind === "image") {
    glyph = {
      ...r.glyph,
      dx: r.glyph.dx * s,
      dy: r.glyph.dy * s,
      dw: r.glyph.dw * s,
      dh: r.glyph.dh * s,
    };
  } else {
    const L = r.glyph.layout;
    glyph = {
      ...r.glyph,
      layout: {
        ...L,
        fontPx: L.fontPx * s,
        lines: L.lines.map((ln) => ({
          ...ln,
          x: ln.x * s,
          baseline: ln.baseline * s,
          width: ln.width * s,
        })),
      },
    };
  }
  return { edges: r.edges.map(sc), hairs: r.hairs.map(sc), glyph };
}

export function randomRootsTextParams(prev: RootsTextParams): RootsTextParams {
  const rand = mulberry32((prev.seed * 2654435761) >>> 0);
  const pick = (min: number, max: number, step: number) => {
    const steps = Math.floor((max - min) / step);
    return min + Math.round(rand() * steps) * step;
  };
  return {
    ...prev,
    seed: Math.floor(rand() * 99999) + 1,
    density: pick(1400, 2600, 50),
    haloReach: pick(70, 130, 1),
    approachReach: pick(58, 96, 1),
    sources: pick(3, 8, 1),
    taper: pick(0.28, 0.42, 0.01),
  };
}
