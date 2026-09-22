import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ParamValueInput from "../components/ParamValueInput";
import ParamRangeTrack from "../components/ParamRangeTrack";
import ToolRailControls from "../components/ToolRailControls";
import { useAnimProgress, useCanvasRecorder, useGrowthTimeline } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { usePlayIn } from "../hooks/usePlayIn";
import { useScrubbedParams } from "../hooks/useScrubbedParams";
import { setCanvasAspectVars } from "./aspectRatio";
import { renderMagnifiedPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import { stampOptsForStroke } from "./stampTreatment";
import {
  BG,
  buildSignalSVG,
  computeSignal,
  DEFAULT_SIGNAL,
  drawSignal,
  INK,
  SH,
  SIGNAL_HINTS,
  SIGNAL_LABELS,
  SIGNAL_RANGES,
  SLIDER_KEYS_SIMPLE_SIGNAL,
  SW,
  type SignalParams,
} from "./signalCore";

// Deliberately longer than the 10s the rest of the family runs at: the signal
// rings sweep outward across the whole frame at once, which reads faster than
// the other fields at the same duration.
const GROWTH_MS = 12000;

interface SignalProps {
  controlsTarget?: HTMLElement | null;
}

export default function Signal({ controlsTarget = null }: SignalProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h, exportDims, pxScale, config, setConfig, resetSize } =
    useCanvasDimensions(SW, SH);
  // `params` is the settled snapshot the canvas is built from; `liveParams`
  // tracks the cursor and drives the sliders (see useScrubbedParams).
  const {
    live: liveParams,
    committed: params,
    setParam: updateParam,
    resetParams,
  } = useScrubbedParams<SignalParams>(DEFAULT_SIGNAL);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  const [fade, setFade] = useState(true);

  // Stamp/cutout are render-only treatment passes — scrubbing them must not
  // re-trace the rings, so they're excluded from the deps.
  const lines = useMemo(
    () => computeSignal(w, h, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      w,
      h,
      ...Object.entries(params)
        .filter(([k]) => k !== "stamp" && k !== "cutout")
        .map(([, v]) => v),
    ],
  );

  // Ink-stamp treatment — a render-level pass shared with the Root Brush.
  const stampOpts = useMemo(
    () => stampOptsForStroke(params),
    [params.stamp, params.cutout, params.lineWidth],
  );

  // `progressOverride` is the play-in's own position; omitted (every settled
  // draw) means progress-from-state.
  const draw = useCallback((progressOverride?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Assigning width/height reallocates and clears the backing store, so only
    // do it when the size actually changed — this runs on every play-in frame.
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    setCanvasAspectVars(canvas, w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawSignal(
      ctx,
      dpr,
      w,
      h,
      lines,
      safeColor(ink, INK),
      safeColor(background, BG),
      progressOverride ?? growth,
      fade,
      params.seed,
      // Always the full treatment — never a lower-resolution approximation,
      // whose breaks differ from the real result and so would MISLEAD. The
      // preview is exactly the export.
      stampOpts,
    );
  }, [lines, ink, background, growth, w, h, fade, params.seed, stampOpts]);

  useEffect(() => {
    draw();
  }, [draw]);

  // The play-in paints through this rather than through state — see usePlayIn.
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });

  usePlayIn(growing, setGrowing, GROWTH_MS, growthRef, setGrowth, drawRef);

  const toggleGrow = () => {
    if (growing) {
      setGrowing(false);
      setGrowth(1);
      return;
    }
    setGrowth(0);
    setGrowing(true);
  };

  const getExportRender = useCallback(
    () => ({
      width: exportDims.w,
      height: exportDims.h,
      // Magnify the preview result: scale = dpr × (export/preview ratio).
      render: (ctx: CanvasRenderingContext2D, dpr: number) => {
        drawSignal(
          ctx,
          dpr * pxScale,
          w,
          h,
          lines,
          safeColor(ink, INK),
          safeColor(background, BG),
          growthRef.current,
          fade,
          params.seed,
          stampOpts,
        );
      },
    }),
    [exportDims, pxScale, w, h, lines, ink, background, growthRef, fade, params.seed, stampOpts],
  );

  const recordTimeline = useGrowthTimeline(GROWTH_MS, growthRef, setGrowth);
  const recorder = useCanvasRecorder(
    () => canvasRef.current,
    `signal-${params.seed}`,
    getExportRender,
    recordTimeline,
  );

  // The recorder replays the growth on its own fixed-step clock and stops
  // itself at the end — the live animation stays out of the way so the two
  // aren't both writing `growthRef`.
  const startRecord = () => recorder.start();
  const stopRecord = () => recorder.stop();

  useEffect(() => {
    if (recorder.recording) return;
    draw();
  }, [recorder.recording, draw]);

  const reset = () => {
    setGrowing(false);
    setGrowth(1);
    resetParams(DEFAULT_SIGNAL);
    setInk(INK);
    setBackground(BG);
    setFade(true);
    resetSize();
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `signal-${params.seed}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    if (!lines.length) return;
    // Vector — build from the preview lines at preview dims so stroke weights
    // read exactly as on screen; SVG scales to any size losslessly.
    const svg = buildSignalSVG(
      w,
      h,
      lines,
      safeColor(ink, INK),
      "transparent",
      fade,
      params.seed,
      stampOpts,
    );
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const downloadPNG = (transparent: boolean) => {
    if (!lines.length) return;
    // Pure magnification of the preview — WYSIWYG, no re-trace divergence.
    // With the stamp treatment the ink comes from a fixed-resolution bitmap,
    // so supersampling only adds a resample generation — render 1:1 instead.
    const ss = stampOpts ? 1 : undefined;
    void renderMagnifiedPngBlob(exportDims.w, exportDims.h, w, h, (ctx, scale) => {
      drawSignal(
        ctx,
        scale,
        w,
        h,
        lines,
        safeColor(ink, INK),
        transparent ? "transparent" : safeColor(background, BG),
        1,
        fade,
        params.seed,
        stampOpts,
      );
    }, ss).then((blob) => blob && download(blob, "png"));
  };

  const renderRow = (key: keyof SignalParams) => {
    const [min, max, step] = SIGNAL_RANGES[key];
    const value = liveParams[key];
    return (
      <label
        key={key}
        className="tool-param-row has-tip"
        data-tip={SIGNAL_HINTS[key]}
      >
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{SIGNAL_LABELS[key]}</span>
          <ParamValueInput
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={SIGNAL_LABELS[key]}
            onChange={(v) => updateParam(key, v as SignalParams[typeof key])}
          />
        </span>
        <ParamRangeTrack
          value={value}
          min={min}
          max={max}
          step={step}
          aria-label={SIGNAL_LABELS[key]}
          onChange={(v) => updateParam(key, v as SignalParams[typeof key])}
        />
      </label>
    );
  };

  const controls = (
    <ToolRailControls
      config={config}
      onConfigChange={setConfig}
      fade={fade}
      onFadeChange={setFade}
      sliders={SLIDER_KEYS_SIMPLE_SIGNAL.map(renderRow)}
      ink={ink}
      background={background}
      onInkChange={setInk}
      onBackgroundChange={setBackground}
      strokeTip="Color of the signal rings."
      backgroundTip="Canvas background color behind the rings."
      onPNG={downloadPNG}
      onSVG={downloadSVG}
      exportDisabled={!lines.length}
      recording={recorder.recording}
      recordProgress={recorder.progress}
      recordSupported={recorder.supported}
      onStartRecord={startRecord}
      onStopRecord={stopRecord}
      playing={growing}
      onTogglePlay={toggleGrow}
      playDisabled={!lines.length}
      playLabel="Play"
      playingLabel="Drawing…"
      onReset={reset}
    />
  );

  return (
    <>
      {controlsTarget ? createPortal(controls, controlsTarget) : null}

      <section
        className={`specimen-tree specimen-tree--viewport${controlsTarget ? "" : " specimen-tree--wide-controls"}`}
        aria-label="Telecom signal canvas"
      >
        {!controlsTarget && (
          <aside className="specimen-tree__controls">{controls}</aside>
        )}

        <div className="specimen-tree__canvas-wrap">
          <canvas ref={canvasRef} className="specimen-tree__canvas" />
        </div>
      </section>
    </>
  );
}
