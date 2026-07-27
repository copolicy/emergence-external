import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";

// Education — a knowledge graph / constellation. Nodes scatter across the
// field and connect into triangles and polygons, like a low-poly mesh or
// neural map of linked ideas.
export const NW = 680;
export const NH = 580;
export const INK = "#C0B663"; // Gold — matches Education vertical card
export const BG = "#F5F5F2"; // Cream

export interface NetworkParams {
  seed: number;
  nodes: number;
  linkDist: number; // max connection distance as fraction of long edge
  lineWidth: number;
  nodeSize: number; // filled dot radius (0 = lines only)
  cluster: number; // 0..1 pull toward a soft center cluster
}

export const DEFAULT_NETWORK: NetworkParams = {
  seed: 33917,
  nodes: 56,
  linkDist: 0.22,
  lineWidth: 1,
  nodeSize: 2.2,
  cluster: 0.35,
};

export const NETWORK_RANGES: Record<
  keyof NetworkParams,
  [number, number, number]
> = {
  seed: [1, 99999, 1],
  nodes: [12, 120, 1],
  linkDist: [0.1, 0.4, 0.01],
  lineWidth: [0.3, 2.5, 0.1],
  nodeSize: [0, 5, 0.1],
  cluster: [0, 1, 0.02],
};

export const NETWORK_LABELS: Record<keyof NetworkParams, string> = {
  seed: "Seed",
  nodes: "Density",
  linkDist: "Reach",
  lineWidth: "Line Weight",
  nodeSize: "Nodes",
  cluster: "Cluster",
};

export const NETWORK_HINTS: Record<keyof NetworkParams, string> = {
  seed: "Random starting value. Same seed always produces the same network.",
  nodes: "How many points are scattered into the field.",
  linkDist: "Maximum distance for an edge. Higher values weave a denser graph.",
  lineWidth: "Thickness of the connecting strokes.",
  nodeSize: "Radius of the filled dots at each vertex. Zero hides nodes.",
  cluster: "Pull toward the center — higher values tighten the constellation.",
};

export const SLIDER_KEYS_SIMPLE_NETWORK: (keyof NetworkParams)[] = [
  "seed",
  "nodes",
  "lineWidth",
];

export interface NetworkLine {
  pts: number[];
  w: number;
  order: number;
}

export interface NetworkNode {
  x: number;
  y: number;
}

export interface NetworkResult {
  lines: NetworkLine[];
  nodes: NetworkNode[];
}

/** Bridson-ish blue-noise scatter with optional center pull. */
function scatterNodes(
  w: number,
  h: number,
  count: number,
  cluster: number,
  rand: () => number,
): NetworkNode[] {
  const pts: NetworkNode[] = [];
  const margin = Math.min(w, h) * 0.06;
  const minDist = Math.sqrt((w * h) / (count * 1.35));
  const minDist2 = minDist * minDist;
  const cx = w * 0.52;
  const cy = h * 0.42;
  let attempts = 0;
  const maxAttempts = count * 60;

  while (pts.length < count && attempts < maxAttempts) {
    attempts++;
    let x = margin + rand() * (w - margin * 2);
    let y = margin + rand() * (h - margin * 2);
    if (cluster > 0.01) {
      const toward = cluster * (0.45 + rand() * 0.4);
      x += (cx - x) * toward;
      y += (cy - y) * toward;
    }
    if (pts.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < minDist2)) continue;
    pts.push({ x, y });
  }
  while (pts.length < count) {
    pts.push({
      x: margin + rand() * (w - margin * 2),
      y: margin + rand() * (h - margin * 2),
    });
  }
  return pts;
}

/**
 * Connect each node to its nearest neighbours within reach, then close a few
 * triangles so the graph reads as polygonal knowledge mesh rather than a tree.
 */
export function computeNetwork(
  w: number,
  h: number,
  p: NetworkParams,
): NetworkResult {
  const rand = mulberry32(p.seed ^ 0xc0de);
  const nodes = scatterNodes(
    w,
    h,
    Math.max(4, Math.round(p.nodes)),
    p.cluster,
    rand,
  );
  const maxDist = Math.max(w, h) * p.linkDist;
  const maxDist2 = maxDist * maxDist;
  const edgeSet = new Set<string>();
  const lines: NetworkLine[] = [];

  const edgeKey = (a: number, b: number) =>
    a < b ? `${a}:${b}` : `${b}:${a}`;

  const addEdge = (a: number, b: number, order: number) => {
    const key = edgeKey(a, b);
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    const na = nodes[a];
    const nb = nodes[b];
    lines.push({
      pts: [na.x, na.y, nb.x, nb.y],
      w: p.lineWidth,
      order,
    });
  };

  // k-nearest within reach
  const K = 4;
  for (let i = 0; i < nodes.length; i++) {
    const dists: { j: number; d2: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= maxDist2) dists.push({ j, d2 });
    }
    dists.sort((a, b) => a.d2 - b.d2);
    const take = Math.min(K, dists.length);
    for (let k = 0; k < take; k++) {
      addEdge(i, dists[k].j, i / Math.max(1, nodes.length - 1));
    }
  }

  // Occasional longer bridges so the graph doesn't fall into isolated clumps
  const bridges = Math.max(2, Math.round(nodes.length * 0.08));
  for (let b = 0; b < bridges; b++) {
    const i = Math.floor(rand() * nodes.length);
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const key = edgeKey(i, j);
      if (edgeSet.has(key)) continue;
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD && d2 < maxDist2 * 2.2) {
        bestD = d2;
        best = j;
      }
    }
    if (best >= 0) addEdge(i, best, 0.85 + rand() * 0.15);
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
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }

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
      ctx.arc(n.x, n.y, p.nodeSize * (0.55 + 0.45 * appear), 0, Math.PI * 2);
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
) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const fieldFade = fade ? makeFade(w, h, { seed: fadeSeed }) : null;
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="${background}"/>`,
    `<g fill="none" stroke="${ink}" stroke-linecap="${fade ? "round" : "butt"}" stroke-linejoin="round">`,
  ];
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
        `<circle cx="${f(n.x)}" cy="${f(n.y)}" r="${f(p.nodeSize)}"${opacity}/>`,
      );
    }
    parts.push(`</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}
