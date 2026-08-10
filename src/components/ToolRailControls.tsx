import type { ReactNode } from "react";
import AspectRatioControl from "./AspectRatioControl";
import ExportButtons from "./ExportButtons";
import PaletteColorRow from "./PaletteColorRow";
import RecordButton from "./RecordButton";
import type { CanvasSizeConfig } from "../tools/aspectRatio";

const ResetIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </svg>
);

interface ToolRailControlsProps {
  /** Optional block above Canvas (e.g. in-panel brush toggle). */
  header?: ReactNode;
  config: CanvasSizeConfig;
  onConfigChange: (config: CanvasSizeConfig) => void;
  /** When set, shows the Fade switch under the canvas size control. */
  fade?: boolean;
  onFadeChange?: (value: boolean) => void;
  fadeTip?: string;
  /** Seed / Density / Line Weight (or tool-specific) slider rows. */
  sliders: ReactNode;
  ink: string;
  background: string;
  onInkChange: (value: string) => void;
  onBackgroundChange: (value: string) => void;
  strokeTip?: string;
  backgroundTip?: string;
  onPNG: (transparent: boolean) => void;
  onSVG: () => void;
  exportDisabled?: boolean;
  recording: boolean;
  recordProgress?: number;
  recordSupported?: boolean;
  onStartRecord: () => void;
  onStopRecord: () => void;
  playing: boolean;
  onTogglePlay: () => void;
  playDisabled?: boolean;
  playLabel?: string;
  playingLabel?: string;
  onReset: () => void;
}

/**
 * Shared left-rail controls used by Branch and Field tools: canvas size,
 * optional fade, param sliders, colors, export, and play/reset.
 */
export default function ToolRailControls({
  header,
  config,
  onConfigChange,
  fade,
  onFadeChange,
  fadeTip = "End vectors short of the bottom with tapered tips",
  sliders,
  ink,
  background,
  onInkChange,
  onBackgroundChange,
  strokeTip = "Color of the stroke.",
  backgroundTip = "Canvas background color.",
  onPNG,
  onSVG,
  exportDisabled,
  recording,
  recordProgress = 0,
  recordSupported = true,
  onStartRecord,
  onStopRecord,
  playing,
  onTogglePlay,
  playDisabled,
  playLabel = "Play",
  playingLabel = "Drawing…",
  onReset,
}: ToolRailControlsProps) {
  const showFade = typeof fade === "boolean" && onFadeChange;

  return (
    <>
      {header}

      <div className="specimen-tree__group">
        <span className="specimen-tree__group-title">Canvas</span>
        <AspectRatioControl value={config} onChange={onConfigChange} />
        {showFade && (
          <label
            className="tool-param-row has-tip"
            data-tip={fadeTip}
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
                onChange={(e) => onFadeChange(e.target.checked)}
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
        )}
      </div>

      <div className="specimen-tree__group rail-section">
        <div className="specimen-tree__sliders">{sliders}</div>
      </div>

      <div className="specimen-tree__group">
        <PaletteColorRow
          label="Stroke Color"
          tip={strokeTip}
          value={ink}
          onChange={onInkChange}
        />
        <PaletteColorRow
          label="Background"
          tip={backgroundTip}
          value={background}
          onChange={onBackgroundChange}
        />
      </div>

      <div className="specimen-tree__actions specimen-tree__actions--export rail-section">
        <ExportButtons
          onPNG={onPNG}
          onSVG={onSVG}
          disabled={exportDisabled}
        />
        <RecordButton
          recording={recording}
          progress={recordProgress}
          supported={recordSupported}
          onStart={onStartRecord}
          onStop={onStopRecord}
        />
      </div>

      <div className="specimen-tree__actions rail-section">
        <button
          type="button"
          className={`btn${playing ? " is-active" : ""}`}
          onClick={onTogglePlay}
          disabled={playDisabled}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {playing ? playingLabel : playLabel}
        </button>
        <button type="button" className="btn" onClick={onReset}>
          <ResetIcon />
          Reset
        </button>
      </div>
    </>
  );
}
