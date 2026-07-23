import { useEffect, useRef, useState } from "react";
import { BRAND_PALETTE } from "../brand/palette";

interface PaletteColorRowProps {
  label: string;
  tip?: string;
  value: string;
  onChange: (hex: string) => void;
}

/**
 * Compact brand-palette picker — one swatch showing the current color; click
 * to open the full palette. Keeps stroke/background on brand without crowding
 * the rail.
 */
export default function PaletteColorRow({
  label,
  tip,
  value,
  onChange,
}: PaletteColorRowProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = value.trim().toLowerCase();
  const current =
    BRAND_PALETTE.find((c) => c.hex.toLowerCase() === active) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className={`tool-param-row${tip ? " has-tip" : ""} palette-row`}
      data-tip={tip}
      ref={ref}
    >
      <span className="tool-param-row__label">{label}</span>
      <div className="palette-row__control">
        <button
          type="button"
          className={`palette-row__trigger${open ? " is-open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${current?.name ?? value}. Choose color`}
          title={current?.name ?? value}
          onClick={() => setOpen((o) => !o)}
        >
          <span
            className="palette-row__trigger-swatch"
            style={{ background: current?.hex ?? value }}
          />
          <span className="palette-row__trigger-name">
            {current?.name ?? value}
          </span>
        </button>
        {open && (
          <div className="palette-row__menu" role="listbox" aria-label={label}>
            {BRAND_PALETTE.map((c) => {
              const selected = active === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`palette-row__swatch${selected ? " is-active" : ""}`}
                  style={{ background: c.hex }}
                  title={c.name}
                  aria-label={c.name}
                  onClick={() => {
                    onChange(c.hex);
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
