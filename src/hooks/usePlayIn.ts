import { useEffect, type RefObject } from "react";
import { easeGrowth } from "./useCanvasRecorder";

/**
 * Drives a tool's play-in: walks progress 0 → 1 over `durationMs` and paints
 * each frame, then settles.
 *
 * Two things matter here and both are easy to get wrong.
 *
 * Progress comes off the WALL CLOCK rather than a frame count, so the play-in
 * lasts as long as it should whatever the machine manages — a slow frame drops
 * a frame instead of running the whole animation in slow motion.
 *
 * And each frame is painted straight from the frame callback, through
 * `drawRef`, rather than by setting state and letting a render pass repaint.
 * Going through state puts a full React render between every frame and lets
 * draws queue up behind each other, which is what makes a play-in advance in
 * bursts. State is written once, at the end, to settle the finished frame.
 */
export function usePlayIn(
  growing: boolean,
  setGrowing: (v: boolean) => void,
  durationMs: number,
  growthRef: RefObject<number>,
  setGrowth: (v: number) => void,
  drawRef: RefObject<((progress: number) => void) | undefined>,
) {
  useEffect(() => {
    if (!growing) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / durationMs);
      if (p >= 1) {
        // Settle through state so the finished frame goes down the same path
        // as any other settled render.
        setGrowth(1);
        setGrowing(false);
        return;
      }
      const eased = easeGrowth(p);
      growthRef.current = eased;
      drawRef.current?.(eased);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [growing, durationMs, growthRef, setGrowth, setGrowing, drawRef]);
}
