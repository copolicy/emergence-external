export const W = 680;
export const H = 580;
export const INK = "#00280F";
export const DEFAULT_FOLIAGE_COLOR = "#2e4c30";

export interface TreeParams {
  seed: number;
  decay: number;
  spread: number;
  depth: number;
  trunkLen: number;
  lean: number;
  scale: number;
  wobble: number;
  jitter: number;
  fork: number;
  minLen: number;
  foliage: number;
  foliageSize: number;
  foliageOpacity: number;
}

export const DEFAULT_PARAMS: TreeParams = {
  seed: 54724,
  decay: 0.85,
  spread: 1,
  depth: 8,
  trunkLen: 98,
  lean: 0,
  scale: 1,
  wobble: 0.16,
  jitter: 0.19,
  fork: 0.5,
  minLen: 6,
  foliage: 0.8,
  foliageSize: 1,
  foliageOpacity: 0.85,
};

export const RANGES: Record<keyof TreeParams, [number, number, number]> = {
  seed: [1, 99999, 1],
  decay: [0.6, 0.95, 0.01],
  spread: [0.4, 3.2, 0.05],
  depth: [3, 16, 1],
  trunkLen: [20, 200, 1],
  lean: [-1.2, 1.2, 0.01],
  scale: [0.4, 2.5, 0.05],
  wobble: [0, 1, 0.01],
  jitter: [0, 1.5, 0.01],
  fork: [0, 1, 0.01],
  minLen: [1, 10, 0.5],
  foliage: [0, 1, 0.01],
  foliageSize: [0.3, 4, 0.1],
  foliageOpacity: [0.1, 1, 0.05],
};

export const PARAM_LABELS: Record<keyof TreeParams, string> = {
  seed: "Seed",
  decay: "Decay",
  spread: "Spread",
  depth: "Depth",
  trunkLen: "Trunk Length",
  lean: "Lean",
  scale: "Scale",
  wobble: "Wobble",
  jitter: "Jitter",
  fork: "Fork Chance",
  minLen: "Min Branch",
  foliage: "Density",
  foliageSize: "Leaf Size",
  foliageOpacity: "Opacity",
};

export const PARAM_HINTS: Record<keyof TreeParams, string> = {
  seed: "Random starting value. Same seed always produces the same tree.",
  decay:
    "How much each child branch shrinks. Higher values grow longer branches.",
  spread: "How wide branches fan out from their parent.",
  depth: "How many times branches split. More depth means more detail.",
  trunkLen: "Length of the main trunk from the base.",
  lean: "Tilts the whole tree left or right.",
  scale: "Overall size multiplier from the base.",
  wobble: "How much branch curves bend and sway.",
  jitter: "Random variation in branch angles — higher feels more abstract.",
  fork: "Chance of splitting into three branches instead of two.",
  minLen: "Shortest branch before stopping. Lower values add wispy twigs.",
  foliage: "How often dots appear at tips. Zero is lines only.",
  foliageSize: "Overall size of the foliage dots.",
  foliageOpacity: "How solid the foliage dots are.",
};

export const GENERAL_KEYS: (keyof TreeParams)[] = ["seed", "lean", "scale"];
export const BRANCH_KEYS: (keyof TreeParams)[] = [
  "trunkLen",
  "decay",
  "spread",
  "depth",
  "wobble",
  "jitter",
  "fork",
  "minLen",
];
export const FOLIAGE_KEYS: (keyof TreeParams)[] = [
  "foliage",
  "foliageSize",
  "foliageOpacity",
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeColor(c: string, fallback: string) {
  return HEX_RE.test(c) ? c : fallback;
}

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FoliageColor = string | ((x: number, y: number) => string);

interface DrawSink {
  line(
    x: number,
    y: number,
    mx: number,
    my: number,
    nx: number,
    ny: number,
    width: number,
    level: number,
  ): void;
  dot(
    x: number,
    y: number,
    r: number,
    color: string,
    alpha: number,
    level: number,
  ): void;
}

function resolveColor(color: FoliageColor, x: number, y: number) {
  return typeof color === "function" ? color(x, y) : color;
}

function walkTree(
  sink: DrawSink,
  x: number,
  y: number,
  ang: number,
  len: number,
  d: number,
  params: TreeParams,
  rand: () => number,
  showBranches: boolean,
  showFoliage: boolean,
  foliageColor: FoliageColor,
) {
  const { decay, spread, wobble, jitter, fork, minLen, foliage } = params;

  if (d <= 0 || len < minLen) {
    if (rand() < foliage && showFoliage) {
      const r = (0.9 + rand() * 1.5) * params.foliageSize;
      sink.dot(
        x,
        y,
        r,
        resolveColor(foliageColor, x, y),
        params.foliageOpacity,
        params.depth - d,
      );
    }
    return;
  }

  const nx = x + Math.cos(ang) * len;
  const ny = y + Math.sin(ang) * len;
  const mx = (x + nx) / 2 + (rand() - 0.5) * len * wobble;
  const my = (y + ny) / 2 + (rand() - 0.5) * len * wobble;

  if (showBranches) {
    sink.line(x, y, mx, my, nx, ny, Math.max(0.25, d * 0.2), params.depth - d);
  }

  const k = rand() < fork ? 3 : 2;
  for (let i = 0; i < k; i++) {
    const off = (i / (k - 1) - 0.5) * spread + (rand() - 0.5) * jitter;
    walkTree(
      sink,
      nx,
      ny,
      ang + off,
      len * decay * (0.68 + rand() * 0.48),
      d - 1,
      params,
      rand,
      showBranches,
      showFoliage,
      foliageColor,
    );
  }
}

export function renderTree(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  params: TreeParams,
  showBranches: boolean,
  showFoliage: boolean,
  foliageColor: FoliageColor,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const rand = mulberry32(params.seed);
  const originX = W * 0.5;
  const originY = H - 20;

  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(params.scale, params.scale);

  const sink: DrawSink = {
    line(x, y, mx, my, nx, ny, width) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(mx, my, nx, ny);
      ctx.stroke();
    },
    dot(x, y, r, color, alpha) {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
  };

  walkTree(
    sink,
    0,
    0,
    -Math.PI / 2 + params.lean,
    params.trunkLen,
    params.depth,
    params,
    rand,
    showBranches,
    showFoliage,
    foliageColor,
  );
  ctx.restore();
}

export function buildTreeSVG(
  params: TreeParams,
  showBranches: boolean,
  showFoliage: boolean,
  foliageColor: string,
) {
  const rand = mulberry32(params.seed);
  const originX = W * 0.5;
  const originY = H - 20;
  const parts: string[] = [];
  const f = (n: number) => Math.round(n * 100) / 100;

  const sink: DrawSink = {
    line(x, y, mx, my, nx, ny, width) {
      parts.push(
        `<path d="M${f(x)} ${f(y)} Q${f(mx)} ${f(my)} ${f(nx)} ${f(ny)}" fill="none" stroke="${INK}" stroke-width="${f(width)}"/>`,
      );
    },
    dot(x, y, r, color, alpha) {
      parts.push(
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}" opacity="${alpha}"/>`,
      );
    },
  };

  walkTree(
    sink,
    0,
    0,
    -Math.PI / 2 + params.lean,
    params.trunkLen,
    params.depth,
    params,
    rand,
    showBranches,
    showFoliage,
    foliageColor,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g transform="translate(${originX} ${originY}) scale(${params.scale})">${parts.join("")}</g></svg>`;
}

export type TreeOp =
  | {
      kind: "line";
      x: number;
      y: number;
      mx: number;
      my: number;
      nx: number;
      ny: number;
      width: number;
      level: number;
    }
  | {
      kind: "dot";
      x: number;
      y: number;
      r: number;
      color: string;
      alpha: number;
      level: number;
    };

// Collect the tree's draw operations ordered by depth level, so they can be
// revealed progressively (trunk first, branches outward, foliage last) for a
// "growing in" animation.
export function collectTreeOps(
  params: TreeParams,
  showBranches: boolean,
  showFoliage: boolean,
  foliageColor: FoliageColor,
): TreeOp[] {
  const rand = mulberry32(params.seed);
  const ops: TreeOp[] = [];
  const sink: DrawSink = {
    line(x, y, mx, my, nx, ny, width, level) {
      ops.push({ kind: "line", x, y, mx, my, nx, ny, width, level });
    },
    dot(x, y, r, color, alpha, level) {
      ops.push({ kind: "dot", x, y, r, color, alpha, level });
    },
  };
  walkTree(
    sink,
    0,
    0,
    -Math.PI / 2 + params.lean,
    params.trunkLen,
    params.depth,
    params,
    rand,
    showBranches,
    showFoliage,
    foliageColor,
  );
  ops.sort((a, b) => a.level - b.level);
  return ops;
}

export function renderTreeOps(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  params: TreeParams,
  ops: TreeOp[],
  count: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W * 0.5, H - 20);
  ctx.scale(params.scale, params.scale);

  const n = Math.min(Math.floor(count), ops.length);
  for (let i = 0; i < n; i++) {
    const op = ops[i];
    if (op.kind === "line") {
      ctx.strokeStyle = INK;
      ctx.lineWidth = op.width;
      ctx.beginPath();
      ctx.moveTo(op.x, op.y);
      ctx.quadraticCurveTo(op.mx, op.my, op.nx, op.ny);
      ctx.stroke();
    } else {
      ctx.fillStyle = op.color;
      ctx.globalAlpha = op.alpha;
      ctx.beginPath();
      ctx.arc(op.x, op.y, op.r, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function randomInRange([min, max]: [number, number, number]) {
  return min + Math.random() * (max - min);
}

function roundTo(value: number, step: number) {
  return Math.round(value / step) * step;
}

export function randomParams(): TreeParams {
  return {
    seed: Math.floor(randomInRange(RANGES.seed)),
    decay: roundTo(randomInRange(RANGES.decay), 0.01),
    spread: roundTo(randomInRange(RANGES.spread), 0.05),
    depth: Math.round(randomInRange(RANGES.depth)),
    trunkLen: Math.round(randomInRange(RANGES.trunkLen)),
    lean: roundTo(randomInRange(RANGES.lean), 0.01),
    scale: roundTo(randomInRange(RANGES.scale), 0.05),
    wobble: roundTo(randomInRange(RANGES.wobble), 0.01),
    jitter: roundTo(randomInRange(RANGES.jitter), 0.01),
    fork: roundTo(randomInRange(RANGES.fork), 0.01),
    minLen: roundTo(randomInRange(RANGES.minLen), 0.5),
    foliage: roundTo(randomInRange(RANGES.foliage), 0.01),
    foliageSize: roundTo(randomInRange(RANGES.foliageSize), 0.1),
    foliageOpacity: roundTo(randomInRange(RANGES.foliageOpacity), 0.05),
  };
}
