import { Delaunay } from "d3-delaunay";
import { mulberry32 } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";
import {
  drawStamped,
  stampActive,
  traceStampPathD,
  type StampOpts,
} from "./stampTreatment";

// Education — a low-poly knowledge mesh: a Delaunay triangulation spread across
// the full field at an even overall density but off an even lattice, so the
// triangles stretch rather than settling into equilaterals. Inked at a lightly
// varying edge weight with pooled dots at the vertices. Abnormally long hull edges
// are pruned so the boundary frays instead of closing into a clean polygon, and
// the mesh thins out toward the bottom rather than stopping at a line. With Fade
// on, that same dissolve also runs toward the left edge, so the mass drains out
// of the bottom-left corner instead of being cropped square by the frame.
export const NW = 680;
export const NH = 580;
export const INK = "#C0B663"; // Gold
export const BG = "#F5F5F2"; // Cream

export interface NetworkParams {
  seed: number;
  nodes: number;
  linkDist: number; // edge-prune factor — how much longer than local spacing an edge may be
  lineWidth: number;
  nodeSize: number; // filled dot radius (0 = lines only)
  taper: number; // 0..1 how high up the field starts thinning toward the bottom
  skew: number; // 0..1 how far points wander off even spacing (0 = equilateral)
  emphasis: number; // 0..1 share of vertices whose dots pool heavier
  // ink treatment — the same stamp/cutout render pass the Root Brush runs
  stamp: number; // 0..1 ink-stamp fatten/smooth pass (0 = off)
  cutout: number; // 0..1 cutout break/simplify pass (0 = off)
}

export const DEFAULT_NETWORK: NetworkParams = {
  seed: 67819,
  nodes: 75,
  linkDist: 1.9,
  // Hairline edges, fattened back up by the stamp pass below. The treatment's
  // radii scale with the line weight, so this ratio — not the raw stroke — is
  // what keeps Line Breaks nicking the ink instead of eroding it away.
  lineWidth: 0.38,
  nodeSize: 2.4,
  // Taper, Skew and Density are fixed — no sliders. These are the tuned values
  // the mesh is drawn at; everything the rail still exposes is judged against
  // them.
  taper: 0.35,
  skew: 0.22,
  emphasis: 0.22,
  // A heavy stamp against a light cutout: the mesh is short edges meeting at
  // junctions, so a gentle pass barely registers — the ink only reads as drawn
  // once the stamp has fused the junctions. The cutout is held well back from
  // it because the erode is a fraction of the stamp-fattened ink, so at this
  // stamp a little goes a long way.
  stamp: 0.65,
  cutout: 0.35,
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
  skew: [0, 1, 0.02],
  emphasis: [0, 0.6, 0.02],
  // Opened past the 0.45 the other tools cap at — the mesh is short edges
  // meeting at junctions and wants a heavier pass than they do. Stops at 0.7:
  // the cutout erodes a FRACTION of the stamp-fattened ink, so raising Stamp
  // raises the erode with it, and past ~0.75 the edges are eaten away and the
  // mesh collapses to loose dots.
  stamp: [0, 0.7, 0.01],
  cutout: [0, 1, 0.01],
};

export const NETWORK_LABELS: Record<keyof NetworkParams, string> = {
  seed: "Seed",
  nodes: "Density",
  linkDist: "Reach",
  lineWidth: "Line Weight",
  nodeSize: "Nodes",
  taper: "Taper",
  skew: "Skew",
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
  skew:
    "How far the points wander off even spacing. Zero triangulates into near-equilateral triangles; higher values stretch them into longer, thinner shapes.",
  emphasis:
    "Share of vertices whose dots pool heavier than the rest. Edge weight barely varies, so the emphasis reads as heavier ink at the junctions rather than thicker strokes.",
  stamp:
    "Ink-stamp fatten pass (à la Photoshop's Stamp filter). Spreads and smooths the linework into solid calligraphic ink, fusing fine clusters. Zero switches it off.",
  cutout:
    "Cutout pass (à la Photoshop's Cutout filter). Simplifies the stroke contours and pinches thin spots into organic breaks and dashes — never thickens the line. Zero switches it off.",
};

// Taper, Skew and Density stay off the rail — they're held at the DEFAULT_NETWORK
// values above.
export const SLIDER_KEYS_SIMPLE_NETWORK: (keyof NetworkParams)[] = [
  "seed",
  "lineWidth",
  "nodeSize",
  "stamp",
  "cutout",
];

// ± fraction the per-edge stroke weight wanders around the Line Weight slider.
const EDGE_WEIGHT_JITTER = 0.3;

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
  skew: number,
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

  // Even spacing triangulates into near-equilateral triangles — too regular to
  // read as drawn. Nudging each point off the lattice by a fraction of its own
  // spacing pulls neighbours together in places and apart in others, so the
  // triangles stretch into the longer, thinner shapes of the reference. The
  // wander is biased vertically (the mesh is wider than it is tall, and the
  // reference's long spans run down the field), and stays under half a spacing
  // so the mesh keeps its even overall coverage rather than clumping.
  if (skew > 0) {
    for (const p of pts) {
      const j = skew * 0.48 * p.spacing;
      p.x += (rand() * 2 - 1) * j;
      p.y += (rand() * 2 - 1) * j * 1.35;
    }
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
    p.skew,
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
    // The LOOSER of the two endpoints' spacings. Skew puts some points close
    // together, and measuring against the tighter one would take that pair's
    // short edge as the local scale and prune every other edge at both
    // vertices — tearing holes in the mesh and stranding the pair on its own.
    const local = Math.max(nn[a], nn[b]);
    if (!Number.isFinite(local)) continue;
    if (len > local * factor) continue;
    const my = (nodes[a].y + nodes[b].y) * 0.5;
    // Growth runs top-down, the same direction the mesh thins.
    const order = Math.min(1, Math.max(0, my / h));
    lines.push({
      pts: [nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y],
      // Edges ink at a jittered weight around the slider value. The mesh still
      // reads as one drawn lattice, but the cutout pass needs something to bite
      // on selectively: with every edge at an identical weight the erode either
      // clears the whole field or none of it, so the Line Breaks slider jumps
      // from "no breaks" straight to "blank canvas". The spread lets the light
      // edges pinch into breaks at a setting the heavy ones ride out.
      w: p.lineWidth * (1 - EDGE_WEIGHT_JITTER + rand() * EDGE_WEIGHT_JITTER * 2),
      order,
    });
  }

  return { lines, nodes };
}

/**
 * Education's dissolve: the shared bottom fade, plus the same treatment mirrored
 * along X so the mesh also runs out toward the LEFT edge instead of ending on the
 * frame. The two axes are seeded apart, so each line's horizontal and vertical
 * cutoffs stagger independently and the bottom-left corner thins out as one
 * continuous run rather than along two visible lines. Multiplying the tapers
 * means an edge heading into the corner loses width and opacity from both at
 * once, which is what puts the point on it.
 */
function makeNetworkFade(w: number, h: number, seed: number) {
  const down = makeFade(w, h, { seed });
  // Fed (w - x) as its depth: makeFade always dissolves toward its high end, so
  // mirroring the coordinate turns it around to face x = 0. Its extent is the
  // width, so the band is a fraction of the field horizontally.
  // Deliberately a much shallower band than the bottom fade: the two tapers
  // MULTIPLY, so a left dissolve at the vertical fade's depth washes the whole
  // corner out. Cutting late (start/floor near 1) and tapering over a short run
  // keeps the left edge a soft break rather than a gradient across the field.
  const left = makeFade(w, w, {
    seed: (seed ^ 0x4c46) >>> 0,
    start: 0.93,
    floor: 0.995,
    tipFrac: 0.12,
  });
  return {
    keep: (id: number, x: number, y: number) =>
      down.keep(id, x, y) && left.keep(id, y, w - x),
    alpha: (id: number, x: number, y: number) =>
      down.alpha(id, x, y) * left.alpha(id, y, w - x),
    width: (id: number, x: number, y: number) =>
      down.width(id, x, y) * left.width(id, y, w - x),
  };
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

  const fieldFade = fade ? makeNetworkFade(w, h, fadeSeed) : null;
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
  const fieldFade = fade ? makeNetworkFade(w, h, fadeSeed) : null;
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
