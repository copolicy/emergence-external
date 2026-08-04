// Temp harness (Node): score seeds for how evenly they fill the canvas, across
// every aspect preset, so the Supply Chain seed slider can be narrowed to a
// vetted list. Bundle with esbuild and run under node — the browser build of
// this sweep starves the renderer.
import {
  CH,
  computeContours,
  CONTOUR_SEEDS,
  CW,
  DEFAULT_CONTOUR,
  type ContourParams,
} from "./src/tools/contourCore";
import { dimsForPreview } from "./src/tools/aspectRatio";

// Shape 0 is the tool's default (1:1) and carries the real gate; the rest only
// have to not fall apart. Dims are preview dims — native pixel area at the
// export aspect — not the export size.
const SHAPES = [
  dimsForPreview(CW, CH, 1080, 1080),
  dimsForPreview(CW, CH, 1920, 1080),
  dimsForPreview(CW, CH, 1440, 1080),
  dimsForPreview(CW, CH, 1080, 1920),
];

const COLS = 12;
const ROWS = 10;

interface Score {
  gaps: number;
  minRel: number;
  cv: number;
  density: number;
  clot: number;
}

function score(seed: number, w: number, h: number): Score {
  // The seed param is an index into the vetted list now, so to reach an
  // arbitrary raw seed the harness stands the list up as just that one seed.
  CONTOUR_SEEDS.length = 0;
  CONTOUR_SEEDS.push(seed);
  const p: ContourParams = { ...DEFAULT_CONTOUR, seed: 1 };
  const { lines } = computeContours(w, h, p, null);
  const cells = new Float64Array(COLS * ROWS);
  let total = 0;
  for (const line of lines) {
    const pts = line.pts;
    for (let i = 2; i < pts.length; i += 2) {
      const x = pts[i];
      const y = pts[i + 1];
      const len = Math.hypot(x - pts[i - 2], y - pts[i - 1]);
      total += len;
      const ci = Math.min(COLS - 1, Math.max(0, Math.floor((x / w) * COLS)));
      const cj = Math.min(ROWS - 1, Math.max(0, Math.floor((y / h) * ROWS)));
      cells[cj * COLS + ci] += len;
    }
  }
  const cellArea = (w / COLS) * (h / ROWS);
  const perCell = Array.from(cells, (v) => (v / cellArea) * 1000);
  const sorted = perCell.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const mean = perCell.reduce((a, b) => a + b, 0) / perCell.length;
  const variance =
    perCell.reduce((a, b) => a + (b - mean) * (b - mean), 0) / perCell.length;
  return {
    gaps: perCell.filter((v) => v < median * 0.5).length / perCell.length,
    minRel: sorted[0] / median,
    cv: Math.sqrt(variance) / mean,
    density: (total / (w * h)) * 1000,
    clot: sorted[sorted.length - 1] / median,
  };
}

const N = Number(process.argv[2] ?? 6000);
const seeds: number[] = [];
for (let s = 1; s <= N; s++) seeds.push(s);

const byShape: Score[][] = SHAPES.map((d) => seeds.map((s) => score(s, d.w, d.h)));

const pct = (arr: number[], q: number) =>
  arr.slice().sort((a, b) => a - b)[Math.floor(q * (arr.length - 1))];
const col = (shape: number, key: keyof Score) => byShape[shape].map((s) => s[key]);

const say = (s: string) => console.log(s);
say(
  `swept ${N} seeds · fieldScale ${DEFAULT_CONTOUR.fieldScale} / levels ${DEFAULT_CONTOUR.levels} / minRing ${DEFAULT_CONTOUR.minRing}`,
);
say(`shapes: ${SHAPES.map((d) => `${d.w}x${d.h}`).join("  ")}`);
for (const key of ["gaps", "minRel", "cv", "density", "clot"] as const) {
  const a = col(0, key);
  say(
    `1:1 ${key}: p05=${pct(a, 0.05).toFixed(3)} p25=${pct(a, 0.25).toFixed(3)} p50=${pct(a, 0.5).toFixed(3)} p75=${pct(a, 0.75).toFixed(3)} p95=${pct(a, 0.95).toFixed(3)}`,
  );
}

const GATE = {
  gaps: pct(col(0, "gaps"), 0.2),
  minRel: pct(col(0, "minRel"), 0.8),
  cv: pct(col(0, "cv"), 0.25),
  density: pct(col(0, "density"), 0.45),
  clot: pct(col(0, "clot"), 0.75),
};
const LOOSE = SHAPES.map((_, i) => ({
  gaps: pct(col(i, "gaps"), 0.6),
  minRel: pct(col(i, "minRel"), 0.3),
  clot: pct(col(i, "clot"), 0.9),
}));

const keep = seeds.filter((_, k) => {
  const d = byShape[0][k];
  if (
    d.gaps > GATE.gaps ||
    d.minRel < GATE.minRel ||
    d.cv > GATE.cv ||
    d.density < GATE.density ||
    d.clot > GATE.clot
  ) {
    return false;
  }
  for (let i = 1; i < SHAPES.length; i++) {
    const s = byShape[i][k];
    if (s.gaps > LOOSE[i].gaps || s.minRel < LOOSE[i].minRel || s.clot > LOOSE[i].clot) {
      return false;
    }
  }
  return true;
});

say(
  `gate 1:1 gaps<=${GATE.gaps.toFixed(3)} minRel>=${GATE.minRel.toFixed(3)} cv<=${GATE.cv.toFixed(3)} density>=${GATE.density.toFixed(1)} clot<=${GATE.clot.toFixed(2)}`,
);
say(
  `loose on other aspects: ${LOOSE.slice(1)
    .map((l) => `gaps<=${l.gaps.toFixed(2)}/minRel>=${l.minRel.toFixed(2)}/clot<=${l.clot.toFixed(1)}`)
    .join("  ")}`,
);
say(`-> ${keep.length}/${N} pass`);
say(`passing: ${keep.join(", ")}`);
