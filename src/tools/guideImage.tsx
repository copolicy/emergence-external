import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import ParamValueInput from "../components/ParamValueInput";
import ParamRangeTrack from "../components/ParamRangeTrack";
import { buildAvoidDistance, type AvoidMask } from "./rootSystemCore";

// Uploaded image the vertical linework keeps clear of. Same controls as the
// Core Brand "Grow Around Image" group: place and scale it, keep a gap, and
// optionally bake it into the export. The faded copy is preview-only.

interface GuideImage {
  el: HTMLImageElement;
  href: string;
  iw: number;
  ih: number;
  name: string;
}

interface GuidePlace {
  x: number;
  y: number;
  size: number;
  clearance: number;
}

const DEFAULT_PLACE: GuidePlace = { x: 0.5, y: 0.6, size: 0.35, clearance: 8 };
const PLACE_RANGES: Record<keyof GuidePlace, [number, number, number]> = {
  size: [0.05, 1.2, 0.01],
  x: [0, 1, 0.01],
  y: [0, 1, 0.01],
  clearance: [0, 80, 1],
};
const PLACE_LABELS: Record<keyof GuidePlace, string> = {
  size: "Image Size",
  x: "Image X",
  y: "Image Y",
  clearance: "Clearance",
};
const PLACE_HINTS: Record<keyof GuidePlace, string> = {
  size: "Scale of the image on the canvas. You can also drag the canvas to move it.",
  x: "Horizontal position of the image. Drag the canvas to move it freely.",
  y: "Vertical position of the image. Drag the canvas to move it freely.",
  clearance: "Gap the linework keeps from the image. 0 lets it touch the edge.",
};
const GHOST_OPACITY = 0.3;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function guideRect(g: GuideImage, pl: GuidePlace, w: number, h: number) {
  const dh = pl.size * h;
  const dw = dh * (g.iw / (g.ih || 1));
  return { dx: pl.x * w - dw / 2, dy: pl.y * h - dh / 2, dw, dh };
}

function rasterHole(avoid: AvoidMask): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = avoid.w;
  c.height = avoid.h;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(avoid.w, avoid.h);
  const data = img.data;
  const { dist, clearance } = avoid;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < clearance) data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const readAsDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

export interface GuideCanvasProps {
  style?: CSSProperties;
  onPointerDown?: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel?: (e: PointerEvent<HTMLCanvasElement>) => void;
}

/**
 * Grow-around-image for a field tool. `paintOver` punches the settled
 * silhouette (plus clearance) out of whatever was just drawn and paints the
 * image — full strength in an export when included, faded in the preview.
 * Dragging updates the preview immediately; the hole follows once you stop.
 */
export function useGuideImage(w: number, h: number) {
  const [guide, setGuide] = useState<GuideImage | null>(null);
  const [placeLive, setPlaceLive] = useState<GuidePlace>(DEFAULT_PLACE);
  const [place, setPlace] = useState<GuidePlace>(DEFAULT_PLACE);
  const [includeGuide, setIncludeGuide] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (dragging) return;
    const t = window.setTimeout(() => setPlace(placeLive), 180);
    return () => window.clearTimeout(t);
  }, [placeLive, dragging]);

  const hole = useMemo(() => {
    if (!guide) return null;
    const r = guideRect(guide, place, w, h);
    const dist = buildAvoidDistance(w, h, (ctx) =>
      ctx.drawImage(guide.el, r.dx, r.dy, r.dw, r.dh),
    );
    return rasterHole({ dist, w, h, clearance: place.clearance });
  }, [guide, place, w, h]);

  const holeHref = useMemo(() => (hole ? hole.toDataURL("image/png") : ""), [hole]);

  const paintOver = useCallback(
    (ctx: CanvasRenderingContext2D, background: string, forExport: boolean, opacity = 1) => {
      if (!guide || !hole) return;
      const pl = forExport ? place : placeLive;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(hole, 0, 0, w, h);
      if (background !== "transparent") {
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
      }
      const alpha = forExport ? (includeGuide ? 1 : 0) : includeGuide ? 1 : GHOST_OPACITY;
      if (alpha > 0) {
        const r = guideRect(guide, pl, w, h);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = alpha * opacity;
        ctx.drawImage(guide.el, r.dx, r.dy, r.dw, r.dh);
      }
      ctx.restore();
    },
    [guide, hole, place, placeLive, includeGuide, w, h],
  );

  const applySvg = useCallback(
    (svg: string) => {
      if (!guide || !holeHref) return svg;
      const open = svg.match(/^<svg\b[^>]*>/);
      if (!open || !svg.endsWith("</svg>")) return svg;
      const inner = svg.slice(open[0].length, svg.length - "</svg>".length);
      const rect = inner.match(/^<rect\b[^>]*\/>/);
      const bg = rect ? rect[0] : "";
      const ink = rect ? inner.slice(rect[0].length) : inner;
      const defs =
        `<defs><mask id="guide-hole" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
        `<rect width="${w}" height="${h}" fill="#fff"/>` +
        `<image href="${holeHref}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>` +
        `</mask></defs>`;
      let image = "";
      if (includeGuide) {
        const r = guideRect(guide, place, w, h);
        const f = (n: number) => Math.round(n * 100) / 100;
        image =
          `<image href="${guide.href}" x="${f(r.dx)}" y="${f(r.dy)}" width="${f(r.dw)}" height="${f(r.dh)}" preserveAspectRatio="none"/>`;
      }
      return `${open[0]}${defs}${bg}<g mask="url(#guide-hole)">${ink}</g>${image}</svg>`;
    },
    [guide, holeHref, includeGuide, place, w, h],
  );

  const clear = useCallback(() => {
    setGuide(null);
    setPlaceLive(DEFAULT_PLACE);
    setPlace(DEFAULT_PLACE);
    setIncludeGuide(false);
    setDragging(false);
    dragRef.current = null;
  }, []);

  const canvasPoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!guide || e.button !== 0) return false;
    dragRef.current = canvasPoint(e);
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    return true;
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = dragRef.current;
    if (!g) return false;
    const pt = canvasPoint(e);
    dragRef.current = pt;
    setPlaceLive((prev) => ({
      ...prev,
      x: clamp(prev.x + (pt.x - g.x), 0, 1),
      y: clamp(prev.y + (pt.y - g.y), 0, 1),
    }));
    return true;
  };

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return false;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
    return true;
  };

  const onFile = async (file: File) => {
    try {
      const href = await readAsDataURL(file);
      const img = new Image();
      img.onload = () => {
        setGuide({
          el: img,
          href,
          iw: img.naturalWidth || 300,
          ih: img.naturalHeight || 300,
          name: file.name,
        });
        setIncludeGuide(false);
      };
      img.onerror = () => console.error("Image load failed");
      img.src = href;
    } catch (err) {
      console.error("Image read failed", err);
    }
  };

  const updatePlace = (k: keyof GuidePlace, v: number) =>
    setPlaceLive((prev) => ({ ...prev, [k]: v }));

  const controls = (
    <div className="specimen-tree__group">
      <span className="specimen-tree__group-title">Grow Around Image</span>
      <div className="tool-uploads">
        <label className="btn tool-upload-btn">
          {guide ? "Change image" : "Upload image"}
          <input
            type="file"
            accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {guide && (
          <button type="button" className="tool-upload-chip" onClick={clear}>
            <span className="tool-upload-chip__name">{guide.name}</span>
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>
      {guide && (
        <>
          <div className="specimen-tree__sliders">
            {(["size", "x", "y", "clearance"] as (keyof GuidePlace)[]).map((key) => {
              const [min, max, step] = PLACE_RANGES[key];
              return (
                <label
                  key={key}
                  className="tool-param-row has-tip"
                  data-tip={PLACE_HINTS[key]}
                >
                  <span className="tool-param-row__header">
                    <span className="tool-param-row__label">{PLACE_LABELS[key]}</span>
                    <ParamValueInput
                      value={+placeLive[key].toFixed(step < 1 ? 2 : 0)}
                      min={min}
                      max={max}
                      step={step}
                      aria-label={PLACE_LABELS[key]}
                      onChange={(v) => updatePlace(key, v)}
                    />
                  </span>
                  <ParamRangeTrack
                    value={placeLive[key]}
                    min={min}
                    max={max}
                    step={step}
                    aria-label={PLACE_LABELS[key]}
                    onChange={(v) => updatePlace(key, v)}
                  />
                </label>
              );
            })}
          </div>
          <label
            className="tool-param-row has-tip"
            data-tip="Off: the image only shapes the linework and is left out of PNG, SVG and MP4 exports (shown faded here)."
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span className="tool-param-row__label">Include image in export</span>
            <span className={`toggle-switch${includeGuide ? " is-on" : ""}`}>
              <input
                type="checkbox"
                checked={includeGuide}
                onChange={(e) => setIncludeGuide(e.target.checked)}
                style={{ position: "absolute", opacity: 0, inset: 0, cursor: "pointer" }}
                aria-label="Include image in export"
              />
              <span className="toggle-switch__track" />
              <span className="toggle-switch__thumb" />
            </span>
          </label>
        </>
      )}
    </div>
  );

  const canvasProps: GuideCanvasProps = guide
    ? {
        style: {
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
        },
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
      }
    : {};

  return {
    active: !!guide,
    dragging,
    controls,
    paintOver,
    applySvg,
    clear,
    canvasProps,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
