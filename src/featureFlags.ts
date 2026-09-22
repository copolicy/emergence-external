/**
 * Build-time feature flags.
 *
 * Vite only substitutes literal `import.meta.env.X` references, so each flag
 * has to read its own variable rather than going through a lookup helper.
 */

const isOn = (value: unknown) => value === "1" || value === "true";
const isOff = (value: unknown) => value === "0" || value === "false";

/**
 * MP4 canvas recording across all tools. On by default; disable with
 * `VITE_FEATURE_MP4_EXPORT=0` in the environment or a `.env` file. The button
 * hides itself anyway on browsers without WebCodecs.
 */
export const MP4_EXPORT_ENABLED = !isOff(import.meta.env.VITE_FEATURE_MP4_EXPORT);

/**
 * Infrastructure vertical (Circuit Traces / jagged). Off by default; enable with
 * `VITE_FEATURE_INFRASTRUCTURE=1` in the environment or a `.env` file.
 */
export const INFRASTRUCTURE_ENABLED = isOn(
  import.meta.env.VITE_FEATURE_INFRASTRUCTURE,
);
