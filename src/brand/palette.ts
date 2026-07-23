// Emergence brand palette — mirrors the named palette in tokens.css.
// The color controls offer exactly these swatches so canvas output (stroke and
// background) is always on brand.

export interface BrandColor {
  name: string;
  hex: string;
}

export const BRAND_PALETTE: BrandColor[] = [
  { name: "White", hex: "#FFFFFF" },
  { name: "Cream", hex: "#F5F5F2" },
  { name: "Pale Green", hex: "#EBFADC" },
  { name: "Pale Brown", hex: "#F6E9DE" },
  { name: "Gold", hex: "#C0B663" },
  { name: "Light Green", hex: "#509137" },
  { name: "Light Brown", hex: "#8A6B4B" },
  { name: "Mid Green", hex: "#195519" },
  { name: "Mid Brown", hex: "#513727" },
  { name: "Text Green", hex: "#083508" },
  { name: "Text Brown", hex: "#381E0D" },
  { name: "Dark Green", hex: "#00280F" },
  { name: "Dark Brown", hex: "#281D07" },
  { name: "Light Gray", hex: "#A6A6A6" },
  { name: "Dark Gray", hex: "#595959" },
  { name: "Black", hex: "#000000" },
];
