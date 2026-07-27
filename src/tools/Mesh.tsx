import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ParamValueInput from "../components/ParamValueInput";
import ToolRailControls from "../components/ToolRailControls";
import { useAnimProgress, useCanvasRecorder, useStopRecordWhenAnimatingEnds } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { setCanvasAspectVars } from "./aspectRatio";
import { renderMagnifiedPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import { stampOptsForStroke } from "./stampTreatment";
import {
  BG,
  buildMeshSVG,
  computeMesh,
  DEFAULT_MESH,
  drawMesh,
  INK,
  MESH_HINTS,
  MESH_LABELS,
  MESH_RANGES,
  MH,
  MW,
  SLIDER_KEYS_SIMPLE_MESH,
  type MeshParams,
} from "./meshCore";

const GROWTH_MS = 3200;

interface MeshProps {
  controlsTarget?: HTMLElement | null;
}

export default function Mesh({ controlsTarget = null }: MeshProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h, exportDims, pxScale, config, setConfig, resetSize } =
    useCanvasDimensions(MW, MH);
  const [params, setParams] = useState<MeshParams>(DEFAULT_MESH);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  const [fade, setFade] = useState(true);
  // Treatment render quality: dropped while sliders scrub, 1 at rest.
  const qualityRef = useRef(1);
  const settleTimer = useRef<number | undefined>(undefined);
  const [settleTick, setSettleTick] = useState(0);

  // Stamp/cutout are render-only treatment passes — scrubbing them must not
  // rebuild the lattice, so they're excluded from the deps.
  const lines = useMemo(
    () => computeMesh(w, h, params),
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
    drawMesh(
      ctx,
      dpr,
      w,
      h,
      lines,
      safeColor(ink, INK),
      safeColor(background, BG),
      growth,
      fade,
      params.seed,
      // While a slider is scrubbing, show untreated draft linework: the
      // treatment's breaks are resolution-sensitive, so an approximated
      // preview MISLEADS. At rest the preview is exactly the export.
      qualityRef.current < 1 ? undefined : stampOpts,
    );
    // settleTick re-runs the draw with the full treatment after scrubbing.
  }, [lines, ink, background, growth, w, h, fade, params.seed, stampOpts, settleTick]);

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
      setGrowth(1 - (1 - p) * (1 - p));
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
        drawMesh(
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

  const recorder = useCanvasRecorder(
    () => canvasRef.current,
    `mesh-${params.seed}`,
    getExportRender,
  );

  const startRecord = () => {
    growthRef.current = 0;
    setGrowth(0);
    setGrowing(true);
    recorder.start();
  };
  const stopRecord = () => recorder.stop();

  useStopRecordWhenAnimatingEnds(recorder.recording, growing, recorder.stop);

  useEffect(() => {
    if (recorder.recording) return;
    draw();
  }, [recorder.recording, draw]);

  const updateParam = useCallback(
    <K extends keyof MeshParams>(key: K, value: MeshParams[K]) => {
      // Scrub with untreated draft linework so slider drags stay fluid;
      // settle back to the full treatment shortly after the last movement.
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
    setParams(DEFAULT_MESH);
    setInk(INK);
    setBackground(BG);
    setFade(true);
    resetSize();
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mesh-${params.seed}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    if (!lines.length) return;
    // Vector — build from the preview lines at preview dims so stroke weights
    // read exactly as on screen; SVG scales to any size losslessly.
    const svg = buildMeshSVG(
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
      drawMesh(
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

  const renderRow = (key: keyof MeshParams) => {
    const [min, max, step] = MESH_RANGES[key];
    const value = params[key];
    return (
      <label
        key={key}
        className="tool-param-row has-tip"
        data-tip={MESH_HINTS[key]}
      >
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{MESH_LABELS[key]}</span>
          <ParamValueInput
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={MESH_LABELS[key]}
            onChange={(v) => updateParam(key, v as MeshParams[typeof key])}
          />
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) =>
            updateParam(key, +e.target.value as MeshParams[typeof key])
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
      sliders={SLIDER_KEYS_SIMPLE_MESH.map(renderRow)}
      ink={ink}
      background={background}
      onInkChange={setInk}
      onBackgroundChange={setBackground}
      strokeTip="Color of the mesh lines."
      backgroundTip="Canvas background color behind the lines."
      onPNG={downloadPNG}
      onSVG={downloadSVG}
      exportDisabled={!lines.length}
      recording={recorder.recording}
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
        aria-label="FinTech mesh canvas"
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
