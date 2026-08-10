import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ParamValueInput from "../components/ParamValueInput";
import ParamRangeTrack from "../components/ParamRangeTrack";
import ToolRailControls from "../components/ToolRailControls";
import { easeGrowth, useAnimProgress, useCanvasRecorder, useGrowthTimeline } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { useScrubbedParams } from "../hooks/useScrubbedParams";
import { setCanvasAspectVars } from "./aspectRatio";
import { renderMagnifiedPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import { stampOptsForStroke } from "./stampTreatment";
import {
  BG,
  buildFlowSVG,
  buildNoiseField,
  DEFAULT_FLOW,
  FH,
  FLOW_HINTS,
  FLOW_LABELS,
  FLOW_RANGES,
  FW,
  INK,
  SLIDER_KEYS_SIMPLE,
  traceStreamlines,
  drawFlow,
  type FlowParams,
} from "./flowFieldCore";

const GROWTH_MS = 3200;

interface FlowFieldProps {
  /** Portal tool controls into this host (mode-rail panel under the field tool seg). */
  controlsTarget?: HTMLElement | null;
}

export default function FlowField({ controlsTarget = null }: FlowFieldProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h, exportDims, pxScale, config, setConfig, resetSize } = useCanvasDimensions(FW, FH);
  // `params` is the settled snapshot the canvas is built from; `liveParams`
  // tracks the cursor and drives the sliders (see useScrubbedParams).
  const {
    live: liveParams,
    committed: params,
    setParam: updateParam,
    resetParams,
  } = useScrubbedParams<FlowParams>(DEFAULT_FLOW);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  const [fade, setFade] = useState(true);

  // Stamp/cutout are render-only treatment passes — scrubbing them must not
  // re-trace the streamlines, so they're excluded from the deps.
  const lines = useMemo(
    () => traceStreamlines(buildNoiseField(w, h, params), w, h, params),
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    setCanvasAspectVars(canvas, w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawFlow(
      ctx,
      dpr,
      w,
      h,
      lines,
      params,
      safeColor(ink, INK),
      safeColor(background, BG),
      growth,
      fade,
      params.seed,
      // Always the full treatment — never a lower-resolution approximation,
      // whose breaks differ from the real result and so would MISLEAD. The
      // preview is exactly the export.
      stampOpts,
    );
  }, [lines, params, ink, background, growth, w, h, fade, stampOpts]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Animate the reveal front 0 → 1, then settle fully drawn.
  useEffect(() => {
    if (!growing) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / GROWTH_MS);
      setGrowth(easeGrowth(p));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setGrowing(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [growing]);

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
        drawFlow(
          ctx,
          dpr * pxScale,
          w,
          h,
          lines,
          params,
          safeColor(ink, INK),
          safeColor(background, BG),
          growthRef.current,
          fade,
          params.seed,
          stampOpts,
        );
      },
    }),
    [exportDims, pxScale, w, h, lines, params, ink, background, growthRef, fade, stampOpts],
  );

  const recordTimeline = useGrowthTimeline(GROWTH_MS, growthRef, setGrowth);
  const recorder = useCanvasRecorder(
    () => canvasRef.current,
    `flow-field-${params.seed}`,
    getExportRender,
    recordTimeline,
  );

  // Record the full reveal: the recorder replays the growth from empty on its
  // own fixed-step clock and stops itself at the end, so the live animation
  // stays out of the way rather than both writing `growthRef`.
  const startRecord = () => recorder.start();
  const stopRecord = () => recorder.stop();

  useEffect(() => {
    if (recorder.recording) return;
    draw();
  }, [recorder.recording, draw]);

  const reset = () => {
    setGrowing(false);
    setGrowth(1);
    resetParams(DEFAULT_FLOW);
    setInk(INK);
    setBackground(BG);
    setFade(true);
    resetSize();
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flow-field-${params.seed}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    // Vector — build from the preview lines at preview dims so stroke weights
    // read exactly as on screen; SVG scales to any size losslessly.
    const svg = buildFlowSVG(
      w,
      h,
      lines,
      params,
      safeColor(ink, INK),
      "transparent",
      fade,
      params.seed,
      stampOpts,
    );
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const downloadPNG = (transparent: boolean) => {
    // Pure magnification of the preview — WYSIWYG, no re-trace divergence.
    // With the stamp treatment the ink comes from a fixed-resolution bitmap,
    // so supersampling only adds a resample generation — render 1:1 instead.
    const ss = stampOpts ? 1 : undefined;
    void renderMagnifiedPngBlob(exportDims.w, exportDims.h, w, h, (ctx, scale) => {
      drawFlow(
        ctx,
        scale,
        w,
        h,
        lines,
        params,
        safeColor(ink, INK),
        transparent ? "transparent" : safeColor(background, BG),
        1,
        fade,
        params.seed,
        stampOpts,
      );
    }, ss).then((blob) => blob && download(blob, "png"));
  };

  const renderRow = (key: keyof FlowParams) => {
    const [min, max, step] = FLOW_RANGES[key];
    const value = liveParams[key];
    return (
      <label
        key={key}
        className="tool-param-row has-tip"
        data-tip={FLOW_HINTS[key]}
      >
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{FLOW_LABELS[key]}</span>
          <ParamValueInput
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={FLOW_LABELS[key]}
            onChange={(v) => updateParam(key, v as FlowParams[typeof key])}
          />
        </span>
        <ParamRangeTrack
          value={value}
          min={min}
          max={max}
          step={step}
          aria-label={FLOW_LABELS[key]}
          onChange={(v) => updateParam(key, v as FlowParams[typeof key])}
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
      sliders={SLIDER_KEYS_SIMPLE.map(renderRow)}
      ink={ink}
      background={background}

      onInkChange={setInk}
      onBackgroundChange={setBackground}
      strokeTip="Color of the flow lines."
      backgroundTip="Canvas background color behind the lines."
      onPNG={downloadPNG}
      onSVG={downloadSVG}
      recording={recorder.recording}
      recordProgress={recorder.progress}
      recordSupported={recorder.supported}
      onStartRecord={startRecord}
      onStopRecord={stopRecord}
      playing={growing}
      onTogglePlay={toggleGrow}
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
        aria-label="Flow field canvas"
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
