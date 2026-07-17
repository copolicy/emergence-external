import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AspectRatioControl from "../components/AspectRatioControl";
import ExportButtons from "../components/ExportButtons";
import ParamValueInput from "../components/ParamValueInput";
import RecordButton from "../components/RecordButton";
import { useAnimProgress, useCanvasRecorder, useStopRecordWhenAnimatingEnds } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { renderPngBlob, scaleStrokeParams } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import {
  BG,
  buildJaggedSVG,
  computeJagged,
  DEFAULT_JAGGED,
  drawJagged,
  JAGGED_HINTS,
  JAGGED_LABELS,
  JAGGED_RANGES,
  JH,
  JW,
  INK,
  SLIDER_KEYS_SIMPLE_JAGGED,
  type JaggedParams,
} from "./jaggedCore";

const GROWTH_MS = 3200;

interface JaggedProps {
  /** Portal tool controls into this host (mode-rail panel under the field tool seg). */
  controlsTarget?: HTMLElement | null;
}

export default function Jagged({ controlsTarget = null }: JaggedProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h, exportDims, pxScale, config, setConfig, resetSize } = useCanvasDimensions(JW, JH);
  const [params, setParams] = useState<JaggedParams>(DEFAULT_JAGGED);
  const exportParams = useMemo(() => scaleStrokeParams(params, pxScale), [params, pxScale]);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  const [fade, setFade] = useState(true);

  const lines = useMemo(() => computeJagged(w, h, params), [params, w, h]);
  const exportLines = useMemo(
    () => computeJagged(exportDims.w, exportDims.h, exportParams),
    [exportDims, exportParams],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.setProperty("--canvas-ar-w", String(w));
    canvas.style.setProperty("--canvas-ar-h", String(h));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawJagged(
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
    );
  }, [lines, params, ink, background, growth, w, h, fade]);

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
      render: (ctx: CanvasRenderingContext2D, dpr: number) => {
        drawJagged(
          ctx,
          dpr,
          exportDims.w,
          exportDims.h,
          exportLines,
          exportParams,
          safeColor(ink, INK),
          safeColor(background, BG),
          growthRef.current,
          fade,
          params.seed,
        );
      },
    }),
    [exportDims, exportLines, exportParams, ink, background, growth, fade, params.seed],
  );

  const recorder = useCanvasRecorder(() => canvasRef.current, `jagged-${params.seed}`, getExportRender);

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
    <K extends keyof JaggedParams>(key: K, value: JaggedParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const reset = () => {
    setGrowing(false);
    setGrowth(1);
    setParams(DEFAULT_JAGGED);
    setInk(INK);
    setBackground(BG);
    setFade(true);
    resetSize();
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jagged-${params.seed}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    if (!lines.length) return;
    const svg = buildJaggedSVG(exportDims.w, exportDims.h, exportLines, exportParams, safeColor(ink, INK), "transparent", fade, params.seed);
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const downloadPNG = (transparent: boolean) => {
    if (!lines.length) return;
    void renderPngBlob(exportDims.w, exportDims.h, (ctx, dpr) => {
      drawJagged(
        ctx,
        dpr,
        exportDims.w,
        exportDims.h,
        exportLines,
        exportParams,
        safeColor(ink, INK),
        transparent ? "transparent" : safeColor(background, BG),
        1,
        fade,
        params.seed,
      );
    }).then((blob) => blob && download(blob, "png"));
  };

  const renderRow = (key: keyof JaggedParams) => {
    const [min, max, step] = JAGGED_RANGES[key];
    const value = params[key];
    return (
      <label key={key} className="tool-param-row has-tip" data-tip={JAGGED_HINTS[key]}>
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{JAGGED_LABELS[key]}</span>
          <ParamValueInput
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={JAGGED_LABELS[key]}
            onChange={(v) => updateParam(key, v as JaggedParams[typeof key])}
          />
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => updateParam(key, +e.target.value as JaggedParams[typeof key])}
        />
      </label>
    );
  };

  const colorRow = (
    label: string,
    tip: string,
    value: string,
    fallback: string,
    onChange: (v: string) => void,
  ) => (
    <label className="tool-param-row has-tip tool-color-row" data-tip={tip}>
      <span className="tool-param-row__label">{label}</span>
      <span className="tool-color-row__inputs">
        <input
          type="color"
          className="tool-color-row__swatch"
          value={safeColor(value, fallback)}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} swatch`}
        />
        <input
          type="text"
          className="tool-color-row__hex"
          value={value}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v.startsWith("#") ? v : `#${v}`);
          }}
          aria-label={`${label} hex code`}
        />
      </span>
    </label>
  );

  const controls = (
    <>
      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Canvas</span>
        <AspectRatioControl value={config} onChange={setConfig} />
      </div>

      <div className="specimen-tree__group rail-section">
        <label
          className="tool-param-row has-tip"
          data-tip="Thin the linework from dense to sparse toward the bottom"
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span className="tool-param-row__label">Fade</span>
          <span className={`toggle-switch${fade ? " is-on" : ""}`}>
            <input
              type="checkbox"
              checked={fade}
              onChange={(e) => setFade(e.target.checked)}
              style={{
                position: "absolute",
                opacity: 0,
                inset: 0,
                cursor: "pointer",
              }}
              aria-label="Toggle fade"
            />
            <span className="toggle-switch__track" />
            <span className="toggle-switch__thumb" />
          </span>
        </label>
        <div className="specimen-tree__sliders">{SLIDER_KEYS_SIMPLE_JAGGED.map(renderRow)}</div>
      </div>

      <div className="specimen-tree__group">
        {colorRow("Stroke Color", "Color of the flow lines.", ink, INK, setInk)}
        {colorRow(
          "Background",
          "Canvas background color behind the lines.",
          background,
          BG,
          setBackground,
        )}
      </div>

      <div className="specimen-tree__actions specimen-tree__actions--export rail-section">
        <ExportButtons
          onPNG={downloadPNG}
          onSVG={downloadSVG}
          disabled={!lines.length}
        />
        <RecordButton
          recording={recorder.recording}
          supported={recorder.supported}
          onStart={startRecord}
          onStop={stopRecord}
        />
      </div>

      <div className="specimen-tree__actions rail-section">
        <button
          type="button"
          className={`btn${growing ? " is-active" : ""}`}
          onClick={toggleGrow}
          disabled={!lines.length}
        >
          {growing ? (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {growing ? "Drawing…" : "Play"}
        </button>
        <button type="button" className="btn" onClick={reset}>
          Reset
        </button>
      </div>
    </>
  );

  return (
    <>
      {controlsTarget ? createPortal(controls, controlsTarget) : null}

      <section
        className={`specimen-tree specimen-tree--viewport${controlsTarget ? "" : " specimen-tree--wide-controls"}`}
        aria-label="Jagged fingerprint canvas"
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
