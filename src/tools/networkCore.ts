import { Delaunay } from "d3-delaunay";
import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";
import {
  drawStamped,
  stampActive,
  traceStampPathD,
  type StampOpts,
} from "./stampTreatment";

// Education — a low-poly knowledge mesh: an evenly spread Delaunay
// triangulation across the full field, inked at a single edge weight with
// pooled dots at the vertices. Abnormally long hull edges
// are pruned so the boundary frays instead of closing into a clean polygon, and
// the mesh thins out toward the bottom rather than stopping at a line.
export const NW = 680;
export const NH = 580;
export const INK = "#00280F"; // Dark green
export const BG = "#F5F5F2"; // Cream

export interface NetworkParams {
  seed: number;
  nodes: number;
  linkDist: number; // edge-prune factor — how much longer than local spacing an edge may be
  lineWidth: number;
  nodeSize: number; // filled dot radius (0 = lines only)
  taper: number; // 0..1 how high up the field starts thinning toward the bottom
  emphasis: number; // 0..1 share of vertices whose dots pool heavier
  // ink treatment — the same stamp/cutout render pass the Root Brush runs
  stamp: number; // 0..1 ink-stamp fatten/smooth pass (0 = off)
  cutout: number; // 0..1 cutout break/simplify pass (0 = off)
}

export const DEFAULT_NETWORK: NetworkParams = {
  seed: 33917,
  nodes: 76,
  linkDist: 1.9,
  // Hairline edges, fattened back up by the stamp pass below. The treatment's
  // radii scale with the line weight, so this ratio — not the raw stroke — is
  // what keeps Line Breaks nicking the ink instead of eroding it away.
  lineWidth: 0.6,
  nodeSize: 3.2,
  taper: 0.62,
  emphasis: 0.22,
  // Same treatment defaults as the Root Brush / vertical-card references.
  stamp: 0.34,
  cutout: 0.34,
};

export const NETWORK_RANGES: Record<
  keyof NetworkParams,
  [number, number, number]
> = {
  seed: [1, 99999, 1],
  nodes: [24, 220, 1],
  linkDist: [1.2, 3, 0.05],
  lineWidth: [0.3, 2.5, 0.01],
  nodeSize: [0, 6, 0.1],
  taper: [0.2, 1, 0.02],
  emphasis: [0, 0.6, 0.02],
  stamp: [0, 0.45, 0.01],
  cutout: [0, 1, 0.01],
};

export const NETWORK_LABELS: Record<keyof NetworkParams, string> = {
  seed: "Seed",
  nodes: "Density",
  linkDist: "Reach",
  lineWidth: "Line Weight",
  nodeSize: "Nodes",
  taper: "Taper",
  emphasis: "Hubs",
  stamp: "Stamp",
  cutout: "Line Breaks",
};

export const NETWORK_HINTS: Record<keyof NetworkParams, string> = {
  seed: "Random starting value. Same seed always produces the same network.",
  nodes: "How many points are scattered into the field — more points, finer triangles.",
  linkDist:
    "How much longer than its neighbours an edge may be before it's cut. Lower values fray the boundary into a raggeder outline.",
  lineWidth: "Thickness of the connecting strokes.",
  nodeSize: "Radius of the inked dots at each vertex. Zero hides nodes.",
  taper:
    "Where the mesh starts thinning toward the bottom. Higher values hold full density further down, leaving a shallower band of stragglers.",
  emphasis:
    "Share of vertices whose dots pool heavier than the rest. Edge weight is uniform, so the emphasis reads as heavier ink at the junctions rather than thicker strokes.",
  stamp:
    "Ink-stamp fatten pass (à la Photoshop's Stamp filter). Spreads and smooths the linework into solid calligraphic ink, fusing fine clusters. Zero switches it off.",
  cutout:
    "Cutout pass (à la Photoshop's Cutout filter). Simplifies the stroke contours and pinches thin spots into organic breaks and dashes — never thickens the line. Zero switches it off.",
};

export const SLIDER_KEYS_SIMPLE_NETWORK: (keyof NetworkParams)[] = [
  "seed",
  "nodes",
  "lineWidth",
  "nodeSize",
  "emphasis",
  "taper",
  "stamp",
  "cutout",
];

export interface NetworkLine {
  pts: number[];
  w: number;
  order: number;
}

export interface NetworkNode {
  x: number;
  y: number;
  /** Dot radius — hubs pool heavier than plain vertices. */
  r: number;
}

export interface NetworkResult {
  lines: NetworkLine[];
  nodes: NetworkNode[];
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

/**
 * Density field: even across the full width, easing off below the taper line so
 * the mesh runs out into stragglers near the bottom instead of ending on a
 * straight edge. Noise roughens that falloff so the boundary reads as drawn.
 */
function meshDensity(
  x: number,
  y: number,
  h: number,
  taper: number,
  seed: number,
): number {
  const yn = y / h;
  if (yn <= taper) return 1;
  let t = (yn - taper) / Math.max(0.02, 1 - taper);
  // Hard floor near the bottom — a clear band of cream, no lone stragglers
  // hugging the frame edge.
  if (t > 0.7) return 0;

  // Gentle noise roughens the falloff without tearing holes in the mass.
  const n = valueNoise(x * 0.01 + seed * 0.01, y * 0.01 - seed * 0.01, seed);
  const n2 = valueNoise(
    x * 0.026 - seed * 0.02,
    y * 0.026 + seed * 0.02,
    seed ^ 0x9e37,
  );
  t *= 1 + (n - 0.5) * 0.34 + (n2 - 0.5) * 0.2;

  return Math.max(0, Math.min(1, 1 - t));
}

/** Poisson-ish scatter — near-even spacing, loosening through the taper band. */
function scatterNodes(
  w: number,
  h: number,
  count: number,
  taper: number,
  seed: number,
  rand: () => number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number; spacing: number }[] = [];
  // Overscan: nodes land past the frame on the left, right and top so the mesh
  // is cropped by the canvas rather than closing into a shape inside it.
  const over = Math.min(w, h) * 0.09;
  const baseSpacing = Math.sqrt((w * h) / (count * 1.5));
  let attempts = 0;
  const maxAttempts = count * 220;

  while (pts.length < count && attempts < maxAttempts) {
    attempts++;
    const x = -over + rand() * (w + over * 2);
    const y = -over + rand() * (h + over);
    const density = meshDensity(x, y, h, taper, seed);
    // Reject sparsely down in the taper band; the odd straggler that gets
    // through is what strands the isolated triangles along the bottom.
    if (rand() > Math.pow(density, 1.4)) continue;
    const spacing = baseSpacing * (0.95 + 0.9 * (1 - density));
    const spacing2 = spacing * spacing;
    let ok = true;
    for (const q of pts) {
      const md2 = Math.min(spacing2, q.spacing * q.spacing);
      if ((q.x - x) ** 2 + (q.y - y) ** 2 < md2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pts.push({ x, y, spacing });
  }

  return pts.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Delaunay-triangulate the scattered nodes, then prune edges that are
 * abnormally long relative to each point's local spacing. This trims the
 * outer hull down to a ragged, hand-broken boundary instead of a clean
 * polygon, while leaving a few short isolated shapes stranded at the edge.
 */
export function computeNetwork(
  w: number,
  h: number,
  p: NetworkParams,
): NetworkResult {
  const rand = mulberry32(p.seed ^ 0xc0de);
  const scattered = scatterNodes(
    w,
    h,
    Math.max(4, Math.round(p.nodes)),
    p.taper,
    p.seed,
    rand,
  );

  // Hubs: the vertices whose dots pool heavier than the rest.
  const hub = scattered.map(() => rand() < p.emphasis);
  const nodes: NetworkNode[] = scattered.map((n, i) => ({
    x: n.x,
    y: n.y,
    r: p.nodeSize * (hub[i] ? 1.35 : 0.8 + rand() * 0.4),
  }));

  if (nodes.length < 3) return { lines: [], nodes };

  const coords = new Float64Array(nodes.length * 2);
  nodes.forEach((n, i) => {
    coords[i * 2] = n.x;
    coords[i * 2 + 1] = n.y;
  });
  const delaunay = new Delaunay(coords);

  // Local spacing per point — shortest incident triangulation edge.
  const nn = new Float64Array(nodes.length).fill(Infinity);
  const { triangles } = delaunay;
  const edgeSet = new Set<string>();
  const rawEdges: [number, number, number][] = []; // a, b, length

  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (let t = 0; t < triangles.length; t += 3) {
    const tri = [triangles[t], triangles[t + 1], triangles[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const key = edgeKey(a, b);
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      const len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
      rawEdges.push([a, b, len]);
      if (len < nn[a]) nn[a] = len;
      if (len < nn[b]) nn[b] = len;
    }
  }

  const factor = p.linkDist;

  const lines: NetworkLine[] = [];
  for (const [a, b, len] of rawEdges) {
    const local = Math.min(nn[a], nn[b]);
    if (!Number.isFinite(local)) continue;
    if (len > local * factor) continue;
    const my = (nodes[a].y + nodes[b].y) * 0.5;
    // Growth runs top-down, the same direction the mesh thins.
    const order = Math.min(1, Math.max(0, my / h));
    lines.push({
      pts: [nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y],
      // Every edge inks at one weight — the mesh reads as a single drawn
      // lattice, and what variation there is comes from the ink treatment.
      w: p.lineWidth,
      order,
    });
  }

  return { lines, nodes };
}

export function drawNetwork(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  result: NetworkResult,
  p: NetworkParams,
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
      paintNetwork(tctx, w, h, result, p, ink, progress, fade, fadeSeed),
    );
    return;
  }
  paintNetwork(ctx, w, h, result, p, ink, progress, fade, fadeSeed);
}

/** Stroke edges + fill nodes onto `ctx` (transform must already be set). */
function paintNetwork(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  result: NetworkResult,
  p: NetworkParams,
  ink: string,
  progress: number,
  fade: boolean,
  fadeSeed: number,
) {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = fade ? "round" : "butt";
  ctx.lineJoin = "round";

  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
  const SPREAD = 0.6;
  const denom = 1 - SPREAD;

  let lineId = 0;
  for (const line of result.lines) {
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
    const t = Math.min(1, Math.max(0, local));
    const pts = line.pts;
    if (pts.length < 4) continue;
    const ax = pts[0];
    const ay = pts[1];
    const bx = pts[2];
    const by = pts[3];
    const draw = [ax, ay, ax + (bx - ax) * t, ay + (by - ay) * t];
    strokeFaded(ctx, draw, line.w, fadeOpts);
  }

  // Nodes reveal after their incident edges start growing
  if (p.nodeSize > 0.05 && progress > 0.15) {
    const nodeProgress = Math.min(1, (progress - 0.15) / 0.85);
    for (let i = 0; i < result.nodes.length; i++) {
      const n = result.nodes[i];
      if (fieldFade && !fieldFade.keep(i + 10000, n.x, n.y)) continue;
      const appear = Math.min(1, Math.max(0, (nodeProgress - i / result.nodes.length * 0.4) / 0.6));
      if (appear <= 0) continue;
      let alpha = appear;
      if (fieldFade) alpha *= fieldFade.alpha(i + 10000, n.x, n.y);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (0.55 + 0.45 * appear), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

export function buildNetworkSVG(
  w: number,
  h: number,
  result: NetworkResult,
  p: NetworkParams,
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
      paintNetwork(tctx, w, h, result, p, ink, 1, fade, fadeSeed),
    );
    parts.push(`<path d="${d}" fill="${ink}" fill-rule="evenodd"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  }

  parts.push(
    `<g fill="none" stroke="${ink}" stroke-linecap="${fade ? "round" : "butt"}" stroke-linejoin="round">`,
  );
  let lineId = 0;
  for (const line of result.lines) {
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
  if (p.nodeSize > 0.05) {
    parts.push(`<g fill="${ink}">`);
    for (let i = 0; i < result.nodes.length; i++) {
      const n = result.nodes[i];
      if (fieldFade && !fieldFade.keep(i + 10000, n.x, n.y)) continue;
      const a = fieldFade ? fieldFade.alpha(i + 10000, n.x, n.y) : 1;
      const opacity = a < 0.99 ? ` opacity="${f(a)}"` : "";
      parts.push(
        `<circle cx="${f(n.x)}" cy="${f(n.y)}" r="${f(n.r)}"${opacity}/>`,
      );
    }
    parts.push(`</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}
