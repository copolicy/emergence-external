// Emergence brand palette — mirrors the named screen palette in tokens.css.
// The color controls offer exactly these swatches so canvas output (stroke and
// background) is always on brand.
//
// Dark Green (CMYK 81 53 82 73) and Dark Brown (CMYK 61 64 79 76) are print
// only and have no screen hex, so they are not offered here.

export interface BrandColor {
  name: string;
  hex: string;
}

export const BRAND_PALETTE: BrandColor[] = [
  { name: "White", hex: "#FFFFFF" },
  { name: "Cream", hex: "#F8F5EC" },
  { name: "Pale Green", hex: "#EBFADC" },
  { name: "Pale Brown", hex: "#FCEBD7" },
  { name: "Light Gold", hex: "#E5DA8E" },
  { name: "Gold", hex: "#C0B663" },
  { name: "Light Green", hex: "#509137" },
  { name: "Light Brown", hex: "#8A6B4B" },
  { name: "Mid Green", hex: "#195519" },
  { name: "Mid Brown", hex: "#513727" },
  { name: "Text Green", hex: "#0F3214" },
  { name: "Text Brown", hex: "#371E14" },
  { name: "Light Gray", hex: "#A6A6A6" },
  { name: "Dark Gray", hex: "#595959" },
  { name: "Black", hex: "#000000" },
];
