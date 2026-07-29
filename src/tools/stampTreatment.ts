// The organic ink-stamp treatment, reverse-engineered from the handoff PSD
// (a linework export run through Photoshop's Filter Gallery: Cutout, then
// Stamp with a black foreground). Both filters are emulated as blur + hard
// threshold passes:
//   1. Stamp — blur + LOW threshold: the blurred skirt reads as solid ink,
//      fattening every line toward a uniform bold weight and fusing fine
//      hair clusters.
//   2. Cutout — blur + 50% threshold on the result: the edge stays at the
//      midline (no net growth), so this pass only SIMPLIFIES the contours —
//      smoothing wiggles, rounding junctions, and pinching thin spots into
//      the organic breaks the reference shows.
//
// Shared by the Root Brush (branch) and every field tool, so the whole family
// carries the SAME ink: pass a `paint` callback that strokes the tool's raw
// linework and the pipeline handles the rest.

export interface StampOpts {
  amount: number; // 0..1 — stamp fatten/smooth pass. 0 skips the pass.
  cutout: number; // 0..1 — cutout break/simplify pass. 0 skips the pass.
  // Line weight the treatment runs against. Both pass radii scale with it, so
  // the treatment CHARACTER — how smoothed the ink is and how often it breaks
  // — stays the same at every weight, and the Line Weight slider changes only
  // the scale of the ink. Without this, thicker lines resist the same cutout
  // radius and the breaks vanish.
  lineWeight?: number;
  // Internal resolution the treatment runs at, 0..1 of full (default 1).
  // The pipeline needs several blur + pixel-readback rounds per frame, so
  // slider scrubbing drops this for responsiveness and settles at 1.
  quality?: number;
}

/** Strokes the raw linework onto the treatment buffer (transform pre-set). */
export type StampPaint = (ctx: CanvasRenderingContext2D) => void;

/** True when the treatment has any visible effect. */
export function stampActive(stamp?: StampOpts): stamp is StampOpts {
  return !!stamp && (stamp.amount > 0 || stamp.cutout > 0);
}

// Line weight the treatment radii were tuned at (the Root Brush `thickness`
// slider value); `lineWeight` is normalized against this, so the tuned
// defaults render identically.
export const TREATMENT_WEIGHT_REF = 0.13;

/**
 * `lineWeight` for tools whose Line Weight slider is a stroke width in px.
 * The field treatments are tuned at a 1px stroke; the radii then track the
 * slider so the break character survives weight changes, exactly like the
 * Root Brush's `thickness`.
 */
export function stampWeightForStroke(strokePx: number): number {
  return TREATMENT_WEIGHT_REF * Math.max(0.1, strokePx);
}

/**
 * The stamp/cutout treatment for a stroke-width tool's params, or undefined
 * when both sliders are off. Every field tool exposes the treatment through
 * the same `stamp`/`cutout` params the Root Brush uses.
 */
export function stampOptsForStroke(p: {
  stamp: number;
  cutout: number;
  lineWidth: number;
}): StampOpts | undefined {
  return p.stamp > 0 || p.cutout > 0
    ? {
        amount: p.stamp,
        cutout: p.cutout,
        lineWeight: stampWeightForStroke(p.lineWidth),
      }
    : undefined;
}

// Blur radii in preview-space px and the alpha cut levels for each pass:
//   stamp  — blur + LOW threshold: the blurred skirt reads as solid ink, so
//            the pass fattens and smooths. Radius is linear in the slider.
//   cutout — a morphological OPENING built from two blur+threshold steps:
//            erode (high cut — pinches thin spots into breaks and shaves
//            nubs), then dilate by the same radius (low cut — restores the
//            surviving ink to its original weight). Breaks without thinning:
//            a single 50% cut would instead pull both edges of a thin stroke
//            inward, visibly reducing the line weight.
const STAMP_BLUR_MAX = 5;
const STAMP_THRESHOLD = 0.08;
// Erode by ~0.55σ (Φ(0.55) of the blurred edge profile): a full sigma erodes
// the entire half-width of these thin strokes and wipes the drawing; 0.55σ
// pinches only genuinely thin spots. Dilate back slightly MORE (~0.75σ) —
// the surplus pre-compensates the final smoothing pass below.
const CUTOUT_ERODE_CUT = 0.709;
const CUTOUT_ERODE_SIGMAS = 0.55;
const CUTOUT_DILATE_CUT = 0.227;
// How deep the cutout erodes is set as a FRACTION OF THE INK'S OWN HALF-WIDTH,
// not as an absolute radius. Whether ink breaks depends on how far the erode
// eats relative to how thick the ink is, so an absolute radius made the slider
// mean a different thing at every other setting: the stamp pass fattens the
// ink, so one Line Breaks value did nothing at a high Stamp and erased the
// whole drawing at a low one. As a fraction it means the same thing at every
// Stamp and Line Weight. 0.57 is the value at which the sliders' shared
// defaults (Stamp 0.34 / Line Breaks 0.34) land on the radius the old absolute
// mapping gave them, so every tool tuned against the PSD reference is
// unchanged. Note the top of the slider still erodes thin linework away
// entirely — the half-width below is the semi-infinite-edge approximation,
// which overestimates how fat the stamp pass actually leaves a hairline.
const CUTOUT_MAX_ERODE = 0.57;
// The ink the erode measures against: the reference 1px stroke's half-width,
// plus however far the stamp pass pushed the edge out. A blurred edge cut at
// STAMP_THRESHOLD sits ~1.405σ (Φ⁻¹(1 − 0.08)) outside the original one.
const REF_HALF_WIDTH = 0.5;
const STAMP_DILATE_SIGMAS = 1.405;
// Final pass, echoing Photoshop's order (Stamp smooths AFTER Cutout breaks):
// a gentle blur + 50% cut that cleans the ragged nicks the erode leaves and
// rounds the ends of the broken fragments. Runs at a fraction of the cutout
// radius; the 50% cut's slight thinning is absorbed by the over-dilation.
const CUTOUT_SMOOTH_SCALE = 0.7;
const CUTOUT_SMOOTH_CUT = 0.5;

// The treatment always runs at this fixed resolution multiplier over the
// PREVIEW-space dimensions, regardless of the output canvas resolution.
// Blur + threshold is not scale-invariant (sub-pixel anti-aliased strokes
// fatten and break differently at different raster scales), so rendering
// the treatment once at a reference scale and stretching the result is what
// makes preview, PNG, MP4, and the traced SVG all show the SAME ink — same
// weights, same breaks.
const TREATMENT_DPR = 4;

/** The blur+threshold steps for a given treatment, radii in preview px. */
function stampSteps(stamp: StampOpts): { blur: number; cut: number }[] {
  const tScale =
    (stamp.lineWeight ?? TREATMENT_WEIGHT_REF) / TREATMENT_WEIGHT_REF;
  const stampBlur = stamp.amount * STAMP_BLUR_MAX * tScale;
  const steps = [{ blur: stampBlur, cut: STAMP_THRESHOLD }];
  if (stamp.cutout > 0) {
    const halfWidth =
      REF_HALF_WIDTH * tScale + STAMP_DILATE_SIGMAS * stampBlur;
    const erode = stamp.cutout * CUTOUT_MAX_ERODE * halfWidth;
    const r = erode / CUTOUT_ERODE_SIGMAS;
    steps.push(
      { blur: r, cut: CUTOUT_ERODE_CUT },
      { blur: r, cut: CUTOUT_DILATE_CUT },
      { blur: r * CUTOUT_SMOOTH_SCALE, cut: CUTOUT_SMOOTH_CUT },
    );
  }
  return steps;
}

// Ping-pong offscreens reused across frames so the growth animation doesn't
// allocate full canvases per tick.
let stampSrc: HTMLCanvasElement | null = null;
let stampOut: HTMLCanvasElement | null = null;
// Scratch canvases for stepped downscaling of the treated bitmap.
let stepA: HTMLCanvasElement | null = null;
let stepB: HTMLCanvasElement | null = null;

// Composite `src` onto `dctx` at dw×dh, halving in steps while the shrink
// exceeds 2×. A single drawImage beyond 2× undersamples (bilinear reads only
// a 2×2 tap), which renders the thin treated strokes with target-dependent
// raggedness — the preview and the PNG export would each alias differently.
function blitSteppedDown(
  src: HTMLCanvasElement,
  sw: number,
  sh: number,
  dctx: CanvasRenderingContext2D,
  dw: number,
  dh: number,
) {
  let cur: HTMLCanvasElement = src;
  let cw = sw;
  let ch = sh;
  let flip = true;
  while (cw > dw * 2 || ch > dh * 2) {
    // floor, not round: round(1/2)=1 would stop cw shrinking and spin forever.
    const nw = Math.max(dw, 1, Math.floor(cw / 2));
    const nh = Math.max(dh, 1, Math.floor(ch / 2));
    if (nw === cw && nh === ch) break;
    const buf = flip ? (stepA ??= document.createElement("canvas")) : (stepB ??= document.createElement("canvas"));
    flip = !flip;
    if (buf.width !== nw || buf.height !== nh) {
      buf.width = nw;
      buf.height = nh;
    }
    const bctx = buf.getContext("2d")!;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.clearRect(0, 0, nw, nh);
    bctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = buf;
    cw = nw;
    ch = nh;
  }
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(cur, 0, 0, cw, ch, 0, 0, dw, dh);
}

const inkCache = new Map<string, [number, number, number]>();
function parseInk(ink: string): [number, number, number] {
  const hit = inkCache.get(ink);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const x = c.getContext("2d")!;
  x.fillStyle = ink;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  const rgb: [number, number, number] = [d[0], d[1], d[2]];
  inkCache.set(ink, rgb);
  return rgb;
}

interface StampRender {
  canvas: HTMLCanvasElement;
  pw: number;
  ph: number;
  tDpr: number;
  /** With `captureField`: the last blur's alpha (pre-cut) and its iso level. */
  field?: Uint8ClampedArray;
  iso?: number;
}

/**
 * Execute the stamp/cutout blur+threshold chain over the painted strokes at
 * TREATMENT_DPR × preview resolution (× `quality` while scrubbing).
 * With `captureField`, the FINAL threshold is skipped and the smooth blurred
 * alpha is returned instead — its iso contour is the exact treated outline,
 * which the SVG export traces into real vector paths.
 */
function runStampPipeline(
  w: number,
  h: number,
  ink: string,
  stamp: StampOpts,
  paint: StampPaint,
  captureField = false,
): StampRender {
  const q = Math.min(1, Math.max(0.3, stamp.quality ?? 1));
  const tDpr = TREATMENT_DPR * q;
  const pw = Math.max(1, Math.round(w * tDpr));
  const ph = Math.max(1, Math.round(h * tDpr));
  const a = (stampSrc ??= document.createElement("canvas"));
  const b = (stampOut ??= document.createElement("canvas"));
  if (a.width !== pw || a.height !== ph) {
    a.width = pw;
    a.height = ph;
    b.width = pw;
    b.height = ph;
  }

  const [ir, ig, ib] = parseInk(ink);
  const thresholdAlpha = (tctx: CanvasRenderingContext2D, cut: number) => {
    const img = tctx.getImageData(0, 0, pw, ph);
    const data = img.data;
    const T = Math.max(8, Math.round(255 * cut));
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] >= T) {
        data[i] = ir;
        data[i + 1] = ig;
        data[i + 2] = ib;
        data[i + 3] = 255;
      } else {
        data[i + 3] = 0;
      }
    }
    tctx.putImageData(img, 0, 0);
  };

  const actx = a.getContext("2d")!;
  actx.setTransform(1, 0, 0, 1, 0, 0);
  actx.clearRect(0, 0, pw, ph);
  actx.setTransform(tDpr, 0, 0, tDpr, 0, 0);
  paint(actx);

  const steps = stampSteps(stamp);
  let cur = a;
  for (let i = 0; i < steps.length; i++) {
    const dst = cur === a ? b : a;
    const dctx = dst.getContext("2d")!;
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.clearRect(0, 0, pw, ph);
    dctx.filter = `blur(${steps[i].blur * tDpr}px)`;
    dctx.drawImage(cur, 0, 0);
    dctx.filter = "none";
    cur = dst;
    if (captureField && i === steps.length - 1) {
      const img = dctx.getImageData(0, 0, pw, ph);
      const field = new Uint8ClampedArray(pw * ph);
      for (let p = 0; p < field.length; p++) field[p] = img.data[p * 4 + 3];
      return {
        canvas: cur,
        pw,
        ph,
        tDpr,
        field,
        iso: Math.max(8, 255 * steps[i].cut),
      };
    }
    thresholdAlpha(dctx, steps[i].cut);
  }
  return { canvas: cur, pw, ph, tDpr };
}

/**
 * Paint `paint`'s linework through the treatment and composite the result onto
 * `ctx` (background must already be painted). The treatment runs at the fixed
 * reference resolution (see TREATMENT_DPR) and is stretched onto the output
 * canvas — preview, PNG, and MP4 all composite the SAME treated ink.
 */
export function drawStamped(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  w: number,
  h: number,
  ink: string,
  stamp: StampOpts,
  paint: StampPaint,
) {
  const treated = runStampPipeline(w, h, ink, stamp, paint);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  blitSteppedDown(
    treated.canvas,
    treated.pw,
    treated.ph,
    ctx,
    ctx.canvas.width,
    ctx.canvas.height,
  );
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function __debugStamp(
  w: number,
  h: number,
  ink: string,
  stamp: StampOpts,
  paint: StampPaint,
) {
  const t = runStampPipeline(w, h, ink, { ...stamp, quality: 1 }, paint, true);
  return { field: t.field!, pw: t.pw, ph: t.ph, iso: t.iso!, tDpr: t.tDpr };
}

export function __debugSteps(stamp: StampOpts) {
  return stampSteps(stamp);
}

export const __debugTrace = traceStampField;

/**
 * The treated ink as a single SVG path `d` (preview coords, evenodd fill).
 * Rather than embedding an SVG filter chain (which design tools like Figma
 * and Illustrator ignore, silently dropping the whole treatment), the treated
 * ink is traced into real vector paths — the export is self-contained plain
 * geometry, identical to the canvas.
 */
export function traceStampPathD(
  w: number,
  h: number,
  ink: string,
  stamp: StampOpts,
  paint: StampPaint,
): string {
  const treated = runStampPipeline(w, h, ink, { ...stamp, quality: 1 }, paint, true);
  return traceStampField(
    treated.field!,
    treated.pw,
    treated.ph,
    treated.iso!,
    1 / treated.tDpr,
  );
}

// ---- stamp outline tracing (SVG export) ------------------------------------
// Marching squares over the pipeline's final blurred alpha field, walked at
// its threshold iso-level with linear interpolation, yields smooth sub-pixel
// contours of the treated ink — the exact vector shape of blur + hard cut.
// Traced into real <path> fills so the SVG needs no filters and survives
// design tools (Figma, Illustrator) that ignore SVG filter effects.
function traceStampField(
  field: Uint8ClampedArray,
  pw: number,
  ph: number,
  iso: number,
  scale: number,
): string {
  // Grid nodes are pixel centers, padded with a zero border so ink touching
  // the canvas edge still closes into loops.
  const V = (gx: number, gy: number) =>
    gx >= 1 && gx <= pw && gy >= 1 && gy <= ph
      ? field[(gy - 1) * pw + (gx - 1)]
      : 0;

  const segs: number[] = []; // x1,y1,x2,y2 per segment, grid coords
  const lerp = (a: number, b: number) => (iso - a) / (b - a);

  for (let cy = 0; cy <= ph; cy++) {
    for (let cx = 0; cx <= pw; cx++) {
      const tl = V(cx, cy);
      const tr = V(cx + 1, cy);
      const br = V(cx + 1, cy + 1);
      const bl = V(cx, cy + 1);
      let code = 0;
      if (tl >= iso) code |= 1;
      if (tr >= iso) code |= 2;
      if (br >= iso) code |= 4;
      if (bl >= iso) code |= 8;
      if (code === 0 || code === 15) continue;

      const t = () => [cx + lerp(tl, tr), cy];
      const r = () => [cx + 1, cy + lerp(tr, br)];
      const b = () => [cx + lerp(bl, br), cy + 1];
      const l = () => [cx, cy + lerp(tl, bl)];
      const add = (p: number[], q2: number[]) =>
        segs.push(p[0], p[1], q2[0], q2[1]);

      switch (code) {
        case 1:
          add(l(), t());
          break;
        case 2:
          add(t(), r());
          break;
        case 3:
          add(l(), r());
          break;
        case 4:
          add(r(), b());
          break;
        case 5: {
          const center = (tl + tr + br + bl) / 4;
          if (center >= iso) {
            add(l(), b());
            add(t(), r());
          } else {
            add(l(), t());
            add(r(), b());
          }
          break;
        }
        case 6:
          add(t(), b());
          break;
        case 7:
          add(l(), b());
          break;
        case 8:
          add(l(), b());
          break;
        case 9:
          add(t(), b());
          break;
        case 10: {
          const center = (tl + tr + br + bl) / 4;
          if (center >= iso) {
            add(l(), t());
            add(r(), b());
          } else {
            add(t(), r());
            add(l(), b());
          }
          break;
        }
        case 11:
          add(r(), b());
          break;
        case 12:
          add(l(), r());
          break;
        case 13:
          add(t(), r());
          break;
        case 14:
          add(l(), t());
          break;
      }
    }
  }

  // Chain segments into closed loops. Shared endpoints are computed from the
  // same corner values by both adjacent cells, so their float coords match
  // exactly and a string key joins them.
  const n = segs.length / 4;
  const key = (x: number, y: number) => `${x},${y}`;
  const atPoint = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const end of [0, 1] as const) {
      const k = key(segs[i * 4 + end * 2], segs[i * 4 + end * 2 + 1]);
      const list = atPoint.get(k);
      if (list) list.push(i);
      else atPoint.set(k, [i]);
    }
  }

  const used = new Uint8Array(n);
  const loops: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const pts: number[] = [segs[s * 4], segs[s * 4 + 1]];
    let cx = segs[s * 4 + 2];
    let cy = segs[s * 4 + 3];
    // Follow matching endpoints until the loop closes (or dead-ends).
    for (;;) {
      pts.push(cx, cy);
      const candidates = atPoint.get(key(cx, cy));
      let next = -1;
      if (candidates) {
        for (const c of candidates) {
          if (!used[c]) {
            next = c;
            break;
          }
        }
      }
      if (next < 0) break;
      used[next] = 1;
      if (segs[next * 4] === cx && segs[next * 4 + 1] === cy) {
        cx = segs[next * 4 + 2];
        cy = segs[next * 4 + 3];
      } else {
        cx = segs[next * 4];
        cy = segs[next * 4 + 1];
      }
    }
    if (pts.length >= 6) loops.push(pts);
  }

  // Decimate near-collinear runs (tolerance in treatment-buffer px) so the
  // path stays a reasonable size without visibly changing the contour.
  const EPS = 0.35;
  const f = (v: number) => Math.round((v - 0.5) * scale * 100) / 100;
  const parts: string[] = [];
  for (const pts of loops) {
    const m = pts.length / 2;
    const kept: number[] = [0];
    let anchor = 0;
    for (let i = 1; i < m - 1; i++) {
      const ax = pts[anchor * 2];
      const ay = pts[anchor * 2 + 1];
      const bx2 = pts[(i + 1) * 2];
      const by2 = pts[(i + 1) * 2 + 1];
      const px2 = pts[i * 2];
      const py2 = pts[i * 2 + 1];
      const dx = bx2 - ax;
      const dy = by2 - ay;
      const len = Math.hypot(dx, dy) || 1;
      const dist = Math.abs((px2 - ax) * dy - (py2 - ay) * dx) / len;
      if (dist > EPS) {
        kept.push(i);
        anchor = i;
      }
    }
    if (kept.length < 3) continue;
    const d: string[] = [];
    for (let ki = 0; ki < kept.length; ki++) {
      const i = kept[ki];
      d.push(
        `${ki === 0 ? "M" : "L"}${f(pts[i * 2])} ${f(pts[i * 2 + 1])}`,
      );
    }
    d.push("Z");
    parts.push(d.join(""));
  }
  return parts.join("");
}
