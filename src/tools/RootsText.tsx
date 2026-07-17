import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AspectRatioControl from "../components/AspectRatioControl";
import ExportButtons from "../components/ExportButtons";
import ParamValueInput from "../components/ParamValueInput";
import RecordButton from "../components/RecordButton";
import { useAnimProgress, useCanvasRecorder, useStopRecordWhenAnimatingEnds } from "../hooks/useCanvasRecorder";
import { useCanvasDimensions } from "../hooks/useCanvasDimensions";
import { setCanvasAspectVars } from "./aspectRatio";
import { renderMagnifiedPngBlob } from "./exportCanvas";
import { safeColor } from "./specimenTreeCore";
import {
  BG,
  buildRootsTextSVG,
  DEFAULT_FONT_FAMILY,
  DEFAULT_ROOTS_TEXT,
  DEFAULT_TEXT,
  drawRootsText,
  growRootsText,
  INK,
  ROOTS_TEXT_HINTS,
  ROOTS_TEXT_LABELS,
  ROOTS_TEXT_RANGES,
  SLIDER_KEYS_SIMPLE,
  TH,
  TW,
  type FontFaceSpec,
  type GlyphInput,
  type RootsTextBrush,
  type RootsTextParams,
} from "./rootsTextCore";

// The Root System brushes, exposed here too.
const BRUSHES: { id: RootsTextBrush; label: string }[] = [
  { id: "organic", label: "Organic" },
  { id: "engineered", label: "Engineered" },
];

const readAsDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const readAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsText(file);
  });

// Ensure an uploaded SVG carries explicit width/height (some only declare a
// viewBox, which leaves <img> with a 0 intrinsic size). Returns the patched
// markup plus the resolved intrinsic dimensions.
function ensureSvgSize(svgText: string): { text: string; w: number; h: number } {
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const el = doc.documentElement;
    let w = parseFloat(el.getAttribute("width") || "");
    let h = parseFloat(el.getAttribute("height") || "");
    const vb = (el.getAttribute("viewBox") || "")
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    if ((!w || !h) && vb.length === 4) {
      w = vb[2];
      h = vb[3];
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(h));
    }
    if (!w) w = 300;
    if (!h) h = 150;
    return { text: new XMLSerializer().serializeToString(doc), w, h };
  } catch {
    return { text: svgText, w: 300, h: 150 };
  }
}

const fontFormatFor = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "otf") return "opentype";
  if (ext === "woff") return "woff";
  if (ext === "woff2") return "woff2";
  return "truetype";
};

const GROWTH_MS = 4200;

interface RootsTextProps {
  /** Portal tool controls into this host (mode-rail panel under the field tool seg). */
  controlsTarget?: HTMLElement | null;
}

export default function RootsText({ controlsTarget = null }: RootsTextProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [params, setParams] = useState<RootsTextParams>(DEFAULT_ROOTS_TEXT);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [ink, setInk] = useState(INK);
  const [background, setBackground] = useState(BG);
  const [growing, setGrowing] = useState(false);
  const [growth, setGrowth, growthRef] = useAnimProgress(1);
  const [brush, setBrush] = useState<RootsTextBrush>("organic");
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Uploaded font (renders the copy) and uploaded SVG (replaces the copy as the
  // shape the roots grow around).
  const [fontFamily, setFontFamily] = useState(DEFAULT_FONT_FAMILY);
  const [fontName, setFontName] = useState<string | null>(null);
  const [fontFace, setFontFace] = useState<FontFaceSpec | null>(null);
  const [glyphImg, setGlyphImg] = useState<HTMLImageElement | null>(null);
  const [glyphSize, setGlyphSize] = useState({ w: 0, h: 0 });
  const [glyphHref, setGlyphHref] = useState("");
  const [svgName, setSvgName] = useState<string | null>(null);
  const fontCounter = useRef(0);

  const { w, h, exportDims, config, setConfig, resetSize } = useCanvasDimensions(TW, TH);

  const glyph = useMemo<GlyphInput>(
    () => ({
      text,
      fontFamily,
      fontFace,
      image: glyphImg
        ? { el: glyphImg, w: glyphSize.w, h: glyphSize.h, href: glyphHref }
        : null,
    }),
    [text, fontFamily, fontFace, glyphImg, glyphSize, glyphHref],
  );

  const result = useMemo(
    () => growRootsText(w, h, params, glyph, brush),
    [w, h, params, glyph, brush],
  );

  const onFontFile = async (file: File) => {
    try {
      const dataUrl = await readAsDataURL(file);
      const family = `roots-upfont-${++fontCounter.current}`;
      const ff = new FontFace(family, `url(${dataUrl})`);
      await ff.load();
      document.fonts.add(ff);
      setFontFamily(`"${family}"`);
      setFontFace({ family: `"${family}"`, dataUrl, format: fontFormatFor(file.name) });
      setFontName(file.name);
    } catch (err) {
      console.error("Font load failed", err);
    }
  };

  const clearFont = () => {
    setFontFamily(DEFAULT_FONT_FAMILY);
    setFontFace(null);
    setFontName(null);
  };

  const onSvgFile = async (file: File) => {
    try {
      const raw = await readAsText(file);
      const sized = ensureSvgSize(raw);
      const href =
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sized.text);
      const img = new Image();
      img.onload = () => {
        setGlyphImg(img);
        setGlyphSize({
          w: img.naturalWidth || sized.w,
          h: img.naturalHeight || sized.h,
        });
        setGlyphHref(href);
        setSvgName(file.name);
      };
      img.onerror = () => console.error("SVG load failed");
      img.src = href;
    } catch (err) {
      console.error("SVG read failed", err);
    }
  };

  const clearSvg = () => {
    setGlyphImg(null);
    setGlyphSize({ w: 0, h: 0 });
    setGlyphHref("");
    setSvgName(null);
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    setCanvasAspectVars(canvas, w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawRootsText(
      ctx,
      dpr,
      w,
      h,
      result,
      safeColor(ink, INK),
      safeColor(background, BG),
      growth,
      brush,
    );
  }, [result, ink, background, growth, w, h, brush]);

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
        drawRootsText(
          ctx,
          dpr * (exportDims.w / w),
          w,
          h,
          result,
          safeColor(ink, INK),
          safeColor(background, BG),
          growthRef.current,
          brush,
        );
      },
    }),
    [exportDims, w, h, result, ink, background, growthRef, brush],
  );

  const recorder = useCanvasRecorder(() => canvasRef.current, `roots-text-${params.seed}`, getExportRender);

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
    <K extends keyof RootsTextParams>(key: K, value: RootsTextParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const canvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * w,
        y: ((clientY - rect.top) / rect.height) * h,
      };
    },
    [w, h],
  );

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (growing || recorder.recording) return;
    const pt = canvasPoint(e.clientX, e.clientY);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = pt;
    setDragging(true);
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const pt = canvasPoint(e.clientX, e.clientY);
    if (!pt) return;
    const dx = pt.x - dragRef.current.x;
    const dy = pt.y - dragRef.current.y;
    dragRef.current = pt;
    setParams((prev) => ({
      ...prev,
      textX: Math.max(-450, Math.min(450, prev.textX + dx)),
      textY: Math.max(-280, Math.min(280, prev.textY + dy)),
    }));
  };

  const endCanvasDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const reset = () => {
    setGrowing(false);
    setGrowth(1);
    setParams(DEFAULT_ROOTS_TEXT);
    setText(DEFAULT_TEXT);
    setInk(INK);
    setBackground(BG);
    resetSize();
    setBrush("organic");
    clearFont();
    clearSvg();
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roots-text-${params.seed}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSVG = () => {
    if (!result.edges.length) return;
    // Vector — built from the preview result at preview dims so stroke weights
    // match the screen; SVG scales to any size losslessly.
    const svg = buildRootsTextSVG(w, h, result, safeColor(ink, INK), "transparent", brush);
    download(new Blob([svg], { type: "image/svg+xml" }), "svg");
  };

  const downloadPNG = (transparent: boolean) => {
    if (!result.edges.length) return;
    // Pure magnification of the preview — same result, scaled through the
    // transform, one clean downscale. WYSIWYG.
    void renderMagnifiedPngBlob(exportDims.w, exportDims.h, w, h, (ctx, scale) => {
      drawRootsText(
        ctx,
        scale,
        w,
        h,
        result,
        safeColor(ink, INK),
        transparent ? "transparent" : safeColor(background, BG),
        1,
        brush,
      );
    }).then((blob) => blob && download(blob, "png"));
  };

  const renderRow = (key: keyof RootsTextParams) => {
    const [min, max, step] = ROOTS_TEXT_RANGES[key];
    const value = params[key];
    return (
      <label key={key} className="tool-param-row has-tip" data-tip={ROOTS_TEXT_HINTS[key]}>
        <span className="tool-param-row__header">
          <span className="tool-param-row__label">{ROOTS_TEXT_LABELS[key]}</span>
          <ParamValueInput
            value={value}
            min={min}
            max={max}
            step={step}
            aria-label={ROOTS_TEXT_LABELS[key]}
            onChange={(v) => updateParam(key, v as RootsTextParams[typeof key])}
          />
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => updateParam(key, +e.target.value as RootsTextParams[typeof key])}
        />
      </label>
    );
  };

  const colorRow = (
    label: string,
    value: string,
    fallback: string,
    onChange: (v: string) => void,
  ) => (
    <label className="tool-param-row tool-color-row">
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

      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Copy</span>
        <label className="tool-param-row">
          <span className="tool-param-row__header">
            <span className="tool-param-row__label">Text</span>
          </span>
          <textarea
            className="tool-text-input"
            rows={2}
            value={text}
            spellCheck={false}
            disabled={!!glyphImg}
            onChange={(e) => setText(e.target.value)}
            aria-label="text to surround"
          />
        </label>

        <div className="tool-uploads">
          <label className="btn tool-upload-btn">
            {fontName ? "Change font" : "Upload font"}
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2,font/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFontFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {fontName && (
            <button type="button" className="tool-upload-chip" onClick={clearFont}>
              <span className="tool-upload-chip__name">{fontName}</span>
              <span aria-hidden="true">✕</span>
            </button>
          )}

          <label className="btn tool-upload-btn">
            {svgName ? "Change SVG" : "Upload SVG text"}
            <input
              type="file"
              accept=".svg,image/svg+xml"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSvgFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {svgName && (
            <button type="button" className="tool-upload-chip" onClick={clearSvg}>
              <span className="tool-upload-chip__name">{svgName}</span>
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
        {glyphImg && (
          <p className="tool-upload-note">
            Roots are wrapping your uploaded SVG. Clear it to type text again.
          </p>
        )}
        <p className="tool-upload-note">Drag the canvas to reposition the copy.</p>
      </div>

      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Brush</span>
        <div role="group" aria-label="Brush" style={{ display: "flex", gap: 4 }}>
          {BRUSHES.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`btn${brush === b.id ? " is-active" : ""}`}
              aria-pressed={brush === b.id}
              onClick={() => setBrush(b.id)}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="specimen-tree__group rail-section">
        <div className="specimen-tree__sliders">{SLIDER_KEYS_SIMPLE.map(renderRow)}</div>
      </div>

      <div className="specimen-tree__group">
        {colorRow("Stroke Color", ink, INK, setInk)}
        {colorRow("Background", background, BG, setBackground)}
      </div>

      <div className="specimen-tree__actions specimen-tree__actions--export rail-section">
        <ExportButtons onPNG={downloadPNG} onSVG={downloadSVG} disabled={!result.edges.length} />
        <RecordButton recording={recorder.recording} supported={recorder.supported} onStart={startRecord} onStop={stopRecord} />
      </div>

      <div className="specimen-tree__actions rail-section">
        <button
          type="button"
          className={`btn${growing ? " is-active" : ""}`}
          onClick={toggleGrow}
          disabled={!result.edges.length}
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
          {growing ? "Growing…" : "Play"}
        </button>
        <button type="button" className="btn" onClick={reset}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
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
        aria-label="Roots Surrounding Text canvas"
      >
        {!controlsTarget && (
          <aside className="specimen-tree__controls">{controls}</aside>
        )}

        <div
          className="specimen-tree__canvas-wrap"
          style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={endCanvasDrag}
          onPointerCancel={endCanvasDrag}
        >
          <canvas ref={canvasRef} className="specimen-tree__canvas" />
        </div>
      </section>
    </>
  );
}
