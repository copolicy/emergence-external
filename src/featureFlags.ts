/**
 * Build-time feature flags.
 *
 * Vite only substitutes literal `import.meta.env.X` references, so each flag
 * has to read its own variable rather than going through a lookup helper.
 */

const isOn = (value: unknown) => value === "1" || value === "true";

/**
 * MP4 canvas recording across all tools. Off by default; enable with
 * `VITE_FEATURE_MP4_EXPORT=1` in the environment or a `.env` file.
 */
export const MP4_EXPORT_ENABLED = isOn(import.meta.env.VITE_FEATURE_MP4_EXPORT);

/**
 * Infrastructure vertical (Circuit Traces / jagged). Off by default; enable with
 * `VITE_FEATURE_INFRASTRUCTURE=1` in the environment or a `.env` file.
 */
export const INFRASTRUCTURE_ENABLED = isOn(
  import.meta.env.VITE_FEATURE_INFRASTRUCTURE,
);
