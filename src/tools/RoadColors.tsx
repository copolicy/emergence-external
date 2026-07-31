import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import snapshotUrl from "../data/sf-bay-roads.json?url";
import AspectRatioControl from "../components/AspectRatioControl";
import ExportButtons from "../components/ExportButtons";
import ParamValueInput from "../components/ParamValueInput";
import PaletteColorRow from "../components/PaletteColorRow";
import RecordButton from "../components/RecordButton";
import {
  useCanvasRecorder,
  type RecordTimeline,
} from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { setCanvasAspectVars } from "./aspectRatio";
import { renderMagnifiedPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import { makeFade, strokeFaded, svgFadedPaths } from "./dissolveFade";
import {
  drawStamped,
  stampActive,
  stampOptsForStroke,
  traceStampPathD,
  type StampOpts,
} from "./stampTreatment";
import {
  REVEAL_ORDER,
  fetchRoads,
  geocode,
  isArterialHighway,
  loadSnapshot,
  makeProjector,
  maxPan,
  type Designation,
  type RoadData,
  type RoadWay,
  type View,
} from "./roadColorsCore";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Fixed fill-in animation duration (seconds). */
const FILL_IN_SEC = 3;

// Stable per-road key from its first coordinate, so the fade thins the same
// roads whether drawn to canvas (ordered by reveal) or SVG (grouped by type).
const wayKey = (w: RoadWay) =>
  w.pts.length
    ? (Math.round(w.pts[0].lat * 1e5) ^ Math.round(w.pts[0].lon * 1e5)) >>> 0
    : 0;

// Native preview area — the actual pixel dimensions come from the size picker
// (dimsForPreview keeps this area but reshapes to the chosen aspect ratio).
const ROAD_BASE = 1000;
const MAX_ZOOM = 16;

/**
 * What the Zoom / Offset controls edit. Placement is held as a FRACTION of the
 * furthest pan that still keeps the map covering the canvas — 0 centred, ±1
 * hard against an edge — not as a pixel offset, so one saved default frames the
 * same view at every canvas size and aspect ratio. `makeProjector` wants pixels,
 * so the fractions are resolved against `maxPan` for the current frame.
 */
interface Placement {
  zoom: number;
  offX: number;
  offY: number;
}

// The view the tool opens on, and what "Fit" returns to. Dial the sliders to a
// framing you like, then copy the three numbers here to make it the default.
const DEFAULT_PLACEMENT: Placement = { zoom: 6.55, offX: -0.1, offY: 0.04 };

/** Resolve a placement's fractional offsets into pixel pan for a w×h frame. */
function viewFor(p: Placement, w: number, h: number): View {
  const m = maxPan(w, h, p.zoom);
  return { zoom: p.zoom, panX: p.offX * m.x, panY: p.offY * m.y };
}

// Automotive vertical defaults — gold street grid on cream, matching the
// Vertical 04 reference card.
const BG = "#F5F5F2";

// Pre-fetched SF / Bay Area roads, loaded by default so no Overpass call is
// needed for the usual view. Generated into public/ as a static asset.
const SNAPSHOT_URL = snapshotUrl;

// How much ground a fetch pulls in around the geocoded centre. Settled and
// locked, so it has no slider: framing is the zoom's job, and it works on the
// data already downloaded rather than going back to Overpass for it.
const RADIUS_KM = 4;

// Linework collapsed into three clean weight tiers (major / collector /
// minor) so the network reads as an organised hierarchy rather than a finely
// graded heat-map of widths.
const WEIGHT: Record<Designation, number> = {
  "I-": 2,
  "US Hwy": 2,
  "State Hwy": 2,
  Hwy: 2,
  Blvd: 1.1,
  Ave: 1.1,
  Dr: 1.1,
  St: 0.55,
  Rd: 0.55,
  Other: 0.55,
};

const INK = "#C0B663";

// Ink treatment — the same stamp/cutout render pass the rest of the tool family
// runs, dialled in against the reference and locked, so it has no sliders. The
// stamp fuses the junctions so the grid reads as drawn rather than plotted, and
// the cutout pinches the thinnest runs into breaks.
const STAMP = 0.4;
const CUTOUT = 0.29;

// Roads thin from dense to sparse toward the bottom — settled and locked, so it
// has no toggle.
const FADE = true;

// Default line-weight multiplier for the three designation tiers below.
const LINE_WEIGHT = 0.8;

// Designations dropped when "hide highways" is on, plus OSM arterials (see core).
const HIGHWAY_TIER: Designation[] = ["I-", "US Hwy", "State Hwy", "Hwy"];

/** Order ways for drawing: by reveal order. `keep` filters individual ways. */
function orderWays(data: RoadData, keep: (w: RoadWay) => boolean): RoadWay[] {
  const out: RoadWay[] = [];
  for (const d of REVEAL_ORDER) {
    for (const w of data.ways) {
      if (w.designation === d && keep(w)) out.push(w);
    }
  }
  return out;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ready" }
  | { kind: "error"; msg: string };

export default function RoadColors({
  controlsTarget = null,
}: {
  controlsTarget?: HTMLElement | null;
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dataRef = useRef<RoadData | null>(null);
  const roadsDrawnRef = useRef(0);
  const [animating, setAnimating] = useState(false);

  const { w, h, exportDims, pxScale, config, setConfig } = useCanvasDimensions(
    ROAD_BASE,
    ROAD_BASE,
  );

  const [weight, setWeight] = useState(LINE_WEIGHT);
  const [bg, setBg] = useState(BG);
  const [ink, setInk] = useState(INK);
  // Treatment render quality: dropped while sliders scrub, 1 at rest.
  const qualityRef = useRef(1);
  const settleTimer = useRef<number | undefined>(undefined);
  const [settleTick, setSettleTick] = useState(0);

  // Location the roads are fetched around. Default matches the bundled snapshot
  // loaded on first open; typing a new place fetches it live from Overpass.
  const [place, setPlace] = useState("San Francisco, California");

  // View transform — zoom about the centre + placement. Decoupled from the
  // fetch radius, so zooming never re-downloads.
  const [placement, setPlacement] = useState<Placement>(DEFAULT_PLACEMENT);
  const view = useMemo<View>(() => viewFor(placement, w, h), [placement, w, h]);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const [data, setData] = useState<RoadData | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const colorFor = useCallback(() => safeColor(ink, INK), [ink]);

  const stampOpts = useMemo(
    () =>
      stampOptsForStroke({ stamp: STAMP, cutout: CUTOUT, lineWidth: weight }),
    [weight],
  );

  // Scrub with untreated draft linework so slider drags stay fluid; settle
  // back to the full treatment shortly after the last movement.
  const scrubbed = useCallback(
    (set: (v: number) => void) => (v: number) => {
      qualityRef.current = 0.5;
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        qualityRef.current = 1;
        setSettleTick((t) => t + 1);
      }, 160);
      set(v);
    },
    [],
  );

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const strokeFor = useCallback(
    (d: Designation, scale = 1) => weight * WEIGHT[d] * scale,
    [weight],
  );

  const keepWay = useCallback((w: RoadWay) => {
    if (HIGHWAY_TIER.includes(w.designation)) return false;
    if (isArterialHighway(w.highway)) return false;
    return true;
  }, []);

  // Draw one already-projected way.
  const drawWay = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      proj: (p: { lat: number; lon: number }) => { x: number; y: number },
      w: RoadWay,
      strokeScale = 1,
      fadeOpts: {
        keep?: ((x: number, y: number) => boolean) | null;
        alpha?: ((x: number, y: number) => number) | null;
        width?: ((x: number, y: number) => number) | null;
      } | null = null,
    ) => {
      ctx.strokeStyle = colorFor();
      const base = strokeFor(w.designation, strokeScale);
      const pts: number[] = [];
      for (const p of w.pts) {
        const q = proj(p);
        pts.push(q.x, q.y);
      }
      strokeFaded(ctx, pts, base, fadeOpts);
    },
    [colorFor, strokeFor],
  );

  // Paint the background across the whole frame.
  const prepare = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      dpr: number,
      background: string,
      mapW: number,
      mapH: number,
    ) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (background !== "transparent") {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, mapW, mapH);
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    },
    [],
  );

  // Stroke the first `count` roads in PREVIEW coordinates onto `tctx`, whose
  // transform the caller has already set. Shared by the direct draw and the
  // stamp treatment's offscreen buffer.
  const paintRoads = useCallback(
    (
      tctx: CanvasRenderingContext2D,
      d: RoadData,
      ordered: RoadWay[],
      count: number,
    ) => {
      tctx.lineCap = "round";
      tctx.lineJoin = "round";
      const proj = makeProjector(d.center, d.radius, w, h, view);
      const fieldFade = FADE ? makeFade(w, h, { seed: 7 }) : null;
      const n = Math.min(count, ordered.length);
      for (let ri = 0; ri < n; ri++) {
        const way = ordered[ri];
        drawWay(
          tctx,
          proj,
          way,
          1,
          fieldFade
            ? {
                keep: (x: number, y: number) =>
                  fieldFade.keep(wayKey(way), x, y),
                alpha: (x: number, y: number) =>
                  fieldFade.alpha(wayKey(way), x, y),
                width: (x: number, y: number) =>
                  fieldFade.width(wayKey(way), x, y),
              }
            : null,
        );
      }
    },
    [w, h, view, drawWay],
  );

  // Paint one complete frame. Geometry is always laid out at PREVIEW
  // dimensions and scaled by `scale` (dpr on the live canvas, dpr × the export
  // ratio for PNG and video), so the stamp treatment — which runs at a fixed
  // reference resolution — and the fade field produce the same ink at every
  // output size.
  const renderFrame = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      scale: number,
      d: RoadData,
      count: number,
      background: string,
      treatment: StampOpts | undefined,
    ) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (background !== "transparent") {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
      }
      const ordered = orderWays(d, keepWay);
      if (stampActive(treatment)) {
        drawStamped(ctx, scale, w, h, colorFor(), treatment, (tctx) =>
          paintRoads(tctx, d, ordered, count),
        );
        return;
      }
      paintRoads(ctx, d, ordered, count);
    },
    [w, h, keepWay, colorFor, paintRoads],
  );

  // Animate the network filling in. Cancels any prior run. Each frame appends
  // to the canvas rather than repainting, so the fill-in stays cheap across
  // tens of thousands of ways — which also means it can't run the stamp
  // treatment (a whole-frame pass). The treated result is painted once at the
  // end, when `animating` flips false.
  const animate = useCallback(
    (d: RoadData) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setAnimating(true);

      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      setCanvasAspectVars(canvas, w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const background = safeColor(bg, BG);
      prepare(ctx, dpr, background, w, h);
      const proj = makeProjector(d.center, d.radius, w, h, view);
      const ordered = orderWays(d, keepWay);
      roadsDrawnRef.current = 0;

      const fieldFade = FADE ? makeFade(w, h, { seed: 7 }) : null;
      const frames = Math.max(1, Math.round(FILL_IN_SEC * 60));
      const perFrame = Math.max(1, Math.ceil(ordered.length / frames));
      let i = 0;
      const step = () => {
        const end = Math.min(ordered.length, i + perFrame);
        for (; i < end; i++) {
          const way = ordered[i];
          drawWay(
            ctx,
            proj,
            way,
            1,
            fieldFade
              ? {
                  keep: (x, y) => fieldFade.keep(wayKey(way), x, y),
                  alpha: (x, y) => fieldFade.alpha(wayKey(way), x, y),
                  width: (x, y) => fieldFade.width(wayKey(way), x, y),
                }
              : null,
          );
        }
        roadsDrawnRef.current = i;
        if (i < ordered.length) rafRef.current = requestAnimationFrame(step);
        else {
          rafRef.current = null;
          roadsDrawnRef.current = ordered.length;
          setAnimating(false);
        }
      };
      step();
    },
    [w, h, bg, prepare, drawWay, view, keepWay],
  );

  // Instant, un-animated redraw — used for color / weight / background / size
  // tweaks so dragging a picker doesn't replay the whole fill-in. This is also
  // where the treated ink lands: the fill-in itself draws raw linework (see
  // `animate`) and the effect below re-renders through the treatment once the
  // animation settles.
  const renderStatic = useCallback(
    (d: RoadData) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setAnimating(false);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      setCanvasAspectVars(canvas, w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const total = orderWays(d, keepWay).length;
      renderFrame(
        ctx,
        dpr,
        d,
        total,
        safeColor(bg, BG),
        // While a slider is scrubbing, show untreated draft linework: the
        // treatment's breaks are resolution-sensitive, so an approximated
        // preview MISLEADS. At rest the preview is exactly the export.
        qualityRef.current < 1 ? undefined : stampOpts,
      );
      roadsDrawnRef.current = total;
    },
    [w, h, bg, keepWay, renderFrame, stampOpts],
  );

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // New data → paint the finished map straight away. The fill-in animation is
  // still there, but only when asked for (Play, or the MP4 recording): opening
  // the tool or fetching a place shouldn't hold the map back for three seconds,
  // and the static path is the treated one, so this is also the export-accurate
  // frame rather than the raw linework the fill-in draws.
  useEffect(() => {
    if (data) renderStatic(data);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setAnimating(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Style / view / size change → instant redraw, no animation. Waits out an
  // in-flight fill-in (so a Play or a recording isn't cut off mid-draw), then
  // re-fires when `animating` flips false — a size picked mid-draw is applied at
  // animation end instead of being silently dropped.
  useEffect(() => {
    if (animating) return;
    const d = dataRef.current;
    if (d) renderStatic(d);
    // settleTick re-runs the draw with the full treatment after scrubbing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weight, bg, view, ink, w, h, animating, settleTick]);

  // Load the saved Bay Area snapshot (no network round-trip to Overpass).
  const loadSaved = useCallback(async () => {
    abortRef.current?.abort();
    setStatus({ kind: "loading", msg: "Loading saved Bay Area roads…" });
    try {
      const d = await loadSnapshot(SNAPSHOT_URL);
      setPlacement(DEFAULT_PLACEMENT);
      setData(d);
      setStatus({ kind: "ready" });
    } catch (e) {
      setStatus({
        kind: "error",
        msg: (e as Error).message || "Couldn't load saved roads.",
      });
    }
  }, []);

  // Show the saved roads on first open.
  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Geocode the typed location and fetch its road network live from Overpass.
  const fetchPlace = useCallback(async () => {
    const query = place.trim();
    if (!query) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus({ kind: "loading", msg: "Finding place…" });
    try {
      const g = await geocode(query);
      if (ac.signal.aborted) return;
      setStatus({
        kind: "loading",
        msg: `Fetching roads near ${g.label.split(",")[0]}…`,
      });
      const d = await fetchRoads(
        g.lat,
        g.lon,
        RADIUS_KM * 1000,
        g.label,
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setPlacement(DEFAULT_PLACEMENT);
      setData(d);
      setStatus({ kind: "ready" });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setStatus({
        kind: "error",
        msg: (e as Error).message || "Couldn't load that place.",
      });
    }
  }, [place]);

  // Replay the fill-in animation on the current data.
  const grow = useCallback(() => {
    if (dataRef.current) animate(dataRef.current);
  }, [animate]);

  const recordName = (data?.place || "map")
    .split(",")[0]
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  const getExportRender = useCallback(() => {
    const d = dataRef.current;
    if (!d) return null;
    return {
      width: exportDims.w,
      height: exportDims.h,
      // Magnify the preview result: scale = dpr × (export/preview ratio).
      render: (ctx: CanvasRenderingContext2D, dpr: number) => {
        renderFrame(
          ctx,
          dpr * pxScale,
          d,
          roadsDrawnRef.current,
          safeColor(bg, BG),
          stampOpts,
        );
      },
    };
  }, [renderFrame, exportDims, pxScale, bg, stampOpts]);

  // Fill-in as a seekable timeline: frame `t` shows the first `t × total` ways.
  const recordTimeline = useCallback((): RecordTimeline | null => {
    const d = dataRef.current;
    if (!d) return null;
    const total = orderWays(d, keepWay).length;
    return {
      durationMs: FILL_IN_SEC * 1000,
      seek: (t) => {
        roadsDrawnRef.current = Math.round(t * total);
      },
      onFinish: () => {
        roadsDrawnRef.current = total;
      },
    };
  }, [keepWay]);

  const recorder = useCanvasRecorder(
    () => canvasRef.current,
    `map-${recordName}`,
    getExportRender,
    recordTimeline,
  );

  // The recorder walks the fill-in itself at a fixed step, so the on-screen
  // animation doesn't need to run (and can't skew the captured frames).
  const startRecord = () => recorder.start();
  const stopRecord = () => recorder.stop();

  useEffect(() => {
    if (recorder.recording) return;
    const d = dataRef.current;
    if (d) renderStatic(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.recording]);

  // ----- zoom / pan -----

  // Zoom about a point given in preview px (defaults to canvas centre). The
  // anchoring maths works in px, then converts back to fractional placement.
  const zoomAt = useCallback(
    (factor: number, mx = w / 2, my = h / 2) => {
      setPlacement((p) => {
        const nz = clamp(p.zoom * factor, 1, MAX_ZOOM);
        const k = nz / p.zoom;
        const cx = w / 2;
        const cy = h / 2;
        const from = viewFor(p, w, h);
        const m = maxPan(w, h, nz);
        const panX = clamp(mx - cx - (mx - cx - from.panX) * k, -m.x, m.x);
        const panY = clamp(my - cy - (my - cy - from.panY) * k, -m.y, m.y);
        return {
          zoom: nz,
          offX: m.x ? panX / m.x : 0,
          offY: m.y ? panY / m.y : 0,
        };
      });
    },
    [w, h],
  );

  const setZoom = useCallback(
    (z: number) => setPlacement((p) => ({ ...p, zoom: clamp(z, 1, MAX_ZOOM) })),
    [],
  );
  const setOffX = useCallback(
    (v: number) => setPlacement((p) => ({ ...p, offX: clamp(v, -1, 1) })),
    [],
  );
  const setOffY = useCallback(
    (v: number) => setPlacement((p) => ({ ...p, offY: clamp(v, -1, 1) })),
    [],
  );

  const resetView = useCallback(() => setPlacement(DEFAULT_PLACEMENT), []);

  // Mouse-wheel zoom toward the cursor. Native, non-passive so we can prevent
  // the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * w;
      const my = ((e.clientY - rect.top) / rect.height) * h;
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, mx, my);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt, w, h]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (view.zoom <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const canvas = canvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - d.x) * (w / rect.width);
    const dy = (e.clientY - d.y) * (h / rect.height);
    dragRef.current = { x: e.clientX, y: e.clientY };
    setPlacement((p) => {
      const m = maxPan(w, h, p.zoom);
      return {
        ...p,
        offX: m.x ? clamp(p.offX + dx / m.x, -1, 1) : 0,
        offY: m.y ? clamp(p.offY + dy / m.y, -1, 1) : 0,
      };
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // ----- exports -----
  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `road-colors-${recordName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadPNG = (transparent: boolean) => {
    if (!data) return;
    const total = orderWays(data, keepWay).length;
    // Pure magnification of the preview — WYSIWYG, no re-projection divergence.
    // With the stamp treatment the ink comes from a fixed-resolution bitmap,
    // so supersampling only adds a resample generation — render 1:1 instead.
    const ss = stampActive(stampOpts) ? 1 : undefined;
    void renderMagnifiedPngBlob(
      exportDims.w,
      exportDims.h,
      w,
      h,
      (ctx, scale) =>
        renderFrame(
          ctx,
          scale,
          data,
          total,
          transparent ? "transparent" : safeColor(bg, BG),
          stampOpts,
        ),
      ss,
    ).then((b) => b && download(b, "png"));
  };

  // Vector — built from the preview projection at preview dims so stroke
  // weights read exactly as on screen; SVG scales to any size losslessly.
  const downloadSVG = () => {
    if (!data) return;
    const stroke = colorFor();
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${safeColor(bg, BG)}"/>`;

    // Ink treatment: traced into real vector paths (see stampTreatment) so the
    // export survives design tools that ignore SVG filters.
    if (stampActive(stampOpts)) {
      const ordered = orderWays(data, keepWay);
      const traced = traceStampPathD(w, h, stroke, stampOpts, (tctx) =>
        paintRoads(tctx, data, ordered, ordered.length),
      );
      const treatedSvg = `${head}<path d="${traced}" fill="${stroke}" fill-rule="evenodd"/></svg>`;
      download(new Blob([treatedSvg], { type: "image/svg+xml" }), "svg");
      return;
    }

    const proj = makeProjector(data.center, data.radius, w, h, view);
    const fieldFade = FADE ? makeFade(w, h, { seed: 7 }) : null;
    const f = (n: number) => Math.round(n * 100) / 100;
    let body = "";
    for (const designation of REVEAL_ORDER) {
      const group = data.ways.filter(
        (wy) => wy.designation === designation && keepWay(wy),
      );
      if (!group.length) continue;
      const paths = group
        .map((wy) => {
          const pts: number[] = [];
          for (const p of wy.pts) {
            const q = proj(p);
            pts.push(q.x, q.y);
          }
          const fadeOpts = fieldFade
            ? {
                keep: (x: number, y: number) =>
                  fieldFade.keep(wayKey(wy), x, y),
                alpha: (x: number, y: number) =>
                  fieldFade.alpha(wayKey(wy), x, y),
                width: (x: number, y: number) =>
                  fieldFade.width(wayKey(wy), x, y),
              }
            : null;
          return svgFadedPaths(pts, strokeFor(designation), fadeOpts, f);
        })
        .join("");
      if (paths)
        body += `<g stroke="${stroke}" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
    }
    download(
      new Blob([`${head}${body}</svg>`], { type: "image/svg+xml" }),
      "svg",
    );
  };

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    stepv: number,
    onChange: (v: number) => void,
    suffix = "",
    tip = "",
  ) => (
    <label
      className={`tool-param-row${tip ? " has-tip" : ""}`}
      data-tip={tip || undefined}
    >
      <span className="tool-param-row__header">
        <span className="tool-param-row__label">{label}</span>
        <ParamValueInput
          value={value}
          min={min}
          max={max}
          step={stepv}
          suffix={suffix}
          aria-label={label}
          onChange={onChange}
        />
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={stepv}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );

  const loading = status.kind === "loading";

  const controls = (
    <>
      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Location</span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void fetchPlace();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <input
            type="text"
            value={place}
            spellCheck={false}
            placeholder="City, region, or address"
            aria-label="Map location"
            onChange={(e) => setPlace(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--ink)",
              font: "inherit",
            }}
          />
          <button
            type="submit"
            className="btn"
            disabled={loading || !place.trim()}
            style={{ justifyContent: "center" }}
          >
            {loading ? "Loading…" : "Fetch this place"}
          </button>
        </form>
      </div>

      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Canvas</span>
        <AspectRatioControl
          value={config}
          onChange={setConfig}
          disabled={loading}
        />
      </div>

      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">View</span>
        <div className="specimen-tree__sliders">
          {slider(
            "Zoom",
            placement.zoom,
            1,
            MAX_ZOOM,
            0.05,
            setZoom,
            "×",
            "How far into the map the frame is cropped. Same control as the +/− buttons and the scroll wheel.",
          )}
          {slider(
            "Offset X",
            placement.offX,
            -1,
            1,
            0.01,
            setOffX,
            "",
            "Where the crop sits horizontally: 0 is centred, ±1 is hard against an edge. A fraction of the available pan, so it frames the same view at any canvas size.",
          )}
          {slider(
            "Offset Y",
            placement.offY,
            -1,
            1,
            0.01,
            setOffY,
            "",
            "Where the crop sits vertically: 0 is centred, ±1 is hard against an edge. At Zoom 1 there is no room to pan, so the offsets do nothing until you zoom in.",
          )}
        </div>
      </div>

      <div className="specimen-tree__group">
        <div className="specimen-tree__sliders">
          {slider("Line Weight", weight, 0.3, 3, 0.01, scrubbed(setWeight))}
        </div>
        <PaletteColorRow label="Stroke Color" value={ink} onChange={setInk} />
      </div>

      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Background</span>
        <PaletteColorRow label="Color" value={bg} onChange={setBg} />
      </div>

      {data && (
        <div className="specimen-tree__group">
          <span className="specimen-tree__group-title">
            {data.ways.filter(keepWay).length} of {data.ways.length} roads
          </span>
        </div>
      )}

      <div className="specimen-tree__actions specimen-tree__actions--export rail-section">
        <ExportButtons
          onPNG={downloadPNG}
          onSVG={downloadSVG}
          disabled={!data}
        />
        <RecordButton
          recording={recorder.recording}
          progress={recorder.progress}
          supported={recorder.supported}
          disabled={!data || animating}
          onStart={startRecord}
          onStop={stopRecord}
        />
      </div>

      <div className="specimen-tree__actions rail-section">
        <button
          type="button"
          className={`btn${animating ? " is-active" : ""}`}
          onClick={grow}
          disabled={!data || animating}
        >
          {animating ? (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {animating ? "Drawing…" : "Play"}
        </button>
      </div>

      {status.kind === "error" && (
        <p style={{ color: "#fe4d64", fontSize: 13, margin: 0 }}>
          {status.msg}
        </p>
      )}
      {loading && (
        <p style={{ fontSize: 13, margin: 0, opacity: 0.7 }}>{status.msg}</p>
      )}
    </>
  );

  return (
    <>
      {controlsTarget ? createPortal(controls, controlsTarget) : null}

      <section
        className={`specimen-tree specimen-tree--viewport${controlsTarget ? "" : " specimen-tree--wide-controls"}`}
        aria-label="Map canvas"
      >
        {!controlsTarget && (
          <aside className="specimen-tree__controls">{controls}</aside>
        )}

        <div
          className="specimen-tree__canvas-wrap"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
              cursor:
                view.zoom > 1
                  ? dragRef.current
                    ? "grabbing"
                    : "grab"
                  : "default",
              touchAction: "none",
            }}
          />

          <div
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: 5,
              borderRadius: 10,
              background: "rgba(255,255,255,0.92)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.14)",
            }}
          >
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px", lineHeight: 1 }}
              onClick={() => zoomAt(1.3)}
              aria-label="Zoom in"
            >
              +
            </button>
            <span style={{ textAlign: "center", fontSize: 11, opacity: 0.65 }}>
              {view.zoom.toFixed(1)}×
            </span>
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px", lineHeight: 1 }}
              onClick={() => zoomAt(1 / 1.3)}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 8px", fontSize: 11 }}
              onClick={resetView}
              disabled={
                placement.zoom === DEFAULT_PLACEMENT.zoom &&
                placement.offX === DEFAULT_PLACEMENT.offX &&
                placement.offY === DEFAULT_PLACEMENT.offY
              }
            >
              Fit
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
