import type { MouseEvent } from "react";
import { quantizeParam } from "./ParamValueInput";

interface ParamRangeTrackProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  "aria-label"?: string;
}

const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
    <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Range input flanked by step-back / step-forward buttons (one `step` each).
 */
export default function ParamRangeTrack({
  value,
  min,
  max,
  step,
  onChange,
  "aria-label": ariaLabel = "Value",
}: ParamRangeTrackProps) {
  const nudge = (dir: -1 | 1) => (e: MouseEvent) => {
    // Keep the parent <label> from also forwarding the click to the range.
    e.preventDefault();
    e.stopPropagation();
    onChange(quantizeParam(value + dir * step, min, max, step));
  };

  return (
    <span className="tool-param-row__track">
      <button
        type="button"
        className="param-step"
        aria-label={`Decrease ${ariaLabel}`}
        disabled={value <= min}
        onClick={nudge(-1)}
      >
        <ChevronLeft />
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(+e.target.value)}
      />
      <button
        type="button"
        className="param-step"
        aria-label={`Increase ${ariaLabel}`}
        disabled={value >= max}
        onClick={nudge(1)}
      >
        <ChevronRight />
      </button>
    </span>
  );
}
