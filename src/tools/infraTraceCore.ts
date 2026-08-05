import { DEFAULT_FLOW, FH, FW, type FlowLine } from "./flowFieldCore";
import { mulberry32 } from "./specimenTreeCore";
import { TRACE_ASPECT, TRACE_PATHS, TRACE_WEIGHT } from "./infraTraceData";
import type { JaggedParams } from "./jaggedCore";

// Infra Testing — the reference artwork itself, as vector geometry rather than a
// generated approximation of it. See `infraTraceData` for how it was recovered.
//
// The composition is fixed — there is no routing here. `seed` and `variation` vary
// this artwork (orientation, which traces are laid, where ends fray) rather than
// composing a new one, so the geometry is always the reference's own.
export const IW = FW;
export const IH = FH;
export const INK = "#195519"; // Mid green
export const BG = "#F5F5F2"; // Cream

export interface InfraTraceParams extends JaggedParams {
  /** Fit inside the canvas (letterbox) rather than filling it. */
  scale: number;
  /** Ink inset from the canvas edge, as a fraction of the short side. */
  inset: number;
  /** Mirror horizontally. The source SVG mirrors the artwork, so this starts on. */
  mirror: number;
  /** Shift the artwork across the canvas, as a fraction of canvas width. */
  nudgeX: number;
  /** Shift the artwork up or down the canvas, as a fraction of canvas height. */
  nudgeY: number;
  /**
   * How far the seed is allowed to depart from the reference. At 0 the artwork is
   * exactly as traced and the seed does nothing.
   *
   * The seed varies *this* composition — orientation, which traces are laid, and
   * where their ends fray — rather than composing a new one. Every corner, pitch and
   * ribbon stays the reference's own geometry, so no setting can wander off-style;
   * equally, no setting produces a genuinely different board. That would mean cutting
   * the trace into motifs and recombining them, which is a different job.
   */
  variation: number;
}

export const DEFAULT_INFRA_TRACE: InfraTraceParams = {
  ...(DEFAULT_FLOW as unknown as JaggedParams),
  seed: 3939,
  // Tuned composition for the Infrastructure vertical (1:1 canvas).
  lineWidth: 0.8,
  scale: 1.11,
  inset: 0.04,
  mirror: 1,
  nudgeX: 0.055,
  nudgeY: -0.105,
  // On, because `variation` gates everything the seed does and a Seed slider that
  // needs a second slider raised before it responds reads as broken — every other
  // tool here varies on seed alone. Drop this to 0 to get the reference back exactly
  // as traced, which is the comparison this vertical exists for.
  variation: 0.45,
  stamp: 0,
  cutout: 0,
};

export const INFRA_TRACE_RANGES: Record<string, [number, number, number]> = {
  seed: [1, 9999, 1],
  variation: [0, 1, 0.02],
  lineWidth: [0.2, 3, 0.05],
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
  seed: "Which variation of the traced artwork is drawn. Does nothing at Variation 0, where the board is the reference exactly as traced.",
  variation:
    "How far the seed may depart from the reference: it flips the orientation, drops some of the shorter traces, and moves where ends fray. The geometry is always the reference's own, so this cannot wander off-style — and equally it cannot compose a different board. That would mean cutting the trace into motifs and recombining them.",
  lineWidth:
    "Multiplies the reference's own stroke weight. At 1 the ratio of pitch to weight matches the artwork exactly (3.14); above that the ribbons start to close up into solid bands.",
  scale:
    "How much of the canvas the artwork fills. One covers it exactly at any aspect; below one opens margins, above one crops further in. The artwork's own aspect is fixed, so filling a canvas shaped differently crops rather than stretches — stretching would take the pitch off in one axis and the 45° mitres off 45°.",
  inset: "Clear margin held between the artwork and the canvas edge.",
  mirror:
    "Flips the artwork horizontally. The reference SVG mirrors its own bitmap, so this starts on — off shows the untransformed trace, ribbons entering from the left.",
  nudgeX:
    "Shifts the artwork left or right, as a fraction of the canvas width.",
  nudgeY:
    "Shifts the artwork up or down; negative is up. Only needed to choose *which* part shows when Scale crops — the fit itself is automatic.",
  stamp:
    "Ink-stamp fatten pass. Spreads and smooths the linework into solid ink.",
  cutout:
    "Cutout pass — pinches thin spots into organic breaks and dashes without thickening the line.",
};

export const SLIDER_KEYS_INFRA_TRACE: string[] = [
  "seed",
  "variation",
  "scale",
  "nudgeX",
  "nudgeY",
  "inset",
  "lineWidth",
  "stamp",
  "cutout",
];

/**
 * Fit the traced artwork to the canvas and hand it back as ordinary `FlowLine`s, so
 * the existing draw and SVG-export passes can render it unchanged.
 *
 * `order` runs along the path list so the growth animation draws the board on in the
 * order the traces were recovered, which reads near enough to ribbon by ribbon.
 */
export function computeInfraTrace(
  w: number,
  h: number,
  p: InfraTraceParams,
): FlowLine[] {
  const inset = Math.min(w, h) * p.inset;
  const availW = Math.max(1, w - inset * 2);
  const availH = Math.max(1, h - inset * 2);
  // Cover, then centre — the same thing the generated verticals do, which is reflow
  // to whatever canvas they are handed. The artwork's aspect is baked, so filling a
  // canvas of a different one means cropping the excess; the alternative is stretching
  // it, and that would put the pitch off in one axis and take the 45° mitres off 45°.
  //
  // This used to *contain* the artwork instead, which letterboxed on every aspect and
  // left the fit to be recovered by hand with Scale and the offsets. `scale` 1 now
  // means exactly cover, below 1 opens margins, above 1 crops in further.
  const fit = Math.max(availW / TRACE_ASPECT, availH) * p.scale;
  const artW = fit * TRACE_ASPECT;
  const artH = fit;
  // Coalesced, not assumed present: a param added to the defaults does not appear in
  // a component's existing state until it remounts, and one `undefined` here turns
  // every coordinate into NaN and blanks the canvas rather than failing visibly.
  const weight = Math.max(0.15, TRACE_WEIGHT * artH * p.lineWidth);
  const n = TRACE_PATHS.length;

  // `variation` gates everything the seed does, so at 0 this is the reference exactly
  // as traced however the seed is set.
  const v = Math.max(0, Math.min(1, p.variation));
  const rand = mulberry32((p.seed | 0) ^ 0x2f6b3c1d);

  // Where the crop sits. Covering a canvas of a different aspect leaves the artwork
  // overhanging on one axis, and which part of the board that reveals is a real
  // compositional choice — so the seed makes it. This is the one seeded effect that
  // changes what the picture is *of* rather than only how it is dressed, and it costs
  // nothing, because the slack already exists.
  const slackX = Math.max(0, artW - w);
  const slackY = Math.max(0, artH - h);
  // Coalesced, not assumed present: a param added to the defaults does not appear in
  // a component's existing state until it remounts, and one `undefined` here turns
  // every coordinate into NaN and blanks the canvas rather than failing visibly.
  const ox = (w - artW) / 2 + slackX * (rand() - 0.5) * v + (p.nudgeX ?? 0) * w;
  const oy = (h - artH) / 2 + slackY * (rand() - 0.5) * v + (p.nudgeY ?? 0) * h;
  // Orientation first, and only ever a flip — the artwork is octilinear, so mirroring
  // keeps every heading on the same eight and reads as a different board rather than a
  // tilted copy. A rotation would put the curtain on a side it never hangs from.
  //
  // Weighted high, because orientation is by far the most legible of the three and a
  // seed that only drops a few stubs looks like it did nothing. At the default this
  // spreads seeds fairly evenly over the four flips.
  const flipY = v > 0 && rand() < v * 0.9;
  const flip = p.mirror >= 0.5 !== (v > 0 && rand() < v * 0.9);

  const out: FlowLine[] = [];
  for (let i = 0; i < n; i++) {
    const src = TRACE_PATHS[i];
    // Paths are ordered shortest first, so `i / n` is roughly a length percentile.
    // Dropping is weighted to the short end: losing a stub reads as a board routed a
    // little differently, losing a long sweep reads as damage.
    const shortness = 1 - i / Math.max(1, n - 1);
    if (v > 0 && rand() < v * 0.45 * shortness * shortness) continue;

    // Fray: pull an end back along its own path. Only ever shortens, and only from one
    // end, so a trace still starts where the reference put it.
    const trim = v > 0 && rand() < v * 0.35 ? 1 - rand() * v * 0.25 : 1;
    const last =
      trim < 1 ? Math.max(2, Math.round(src.length * trim)) : src.length;

    const pts: number[] = [];
    for (let k = 0; k < last; k++) {
      const [nx0, ny0] = src[k];
      const nx = flip ? 1 - nx0 : nx0;
      const ny = flipY ? 1 - ny0 : ny0;
      pts.push(ox + nx * artW, oy + ny * artH);
    }
    if (pts.length < 4) continue;
    out.push({
      pts,
      w: weight,
      order: n > 1 ? i / (n - 1) : 1,
      arrow: false,
    });
  }
  return out;
}
