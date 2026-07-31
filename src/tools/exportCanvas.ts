import { dimsForRatio, exportScale, EXPORT_WIDTH } from "./aspectRatio";

/** Internal render multiplier — up to 3× supersample then downscale to output. */
export const EXPORT_SUPERSAMPLE = 3;

// WebKit/Safari (and iOS) refuse to allocate a canvas whose pixel AREA exceeds
// ~16.7M px (it silently clamps the backing store, which corrupts or shrinks
// the result). A 1920×1080 export supersampled 3× is 5760×3240 = 18.7M px —
// over the limit. Keep a safety margin under that ceiling.
const MAX_CANVAS_AREA = 16_000_000;

/**
 * Largest supersample factor (≤ EXPORT_SUPERSAMPLE, ≥ 1) whose backing buffer
 * stays within the canvas area limit, so exports never get silently clamped.
 */
export function safeSupersample(w: number, h: number): number {
  if (w <= 0 || h <= 0) return EXPORT_SUPERSAMPLE;
  const maxByArea = Math.sqrt(MAX_CANVAS_AREA / (w * h));
  return Math.max(1, Math.min(EXPORT_SUPERSAMPLE, maxByArea));
}

export type ExportDrawFn = (ctx: CanvasRenderingContext2D, dpr: number) => void;

/** Param keys that are pixel distances and should scale with export resolution. */
const EXPORT_STROKE_KEYS = new Set([
  "lineWidth",
  "strokeWidth",
  "cornerRadius",
  "spacing",
  "stepLen",
  "traceWidth",
  "thickness",
  "taprootThickness",
  "branchWidth",
  "corner",
  "padSize",
  "pitch",
  "dotSize",
  "branchLength",
  "arrowSize",
  "parallel",
  "nodeSize",
]);

/** Scale pixel-based stroke / spacing params so linework weight matches the preview. */
export function scaleStrokeParams<T extends object>(params: T, scale: number): T {
  if (scale === 1) return params;
  const out = { ...params } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (EXPORT_STROKE_KEYS.has(key) && typeof out[key] === "number") {
      out[key] = (out[key] as number) * scale;
    }
  }
  return out as T;
}

let hiBuffer: HTMLCanvasElement | null = null;
let hiBufferW = 0;
let hiBufferH = 0;
let stepBuffer: HTMLCanvasElement | null = null;
let loBuffer: HTMLCanvasElement | null = null;
let loBufferW = 0;
let loBufferH = 0;

function getHiBuffer(w: number, h: number): HTMLCanvasElement {
  if (!hiBuffer || hiBufferW !== w || hiBufferH !== h) {
    hiBuffer = document.createElement("canvas");
    hiBuffer.width = w;
    hiBuffer.height = h;
    hiBufferW = w;
    hiBufferH = h;
  }
  return hiBuffer;
}

function getLoBuffer(w: number, h: number): HTMLCanvasElement {
  if (!loBuffer || loBufferW !== w || loBufferH !== h) {
    loBuffer = document.createElement("canvas");
    loBuffer.width = w;
    loBuffer.height = h;
    loBufferW = w;
    loBufferH = h;
  }
  return loBuffer;
}

function blitSmooth(dst: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number) {
  dst.imageSmoothingEnabled = true;
  dst.imageSmoothingQuality = "high";
  dst.clearRect(0, 0, w, h);
  dst.drawImage(src, 0, 0, w, h);
}

/** Step down in halves for cleaner edges than a single large resize. */
function downscaleTo(
  hi: HTMLCanvasElement,
  out: HTMLCanvasElement,
  w: number,
  h: number,
): void {
  let sw = hi.width;
  let sh = hi.height;
  let src: CanvasImageSource = hi;

  if (!stepBuffer) stepBuffer = document.createElement("canvas");
  let useStep = true;

  while (sw > w * 2 || sh > h * 2) {
    const nw = Math.max(w, Math.round(sw / 2));
    const nh = Math.max(h, Math.round(sh / 2));
    const buf = useStep ? stepBuffer : out;
    if (buf.width !== nw || buf.height !== nh) {
      buf.width = nw;
      buf.height = nh;
    }
    const ctx = buf.getContext("2d");
    if (!ctx) break;
    blitSmooth(ctx, src, nw, nh);
    src = buf;
    sw = nw;
    sh = nh;
    useStep = !useStep;
  }

  const octx = out.getContext("2d");
  if (!octx) return;
  blitSmooth(octx, src, w, h);
}

/**
 * Render at `dpr`× supersample, downscale to `w`×`h`, return PNG blob.
 * Pass `dpr` through to draw helpers — they call setTransform(dpr, …) themselves.
 */
export function renderPngBlob(
  w: number,
  h: number,
  draw: ExportDrawFn,
): Promise<Blob | null> {
  const dpr = safeSupersample(w, h);
  const hi = getHiBuffer(Math.round(w * dpr), Math.round(h * dpr));
  const hiCtx = hi.getContext("2d");
  if (!hiCtx) return Promise.resolve(null);
  hiCtx.setTransform(1, 0, 0, 1, 0, 0);
  hiCtx.clearRect(0, 0, hi.width, hi.height);
  draw(hiCtx, dpr);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  downscaleTo(hi, out, w, h);
  return new Promise((resolve) => {
    out.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * Export a result as a pure magnification of the preview. The draw fn renders
 * the SAME (preview-resolution) result through a scale transform, so geometry,
 * stroke widths, and any minimum-width floor all scale together — the output is
 * exactly what's on screen, just larger. Internally renders at `ss`× and does a
 * single high-quality downscale (no repeated halving, which softens thin lines).
 *
 * `draw(ctx, scale)` should call the tool's normal draw helper with `scale` in
 * place of `dpr` and the PREVIEW dimensions/result, e.g.
 *   drawRoots(ctx, scale, srcW, srcH, previewResult, …)
 * `scale` maps preview coordinates onto the supersampled buffer.
 */
export function renderMagnifiedPngBlob(
  outW: number,
  outH: number,
  srcW: number,
  _srcH: number,
  draw: (ctx: CanvasRenderingContext2D, scale: number) => void,
  ss = 2,
): Promise<Blob | null> {
  // Clamp the supersample so the buffer stays under the canvas-area cap.
  const eff = Math.max(1, Math.min(ss, safeSupersample(outW, outH)));
  const hiW = Math.round(outW * eff);
  const hiH = Math.round(outH * eff);
  const hi = document.createElement("canvas");
  hi.width = hiW;
  hi.height = hiH;
  const hiCtx = hi.getContext("2d");
  if (!hiCtx) return Promise.resolve(null);
  // preview coords → supersampled buffer pixels
  draw(hiCtx, (outW / srcW) * eff);

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");
  if (!octx) return Promise.resolve(null);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(hi, 0, 0, outW, outH);
  return new Promise((resolve) => out.toBlob((blob) => resolve(blob), "image/png"));
}

/**
 * Paint one export frame at 1:1 — no supersample/downscale. Used by the video
 * recorder so each frame fills the full output buffer without shared-buffer races.
 */
export function blitExportFrameDirect(
  target: CanvasRenderingContext2D,
  w: number,
  h: number,
  draw: ExportDrawFn,
): void {
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, w, h);
  draw(target, 1);
}

/**
 * Paint one export frame: supersample draw → downscale blit onto `target`.
 * Used by PNG export for maximum sharpness.
 */
export function blitExportFrame(
  target: CanvasRenderingContext2D,
  w: number,
  h: number,
  draw: ExportDrawFn,
): void {
  const dpr = safeSupersample(w, h);
  const hi = getHiBuffer(Math.round(w * dpr), Math.round(h * dpr));
  const hiCtx = hi.getContext("2d");
  if (!hiCtx) return;
  hiCtx.setTransform(1, 0, 0, 1, 0, 0);
  hiCtx.clearRect(0, 0, hi.width, hi.height);
  draw(hiCtx, dpr);

  const lo = getLoBuffer(w, h);
  downscaleTo(hi, lo, w, h);

  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, w, h);
  target.drawImage(lo, 0, 0);
}

/** Preview → export width ratio for aspect-ratio tools. @deprecated use exportScale */
export function exportScaleForRatio(
  ratioId: string,
  baseW: number,
  baseH: number,
): number {
  const preview = dimsForRatio(ratioId, baseW, baseH);
  return exportScale(preview.w, EXPORT_WIDTH);
}

/** Preview → export width ratio for image-sized tools. */
export function exportScaleFromSize(previewW: number): number {
  if (previewW <= 0) return 1;
  return EXPORT_WIDTH / previewW;
}
