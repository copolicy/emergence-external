import { FH, FW, type FlowLine } from "./flowFieldCore";
import { mulberry32 } from "./specimenTreeCore";
import { TRACE_ASPECT, TRACE_PATHS, TRACE_WEIGHT } from "./infraTraceData";
import { DEFAULT_JAGGED, type JaggedParams } from "./jaggedCore";

// Infrastructure — the traced reference board. Seed 1 is the artwork as traced;
// other seeds reframe large continuous windows of that same network so ribbons
// stay long and connected (not a collage of short clips).
export const IW = FW;
export const IH = FH;
export const INK = "#195519"; // Mid green
export const BG = "#F5F5F2"; // Cream

/** Seed that places the traced reference board exactly (cover-fit). */
export const INFRA_REFERENCE_SEED = 1;

export interface InfraTraceParams extends JaggedParams {
  /** Overall size multiplier on stroke weight. */
  scale: number;
  /** Ink inset from the canvas edge, as a fraction of the short side. */
  inset: number;
  /** Base horizontal flip. */
  mirror: number;
  /** Shift left/right (fraction of canvas width). */
  nudgeX: number;
  /** Shift up/down (fraction of canvas height). */
  nudgeY: number;
  /**
   * Remix intensity for seeds other than 1 (how many patches / how nested).
   * Ignored for seed 1 (always the traced reference).
   */
  variation: number;
}

export const DEFAULT_INFRA_TRACE: InfraTraceParams = {
  ...DEFAULT_JAGGED,
  seed: INFRA_REFERENCE_SEED,
  // ~1 keeps the source pitch-to-weight ratio (~3.14).
  lineWidth: 0.95,
  scale: 1,
  inset: 0.04,
  mirror: 1,
  nudgeX: 0,
  nudgeY: 0,
  variation: 0.7,
  stamp: 0.3,
  cutout: 0.62,
};

export const INFRA_TRACE_RANGES: Record<string, [number, number, number]> = {
  seed: [1, 60, 1],
  variation: [0, 1, 0.02],
  lineWidth: [0.2, 3, 0.01],
  scale: [0.4, 1.4, 0.01],
  inset: [0, 0.2, 0.005],
  mirror: [0, 1, 1],
  nudgeX: [-0.4, 0.4, 0.005],
  nudgeY: [-0.4, 0.4, 0.005],
  stamp: [0, 0.45, 0.01],
  cutout: [0, 1, 0.01],
};

export const INFRA_TRACE_LABELS: Record<string, string> = {
  seed: "Seed",
  variation: "Variation",
  lineWidth: "Line Weight",
  scale: "Scale",
  inset: "Inset",
  mirror: "Mirror",
  nudgeX: "Offset X",
  nudgeY: "Offset Y",
  stamp: "Stamp",
  cutout: "Line Breaks",
};

export const INFRA_TRACE_HINTS: Record<string, string> = {
  seed: "Seed 1 is the traced reference. Seeds 2–60 show a different continuous region of that same network (flip / pan / second window) — long connected ribbons, not a collage of short clips.",
  variation:
    "For seeds other than 1: how much the board is reframed and whether a second window fills empty space. Ignored on seed 1.",
  lineWidth: "Multiplies the reference's own stroke weight.",
  scale: "Overall size multiplier on stroke weight.",
  inset: "Clear margin held between the artwork and the canvas edge.",
  mirror: "Horizontal flip of the whole composition.",
  nudgeX: "Shifts the composition left or right.",
  nudgeY: "Shifts the composition up or down.",
  stamp:
    "Ink-stamp fatten pass. Spreads and smooths the linework into solid ink.",
  cutout:
    "Cutout pass — pinches thin spots into organic breaks and dashes without thickening the line.",
};

export const SLIDER_KEYS_INFRA_TRACE: string[] = [
  "seed",
  "lineWidth",
  "stamp",
  "cutout",
];

// ---- centreline cleanup ----------------------------------------------------
// The recovered TRACE_PATHS still leave near-miss endpoints as separate strokes,
// and skeletonisation left rounded corner chains instead of clean 45° / 90° turns.
// On a tall crop like 9:16 those read as mid-path breaks and jagged corners even
// with Stamp / Line Breaks at 0.
//
// 1. Weld near-aligned endpoints (join radius << half pitch so parallel ribbons
//    stay apart; dot ≥ 0 keeps collinear joins and square corners).
// 2. Octilinearise each stroke: snap runs to the eight compass headings and
//    rebuild corners at heading intersections, collapsing the noisy corner fans.

const JOIN_R = 0.0055;
const JOIN_MIN_DOT = 0;
const MIN_PATH_LEN = 0.003;
const OCT = Math.PI / 4;
/** Runs shorter than this are treated as corner noise and absorbed. */
const MIN_OCT_RUN = 0.008;

function dist2(a: number[], b: number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function pathLength(path: number[][]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    len += Math.hypot(dx, dy);
  }
  return len;
}

function endHeading(path: number[][], end: "start" | "end"): [number, number] {
  if (path.length < 2) return [0, 0];
  const a = end === "start" ? path[0] : path[path.length - 2];
  const b = end === "start" ? path[1] : path[path.length - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
}

function snapAngle(a: number): number {
  return Math.round(a / OCT) * OCT;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function lineIntersect(
  p: number[],
  d: number[],
  q: number[],
  e: number[],
): number[] | null {
  const det = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(det) < 1e-12) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / det;
  return [p[0] + t * d[0], p[1] + t * d[1]];
}

/** Drop short 180° hairpin stubs that fold a centreline back on itself. */
function stripHairpins(path: number[][]): number[][] {
  if (path.length < 3) return path;
  const out: number[][] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = path[i];
    const next = path[i + 1];
    const dx1 = cur[0] - prev[0];
    const dy1 = cur[1] - prev[1];
    const dx2 = next[0] - cur[0];
    const dy2 = next[1] - cur[1];
    const L1 = Math.hypot(dx1, dy1) || 1;
    const L2 = Math.hypot(dx2, dy2) || 1;
    const dot = (dx1 / L1) * (dx2 / L2) + (dy1 / L1) * (dy2 / L2);
    if (dot < -0.85 && L1 < 0.02) continue;
    out.push(cur);
  }
  out.push(path[path.length - 1]);
  return out;
}

/**
 * Rebuild a traced centreline onto the eight compass headings. Skeletonisation
 * fans each real corner into a chain of short off-angle segments; those collapse
 * into a single vertex at the intersection of the neighbouring snapped runs.
 *
 * Angle math runs in aspect-corrected space (`x * TRACE_ASPECT`) because the
 * stored paths are normalised 0..1 over a non-square bbox — a true 45° in the
 * artwork is not 45° in that square parameter space.
 */
function octilinearizePath(path: number[][]): number[][] {
  if (path.length < 2) return path.map((pt) => pt.slice());

  const toIso = (p: number[]) => [p[0] * TRACE_ASPECT, p[1]];
  const fromIso = (p: number[]) => [p[0] / TRACE_ASPECT, p[1]];

  const raw: number[][] = [path[0].slice()];
  for (let i = 1; i < path.length; i++) {
    if (
      Math.hypot(
        path[i][0] - raw[raw.length - 1][0],
        path[i][1] - raw[raw.length - 1][1],
      ) >= 1e-5
    ) {
      raw.push(path[i].slice());
    }
  }
  if (raw.length < 2) return raw;

  const pts = raw.map(toIso);

  type Run = { ang: number; i0: number; i1: number; len: number };
  const runs: Run[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-12) continue;
    const ang = snapAngle(Math.atan2(dy, dx));
    const last = runs[runs.length - 1];
    if (last && angleDiff(last.ang, ang) < 1e-9) {
      last.i1 = i + 1;
      last.len += L;
    } else {
      runs.push({ ang, i0: i, i1: i + 1, len: L });
    }
  }

  // Absorb short corner-noise runs into the longer neighbour.
  // Threshold is in isotropic (≈artwork-height) units.
  const minRun = MIN_OCT_RUN * TRACE_ASPECT;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].len >= minRun || runs.length === 1) continue;
      if (i === 0) {
        runs[1].i0 = runs[0].i0;
        runs[1].len += runs[0].len;
        runs.splice(0, 1);
      } else if (i === runs.length - 1) {
        runs[i - 1].i1 = runs[i].i1;
        runs[i - 1].len += runs[i].len;
        runs.splice(i, 1);
      } else if (runs[i - 1].len >= runs[i + 1].len) {
        runs[i - 1].i1 = runs[i].i1;
        runs[i - 1].len += runs[i].len;
        runs.splice(i, 1);
      } else {
        runs[i + 1].i0 = runs[i].i0;
        runs[i + 1].len += runs[i].len;
        runs.splice(i, 1);
      }
      changed = true;
      break;
    }
    if (!changed) break;
  }

  for (let i = 0; i < runs.length - 1; ) {
    if (angleDiff(runs[i].ang, runs[i + 1].ang) < 1e-9) {
      runs[i].i1 = runs[i + 1].i1;
      runs[i].len += runs[i + 1].len;
      runs.splice(i + 1, 1);
    } else {
      i++;
    }
  }

  if (runs.length === 0) return raw;
  if (runs.length === 1) {
    const a = runs[0].ang;
    const end = pts[pts.length - 1];
    const L = Math.hypot(end[0] - pts[0][0], end[1] - pts[0][1]);
    return [
      fromIso(pts[0]),
      fromIso([pts[0][0] + Math.cos(a) * L, pts[0][1] + Math.sin(a) * L]),
    ];
  }

  const anchor = (r: Run) => {
    const a = pts[r.i0];
    const b = pts[r.i1];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };

  const outIso: number[][] = [pts[0].slice()];
  let prevPt = pts[0].slice();
  let prevDir = [Math.cos(runs[0].ang), Math.sin(runs[0].ang)];

  for (let i = 1; i < runs.length; i++) {
    const dir = [Math.cos(runs[i].ang), Math.sin(runs[i].ang)];
    const hit = lineIntersect(prevPt, prevDir, anchor(runs[i]), dir);
    if (
      hit &&
      Number.isFinite(hit[0]) &&
      Number.isFinite(hit[1]) &&
      Math.hypot(hit[0] - prevPt[0], hit[1] - prevPt[1]) < 1.5
    ) {
      outIso.push(hit);
      prevPt = hit;
      prevDir = dir;
      continue;
    }
    const step = runs[i - 1].len;
    const mid = [prevPt[0] + prevDir[0] * step, prevPt[1] + prevDir[1] * step];
    outIso.push(mid);
    prevPt = mid;
    prevDir = dir;
  }

  const end = pts[pts.length - 1];
  const tip = lineIntersect(prevPt, prevDir, end, [-prevDir[1], prevDir[0]]);
  outIso.push(tip && Number.isFinite(tip[0]) ? tip : end);

  const clean: number[][] = [fromIso(outIso[0])];
  for (let i = 1; i < outIso.length; i++) {
    const p = fromIso(outIso[i]);
    if (
      Math.hypot(
        p[0] - clean[clean.length - 1][0],
        p[1] - clean[clean.length - 1][1],
      ) > 1e-5
    ) {
      clean.push(p);
    }
  }
  return clean;
}

function tryMerge(A: number[][], B: number[][]): number[][] | null {
  const configs: [number[][], number[][]][] = [
    [A, B],
    [A, B.slice().reverse()],
    [A.slice().reverse(), B],
    [A.slice().reverse(), B.slice().reverse()],
  ];
  const r2 = JOIN_R * JOIN_R;
  let best: number[][] | null = null;
  let bestD = Infinity;
  for (const [a, b] of configs) {
    const d2 = dist2(a[a.length - 1], b[0]);
    if (d2 > r2 || d2 >= bestD) continue;
    const [ax, ay] = endHeading(a, "end");
    const [bx, by] = endHeading(b, "start");
    if (ax * bx + ay * by < JOIN_MIN_DOT) continue;
    bestD = d2;
    if (d2 < 1e-12) {
      best = a.concat(b.slice(1));
    } else {
      const mid = [
        (a[a.length - 1][0] + b[0][0]) / 2,
        (a[a.length - 1][1] + b[0][1]) / 2,
      ];
      best = a.concat([mid], b.slice(1));
    }
  }
  return best;
}

function weldPieces(pieces: number[][][]): void {
  let guard = 0;
  while (guard++ < 500) {
    let merged = false;
    outer: for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const next = tryMerge(pieces[i], pieces[j]);
        if (!next) continue;
        pieces[i] = next;
        pieces.splice(j, 1);
        merged = true;
        break outer;
      }
    }
    if (!merged) break;
  }
}

/**
 * Re-weld and octilinearise recovered centrelines so each stroke reads as one
 * clean vector. Runs once at module load — the source data stays untouched.
 */
function cleanTracePaths(paths: number[][][]): number[][][] {
  const pieces = paths
    .map((p) => stripHairpins(p.map((pt) => pt.slice())))
    .filter((p) => p.length >= 2 && pathLength(p) >= MIN_PATH_LEN);

  weldPieces(pieces);

  for (let i = 0; i < pieces.length; i++) {
    pieces[i] = octilinearizePath(pieces[i]);
  }

  // After snapping, some ends land closer — weld once more, then re-snap so a
  // join mid-point cannot leave a non-octilinear kink.
  weldPieces(pieces);
  for (let i = 0; i < pieces.length; i++) {
    pieces[i] = octilinearizePath(pieces[i]);
  }

  return pieces
    .filter((p) => p.length >= 2 && pathLength(p) >= MIN_PATH_LEN)
    .sort((a, b) => pathLength(a) - pathLength(b));
}

const WELDED_TRACE_PATHS = cleanTracePaths(TRACE_PATHS);

// Paths shorter than this (in source 0..1 space) are skeleton stubs, not pattern.
const MIN_RIBBON = 0.016;

/** Canvas-space length of a polyline. */
function polyLen(poly: number[][]): number {
  let len = 0;
  for (let i = 1; i < poly.length; i++) {
    len += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  }
  return len;
}

function simplifyCanvasPoly(poly: number[][], minSeg: number): number[][] {
  if (poly.length < 2) return poly;
  const eps = Math.max(0.35, minSeg * 0.35);
  let pts: number[][] = [poly[0].slice()];
  for (let i = 1; i < poly.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.hypot(poly[i][0] - prev[0], poly[i][1] - prev[1]) >= eps) {
      pts.push(poly[i].slice());
    }
  }
  if (pts.length < 2) return pts;

  const stripped: number[][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = stripped[stripped.length - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const dx1 = cur[0] - prev[0];
    const dy1 = cur[1] - prev[1];
    const dx2 = next[0] - cur[0];
    const dy2 = next[1] - cur[1];
    const L1 = Math.hypot(dx1, dy1) || 1;
    const L2 = Math.hypot(dx2, dy2) || 1;
    const dot = (dx1 / L1) * (dx2 / L2) + (dy1 / L1) * (dy2 / L2);
    if (dot < -0.75 && L1 < minSeg * 4) continue;
    stripped.push(cur);
  }
  stripped.push(pts[pts.length - 1]);
  pts = stripped;

  const out: number[][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const dx1 = b[0] - a[0];
    const dy1 = b[1] - a[1];
    const dx2 = c[0] - b[0];
    const dy2 = c[1] - b[1];
    const L1 = Math.hypot(dx1, dy1) || 1;
    const L2 = Math.hypot(dx2, dy2) || 1;
    const cross = Math.abs(dx1 * dy2 - dy1 * dx2) / (L1 * L2);
    if (cross < 0.04 && L1 < minSeg * 6) continue;
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Clip a polyline to an axis-aligned rect; split on exits. */
function clipPolyToRect(
  poly: number[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number[][][] {
  const inside = (p: number[]) =>
    p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;

  const hit = (a: number[], b: number[]): number[] | null => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let t0 = 0;
    let t1 = 1;
    const clips: [number, number][] = [
      [-dx, a[0] - x0],
      [dx, x1 - a[0]],
      [-dy, a[1] - y0],
      [dy, y1 - a[1]],
    ];
    for (const [p, q] of clips) {
      if (Math.abs(p) < 1e-12) {
        if (q < 0) return null;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
    if (t1 < t0) return null;
    const t = inside(a) ? t1 : t0;
    if (t <= 1e-6 || t >= 1 - 1e-6) return null;
    return [a[0] + dx * t, a[1] + dy * t];
  };

  const parts: number[][][] = [];
  let cur: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const inn = inside(p);
    if (i === 0) {
      if (inn) cur.push(p.slice());
      continue;
    }
    const prev = poly[i - 1];
    const prevIn = inside(prev);
    if (prevIn && inn) {
      cur.push(p.slice());
    } else if (prevIn && !inn) {
      const edge = hit(prev, p);
      if (edge) cur.push(edge);
      if (cur.length >= 2) parts.push(cur);
      cur = [];
    } else if (!prevIn && inn) {
      const edge = hit(prev, p);
      cur = edge ? [edge, p.slice()] : [p.slice()];
    }
  }
  if (cur.length >= 2) parts.push(cur);
  return parts;
}

function linesFromPolys(
  placed: number[][][],
  weight: number,
): FlowLine[] {
  const out: FlowLine[] = [];
  let kept = 0;
  const totalKeep = placed.length;
  for (const poly of placed) {
    const pts: number[] = [];
    for (const [x, y] of poly) pts.push(x, y);
    if (pts.length < 4) continue;
    out.push({
      pts,
      w: weight,
      order: totalKeep > 1 ? kept / (totalKeep - 1) : 1,
      arrow: false,
    });
    kept++;
  }
  return out;
}

/** Exact traced reference, cover-fit to the canvas. */
function placeReferenceBoard(
  w: number,
  h: number,
  p: InfraTraceParams,
  loX: number,
  hiX: number,
  loY: number,
  hiY: number,
): FlowLine[] {
  const availW = Math.max(1, hiX - loX);
  const availH = Math.max(1, hiY - loY);
  const nudgeX = (p.nudgeX ?? 0) * w;
  const nudgeY = (p.nudgeY ?? 0) * h;
  const flipX = (p.mirror ?? 1) >= 0.5;
  const fit = Math.max(availW / TRACE_ASPECT, availH) * (p.scale ?? 1);
  const artW = fit * TRACE_ASPECT;
  const artH = fit;
  const ox = loX + (availW - artW) / 2 + nudgeX;
  const oy = loY + (availH - artH) / 2 + nudgeY;
  const weight = Math.max(0.15, TRACE_WEIGHT * artH * (p.lineWidth ?? 0.95));
  const minSeg = Math.max(1.2, weight * 0.85);
  const minKeep = Math.max(weight * 3.14 * 1.05, artH * MIN_RIBBON * 0.55);
  const placed: number[][][] = [];

  for (const src of WELDED_TRACE_PATHS) {
    if (src.length < 2 || pathLength(src) < MIN_RIBBON) continue;
    const mapped: number[][] = [];
    for (const pt of src) {
      const nx = flipX ? 1 - pt[0] : pt[0];
      mapped.push([ox + nx * artW, oy + pt[1] * artH]);
    }
    for (const part of clipPolyToRect(mapped, loX, loY, hiX, hiY)) {
      const clean = simplifyCanvasPoly(part, minSeg);
      if (clean.length >= 2 && polyLen(clean) >= minKeep) placed.push(clean);
    }
  }
  placed.sort((a, b) => polyLen(b) - polyLen(a));
  return linesFromPolys(placed, weight);
}

// ---- continuous board remix (seeds ≠ 1) ------------------------------------
// Small motif clips shatter the long welded ribbons that make seed 1 feel
// connected. Non-reference seeds instead reframe large continuous windows of
// the same board (plus a sparse second window into empty space), then tip-weld.

/** Coarse ink + turn grids for picking coil-rich crops. */
const DENSITY_N = 24;
const BOARD_DENSITY: Float32Array = new Float32Array(DENSITY_N * DENSITY_N);
const BOARD_TURNS: Float32Array = new Float32Array(DENSITY_N * DENSITY_N);
(() => {
  for (const path of WELDED_TRACE_PATHS) {
    if (path.length < 2 || pathLength(path) < MIN_RIBBON) continue;
    for (let i = 0; i < path.length - 1; i++) {
      const ax = path[i][0];
      const ay = path[i][1];
      const bx = path[i + 1][0];
      const by = path[i + 1][1];
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len * DENSITY_N * 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        const cx = Math.max(0, Math.min(DENSITY_N - 1, (x * DENSITY_N) | 0));
        const cy = Math.max(0, Math.min(DENSITY_N - 1, (y * DENSITY_N) | 0));
        BOARD_DENSITY[cy * DENSITY_N + cx] += len / steps;
      }
    }
    for (let i = 1; i < path.length - 1; i++) {
      const ax = path[i][0] - path[i - 1][0];
      const ay = path[i][1] - path[i - 1][1];
      const bx = path[i + 1][0] - path[i][0];
      const by = path[i + 1][1] - path[i][1];
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      const dot = Math.max(
        -1,
        Math.min(1, (ax / la) * (bx / lb) + (ay / la) * (by / lb)),
      );
      const turn = Math.acos(dot);
      if (turn < 0.2) continue;
      const x = path[i][0];
      const y = path[i][1];
      const cx = Math.max(0, Math.min(DENSITY_N - 1, (x * DENSITY_N) | 0));
      const cy = Math.max(0, Math.min(DENSITY_N - 1, (y * DENSITY_N) | 0));
      BOARD_TURNS[cy * DENSITY_N + cx] += turn;
    }
  }
})();

function sampleBoardField(
  field: Float32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let sum = 0;
  const samples = 10;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const u = x0 + ((i + 0.5) / samples) * (x1 - x0);
      const v = y0 + ((j + 0.5) / samples) * (y1 - y0);
      const cx = Math.max(0, Math.min(DENSITY_N - 1, (u * DENSITY_N) | 0));
      const cy = Math.max(0, Math.min(DENSITY_N - 1, (v * DENSITY_N) | 0));
      sum += field[cy * DENSITY_N + cx];
    }
  }
  return sum;
}

function cropScore(x0: number, y0: number, x1: number, y1: number): number {
  const ink = sampleBoardField(BOARD_DENSITY, x0, y0, x1, y1);
  const turns = sampleBoardField(BOARD_TURNS, x0, y0, x1, y1);
  return ink * (1 + 1.5 * turns);
}

function orientUV(
  x: number,
  y: number,
  flipX: boolean,
  flipY: boolean,
  rot180: boolean,
): [number, number] {
  let u = flipX ? 1 - x : x;
  let v = flipY ? 1 - y : y;
  if (rot180) {
    u = 1 - u;
    v = 1 - v;
  }
  return [u, v];
}

/** Join near-aligned tips so clipped ribbons read continuous like seed 1. */
function weldCanvasTips(polys: number[][][], joinR: number): number[][][] {
  const pieces = polys
    .filter((p) => p.length >= 2)
    .map((p) => p.map((pt) => pt.slice()));
  const r2 = joinR * joinR;
  let guard = 0;
  let merged = true;
  while (merged && guard++ < 8) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++) {
      const a = pieces[i];
      if (!a || a.length < 2) continue;
      for (const endA of ["start", "end"] as const) {
        const tipA = endA === "start" ? a[0] : a[a.length - 1];
        const headA = endHeading(a, endA);
        for (let j = 0; j < pieces.length; j++) {
          if (i === j) continue;
          const b = pieces[j];
          if (!b || b.length < 2) continue;
          for (const endB of ["start", "end"] as const) {
            const tipB = endB === "start" ? b[0] : b[b.length - 1];
            if (dist2(tipA, tipB) > r2) continue;
            const headB = endHeading(b, endB);
            // Outward headings should oppose for a continuous join.
            const dot = -(headA[0] * headB[0] + headA[1] * headB[1]);
            if (dot < 0.15) continue;
            const mid = [(tipA[0] + tipB[0]) / 2, (tipA[1] + tipB[1]) / 2];
            let left = endA === "start" ? a.slice().reverse() : a.slice();
            let right = endB === "start" ? b.slice() : b.slice().reverse();
            left = left.slice(0, -1);
            right = right.slice(1);
            pieces[i] = left.concat([mid], right);
            pieces[j] = [];
            merged = true;
            break outer;
          }
        }
      }
    }
  }
  return pieces.filter((p) => p.length >= 2);
}

type Occ = { cell: number; gw: number; gh: number; rad: number; occ: Uint8Array };

function makeOcc(w: number, h: number, weight: number): Occ {
  const cell = Math.max(1.4, weight * 0.5);
  const clearR = Math.max(cell, weight * 0.72);
  const gw = Math.max(1, Math.ceil(w / cell));
  const gh = Math.max(1, Math.ceil(h / cell));
  return {
    cell,
    gw,
    gh,
    rad: Math.max(1, Math.ceil(clearR / cell)),
    occ: new Uint8Array(gw * gh),
  };
}

function claimPoly(grid: Occ, poly: number[][], force = false): boolean {
  const { cell, gw, gh, rad, occ } = grid;
  const samples: number[] = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const ax = poly[i][0];
    const ay = poly[i][1];
    const bx = poly[i + 1][0];
    const by = poly[i + 1][1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (cell * 0.55)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const cx = Math.max(0, Math.min(gw - 1, (x / cell) | 0));
      const cy = Math.max(0, Math.min(gh - 1, (y / cell) | 0));
      for (let dy = -rad; dy <= rad; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad + 0.25) continue;
          const xx = cx + dx;
          if (xx < 0 || xx >= gw) continue;
          samples.push(yy * gw + xx);
        }
      }
    }
  }
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const idx of samples) {
    if (seen.has(idx)) continue;
    seen.add(idx);
    if (!force && occ[idx]) return false;
    unique.push(idx);
  }
  for (const idx of unique) occ[idx] = 1;
  return true;
}

/**
 * Map a UV window of the welded board into the canvas as one continuous network.
 * Full ribbons are mapped (not pre-clipped to the window) so coils stay joined;
 * only the canvas frame clips them.
 */
function placeBoardWindow(
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  flipX: boolean,
  flipY: boolean,
  rot180: boolean,
  ox: number,
  oy: number,
  artW: number,
  artH: number,
  loX: number,
  hiX: number,
  loY: number,
  hiY: number,
  minSeg: number,
  minKeep: number,
  grid: Occ | null,
): number[][][] {
  const out: number[][][] = [];
  const paths = WELDED_TRACE_PATHS
    .filter((p) => p.length >= 2 && pathLength(p) >= MIN_RIBBON)
    .slice()
    .sort((a, b) => pathLength(b) - pathLength(a));

  for (const src of paths) {
    // Prefer ribbons that actually live in this window.
    let inside = 0;
    let total = 0;
    for (let i = 0; i < src.length; i++) {
      const [u0, v0] = orientUV(src[i][0], src[i][1], flipX, flipY, rot180);
      total++;
      if (
        u0 >= cropX - 0.002 &&
        u0 <= cropX + cropW + 0.002 &&
        v0 >= cropY - 0.002 &&
        v0 <= cropY + cropH + 0.002
      ) {
        inside++;
      }
    }
    if (inside / Math.max(1, total) < 0.12) continue;

    const mapped: number[][] = [];
    for (const pt of src) {
      const [u0, v0] = orientUV(pt[0], pt[1], flipX, flipY, rot180);
      const u = (u0 - cropX) / cropW;
      const vv = (v0 - cropY) / cropH;
      mapped.push([ox + u * artW, oy + vv * artH]);
    }
    for (const part of clipPolyToRect(mapped, loX, loY, hiX, hiY)) {
      const clean = simplifyCanvasPoly(part, minSeg);
      if (clean.length < 3 || polyLen(clean) < minKeep) continue;
      if (grid && !claimPoly(grid, clean)) continue;
      out.push(clean);
    }
  }
  return out;
}

function pickCropWindow(
  availW: number,
  availH: number,
  v: number,
  rand: () => number,
): { x: number; y: number; w: number; h: number } {
  const canvasAspect = availW / availH;
  const uvAspect = canvasAspect / TRACE_ASPECT;
  // Keep windows large so ribbons stay long, but not so packed that every
  // seed collapses to the same full-board framing.
  const zoom = 1 + rand() * (0.04 + v * 0.2); // 1…~1.24
  const minSpan = 0.7 - v * 0.05; // ~0.65–0.70
  let cropW = 1;
  let cropH = 1;

  if (uvAspect >= 1) {
    cropW = Math.min(1, Math.max(minSpan, 1 / zoom));
    cropH = Math.min(1, Math.max(minSpan * 0.9, cropW / Math.max(1e-6, uvAspect)));
    if (cropH > 1) {
      cropH = 1;
      cropW = Math.min(1, cropH * uvAspect);
    }
  } else {
    cropH = Math.min(1, Math.max(minSpan, 1 / zoom));
    cropW = Math.min(1, Math.max(minSpan * 0.9, cropH * uvAspect));
    if (cropW > 1) {
      cropW = 1;
      cropH = Math.min(1, cropW / Math.max(1e-6, uvAspect));
    }
  }

  const full = cropScore(0, 0, 1, 1);
  let bestX = rand() * (1 - cropW);
  let bestY = rand() * (1 - cropH);
  let bestS = -1;
  for (let t = 0; t < 20; t++) {
    const x = rand() * (1 - cropW);
    const y = rand() * (1 - cropH);
    const s = cropScore(x, y, x + cropW, y + cropH);
    if (s > bestS) {
      bestS = s;
      bestX = x;
      bestY = y;
    }
    if (s >= full * 0.82 && t >= 5) break;
  }
  return { x: bestX, y: bestY, w: cropW, h: cropH };
}

/**
 * Seed-varied continuous reframing of the reference board — long connected
 * ribbons like seed 1, different region / flip / secondary fill per seed.
 */
function remixReferencePatches(
  w: number,
  h: number,
  p: InfraTraceParams,
  loX: number,
  hiX: number,
  loY: number,
  hiY: number,
): FlowLine[] {
  const availW = Math.max(1, hiX - loX);
  const availH = Math.max(1, hiY - loY);
  const v = Math.max(0.15, Math.min(1, p.variation ?? 0.7));
  const rand = mulberry32(((p.seed | 0) * 2654435761) ^ 0x51f5e);
  const mirrorBase = (p.mirror ?? 1) >= 0.5;
  const nudgeX = (p.nudgeX ?? 0) * w;
  const nudgeY = (p.nudgeY ?? 0) * h;

  const flipX = mirrorBase !== rand() < 0.5;
  const flipY = rand() < 0.35;
  const rot180 = rand() < 0.28;

  const primary = pickCropWindow(availW, availH, v, rand);
  // Mild pack — preserves seed-to-seed crop differences.
  {
    const PACK = 1.12;
    const cx = primary.x + primary.w * 0.5;
    const cy = primary.y + primary.h * 0.5;
    primary.w = Math.min(1, primary.w * PACK);
    primary.h = Math.min(1, primary.h * PACK);
    primary.x = Math.min(Math.max(0, cx - primary.w * 0.5), 1 - primary.w);
    primary.y = Math.min(Math.max(0, cy - primary.h * 0.5), 1 - primary.h);
  }

  const cropAspect = TRACE_ASPECT * (primary.w / primary.h);
  const fit = Math.max(availW / cropAspect, availH) * (p.scale ?? 1);
  const artW = fit * cropAspect;
  const artH = fit;
  const ox = loX + (availW - artW) / 2 + nudgeX;
  const oy = loY + (availH - artH) / 2 + nudgeY;
  const weight = Math.max(0.15, TRACE_WEIGHT * artH * (p.lineWidth ?? 0.95));
  const pitch = Math.max(4, weight * 3.14);
  const minSeg = Math.max(1.2, weight * 0.85);
  // Allow longer continuous runs; still drop tiny stubs.
  const minKeep = Math.max(pitch * 2.2, artH * MIN_RIBBON * 0.85);

  const grid = makeOcc(w, h, weight);
  // Primary = continuous network like seed 1 (no occupancy cull — parallel
  // nests must all land). Mark ink afterward so the second window only fills gaps.
  let placed = placeBoardWindow(
    primary.x,
    primary.y,
    primary.w,
    primary.h,
    flipX,
    flipY,
    rot180,
    ox,
    oy,
    artW,
    artH,
    loX,
    hiX,
    loY,
    hiY,
    minSeg,
    minKeep,
    null,
  );
  for (const poly of placed) claimPoly(grid, poly, true);

  // Second large continuous window into leftover space (not a collage of stubs).
  if (v > 0.25) {
    const secondary = pickCropWindow(availW, availH, v * 0.85, rand);
    const PACK2 = 1.25;
    const cx = secondary.x + secondary.w * 0.5;
    const cy = secondary.y + secondary.h * 0.5;
    secondary.w = Math.min(1, secondary.w * PACK2);
    secondary.h = Math.min(1, secondary.h * PACK2);
    secondary.x = Math.min(Math.max(0, cx - secondary.w * 0.5), 1 - secondary.w);
    secondary.y = Math.min(Math.max(0, cy - secondary.h * 0.5), 1 - secondary.h);

    // Offset the second window so it reads as a different region, not a twin.
    const flipX2 = !flipX;
    const flipY2 = rand() < 0.4 ? !flipY : flipY;
    const rot2 = rand() < 0.4;
    const cropAspect2 = TRACE_ASPECT * (secondary.w / secondary.h);
    const fit2 = Math.max(availW / cropAspect2, availH) * (p.scale ?? 1);
    const artW2 = fit2 * cropAspect2;
    const artH2 = fit2;
    // Slight jitter so seams don't stack on the primary cover-fit.
    const ox2 = loX + (availW - artW2) / 2 + nudgeX + (rand() - 0.5) * pitch * 2;
    const oy2 = loY + (availH - artH2) / 2 + nudgeY + (rand() - 0.5) * pitch * 2;

    const extra = placeBoardWindow(
      secondary.x,
      secondary.y,
      secondary.w,
      secondary.h,
      flipX2,
      flipY2,
      rot2,
      ox2,
      oy2,
      artW2,
      artH2,
      loX,
      hiX,
      loY,
      hiY,
      minSeg,
      minKeep * 1.15, // only keep substantial secondary ribbons
      grid,
    );
    for (const poly of extra) placed.push(poly);
  }

  placed = weldCanvasTips(placed, Math.max(weight * 0.85, pitch * 0.22));
  placed.sort((a, b) => polyLen(b) - polyLen(a));
  return linesFromPolys(placed, weight);
}

/**
 * Seed 1 → traced reference cover-fit.
 * Any other seed → large continuous reframing of that same board.
 */
export function computeInfraTrace(
  w: number,
  h: number,
  p: InfraTraceParams,
): FlowLine[] {
  const inset = Math.min(w, h) * (p.inset ?? 0.04);
  const loX = inset;
  const hiX = w - inset;
  const loY = inset;
  const hiY = h - inset;

  if ((p.seed | 0) === INFRA_REFERENCE_SEED) {
    return placeReferenceBoard(w, h, p, loX, hiX, loY, hiY);
  }
  return remixReferencePatches(w, h, p, loX, hiX, loY, hiY);
}
