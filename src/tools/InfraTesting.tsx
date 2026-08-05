import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ParamValueInput from "../components/ParamValueInput";
import ToolRailControls from "../components/ToolRailControls";
import {
  easeGrowth,
  useAnimProgress,
  useCanvasRecorder,
  useGrowthTimeline,
} from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { setCanvasAspectVars } from "./aspectRatio";
import { renderMagnifiedPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import { stampOptsForStroke } from "./stampTreatment";
import { buildJaggedSVG, drawJagged, type JaggedParams } from "./jaggedCore";
import {
  BG,
  computeInfraTrace,
  DEFAULT_INFRA_TRACE,
  IH,
  INFRA_TRACE_HINTS,
  INFRA_TRACE_LABELS,
  INFRA_TRACE_RANGES,
  INK,
  IW,
  SLIDER_KEYS_INFRA_TRACE,
  type InfraTraceParams,
} from "./infraTraceCore";

const GROWTH_MS = 3200;

interface InfraTestingProps {
  /** Portal tool controls into this host (mode-rail panel under the vertical seg). */
  controlsTarget?: HTMLElement | null;
}

/**
 * Infra Testing — the Infrastructure reference artwork as traced vector geometry.
 *
 * Drawing and export are the Circuit Traces passes, unchanged: they take `FlowLine`s
 * and never read the routing params, so the traced paths render through exactly the
 * same ink treatment and the two are directly comparable side by side.
 */
export default function InfraTesting({
  controlsTarget = null,
}: InfraTestingProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h, exportDims, pxScale, config, setConfig, resetSize } =
    useCanvasDimensions(IW, IH);
  const [params, setParams] = useState<InfraTraceParams>(DEFAULT_INFRA_TRACE);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  const [fade, setFade] = useState(false);
  const qualityRef = useRef(1);
  const settleTimer = useRef<number | undefined>(undefined);
  const [settleTick, setSettleTick] = useState(0);

  const lines = useMemo(
    () => computeInfraTrace(w, h, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      w,
      h,
      ...Object.entries(params)
        .filter(([k]) => k !== "stamp" && k !== "cutout")
        .map(([, v]) => v),
    ],
  );

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
    drawJagged(
      ctx,
      dpr,
      w,
      h,
      lines,
      params as unknown as JaggedParams,
      safeColor(ink, INK),
      safeColor(background, BG),
      growth,
      fade,
      params.seed,
      qualityRef.current < 1 ? undefined : stampOpts,
    );
  }, [lines, params, ink, background, growth, w, h, fade, stampOpts, settleTick]);

  useEffect(() => {
    draw();
  }, [draw]);

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
      render: (ctx: CanvasRenderingContext2D, dpr: number) => {
        drawJagged(
          ctx,
          dpr * pxScale,
          w,
          h,
          lines,
          params as unknown as JaggedParams,
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
    "infra-trace",
    getExportRender,
    recordTimeline,
  );

  const startRecord = () => recorder.start();
  const stopRecord = () => recorder.stop();

  useEffect(() => {
    if (recorder.recording) return;
    draw();
  }, [recorder.recording, draw]);

  const updateParam = useCallback(
    <K extends keyof InfraTraceParams>(key: K, value: InfraTraceParams[K]) => {
      qualityRef.current = 0.5;
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        qualityRef.current = 1;
        setSettleTick((t) => t + 1);
      }, 160);
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const reset = () => {
    setGrowing(false);
    setGrowth(1);
    setParams(DEFAULT_INFRA_TRACE);
    setInk(INK);
    setBackground(BG);
    setFade(false);
    resetSize();
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `infra-trace.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    if (!lines.length) return;
    const svg = buildJaggedSVG(
      w,
      h,
      lines,
      params as unknown as JaggedParams,
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
    const ss = stampOpts ? 1 : undefined;
    void renderMagnifiedPngBlob(
      exportDims.w,
      exportDims.h,
      w,
      h,
      (ctx, scale) => {
        drawJagged(
          ctx,
          scale,
          w,
          h,
          lines,
          params as unknown as JaggedParams,
          safeColor(ink, INK),
          transparent ? "transparent" : safeColor(background, BG),
          1,
          fade,
          params.seed,
          stampOpts,
        );
      },
      ss,
    ).then((blob) => blob && download(blob, "png"));
  };

  const renderRow = (key: string) => {
    const [min, max, step] = INFRA_TRACE_RANGES[key];
    const value = params[key as keyof InfraTraceParams] as number;
    const k = key as keyof InfraTraceParams;
    return (
      <label
        key={key}
        className="tool-param-row has-tip"
        data-tip={INFRA_TRACE_HINTS[key]}
      >
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{INFRA_TRACE_LABELS[key]}</span>
          <ParamValueInput
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={INFRA_TRACE_LABELS[key]}
            onChange={(v) => updateParam(k, v as InfraTraceParams[typeof k])}
          />
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) =>
            updateParam(k, +e.target.value as InfraTraceParams[typeof k])
          }
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
      sliders={SLIDER_KEYS_INFRA_TRACE.map(renderRow)}
      ink={ink}
      background={background}
      onInkChange={setInk}
      onBackgroundChange={setBackground}
      strokeTip="Color of the traces."
      backgroundTip="Board color behind the traces."
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
        className={`specimen-tree specimen-tree--viewport${
          controlsTarget ? "" : " specimen-tree--wide-controls"
        }`}
        aria-label="Infra testing canvas"
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
