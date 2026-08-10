import { useCallback, useEffect, useRef, useState } from "react";

// Quiet period after the last slider movement before the canvas is rebuilt.
// Short enough to feel like a direct response to letting go of the thumb, long
// enough that a continuous drag commits once instead of dozens of times.
const SETTLE_MS = 140;

/**
 * Two views of a tool's params, so dragging a slider stays smooth.
 *
 * Rebuilding a tool's geometry and running the ink treatment over it costs tens
 * to hundreds of milliseconds. A dragged slider fires input events at screen
 * refresh rate, and doing that work on each one saturates the main thread —
 * events queue up behind renders and the thumb visibly stutters and lags the
 * cursor.
 *
 * So the params are split. `live` updates on every event and feeds only the
 * control rail, which is cheap markup, so the thumb and readout track the
 * cursor exactly. `committed` feeds the canvas and holds still until the
 * movement settles, which keeps the expensive pipeline off the input path
 * entirely and means every frame the canvas shows is a real, fully treated
 * result rather than an approximation.
 */
export function useScrubbedParams<T extends object>(initial: T) {
  const [live, setLive] = useState(initial);
  const [committed, setCommitted] = useState(initial);
  // Authoritative latest value. The commit timer reads this rather than the
  // `live` state, which it would otherwise close over a render too early.
  const liveRef = useRef(initial);
  const timer = useRef<number | undefined>(undefined);

  const setParam = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    const next = { ...liveRef.current, [key]: value };
    liveRef.current = next;
    setLive(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setCommitted(liveRef.current),
      SETTLE_MS,
    );
  }, []);

  /** Move both views at once — for Reset and other non-scrub changes. */
  const resetParams = useCallback((next: T) => {
    window.clearTimeout(timer.current);
    liveRef.current = next;
    setLive(next);
    setCommitted(next);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { live, committed, setParam, resetParams };
}
