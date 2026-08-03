import { MP4_EXPORT_ENABLED } from "../featureFlags";

interface RecordButtonProps {
  /** True while recording — flips the control to a "stop" affordance. */
  recording: boolean;
  /** Share of the animation captured so far, 0…1. Shown in place of "Stop". */
  progress?: number;
  /** Hide entirely when the browser can't record canvas video. */
  supported?: boolean;
  disabled?: boolean;
  /** Start a recording (always saves a standard MP4 with the background). */
  onStart?: () => void;
  /** Stop the in-progress recording. */
  onStop?: () => void;
  /** Legacy alias used by tools that wire a single start/stop handler. */
  onClick?: () => void;
}

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

/**
 * Shared MP4 download control for tools with a play/grow animation. Captures the
 * canvas as a standard MP4 while the animation runs. Pairs with
 * {@link useCanvasRecorder}.
 *
 * Gated behind the `MP4_EXPORT_ENABLED` flag, so this renders nothing for every
 * tool unless `VITE_FEATURE_MP4_EXPORT` is set.
 */
export default function RecordButton({
  recording,
  progress = 0,
  supported = true,
  disabled,
  onStart,
  onStop,
  onClick,
}: RecordButtonProps) {
  if (!MP4_EXPORT_ENABLED || !supported) return null;

  if (recording) {
    // Capture renders every frame at export resolution, so it can run slower
    // than the animation itself — the percentage says it's still working.
    const pct = Math.round(progress * 100);
    return (
      <button
        type="button"
        className="btn is-active"
        onClick={onStop ?? onClick}
        disabled={disabled}
        title="Stop recording"
      >
        <StopIcon />
        {pct > 0 ? `${pct}%` : "Stop"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn"
      onClick={onStart ?? onClick}
      disabled={disabled}
      title="Download animation as MP4"
    >
      <DownloadIcon />
      MP4
    </button>
  );
}
