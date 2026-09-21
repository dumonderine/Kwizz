// Palette for folders + tint derivation for subfolders.

export const FOLDER_PALETTE = [
  "#0284c7", // sky
  "#4f46e5", // indigo-ish (allowed as data color, not UI chrome)
  "#0891b2", // cyan
  "#059669", // emerald
  "#d97706", // amber
  "#dc2626", // red
  "#db2777", // pink
  "#7c3aed", // violet
  "#475569", // slate
  "#0f766e", // teal
];

export const DEFAULT_FOLDER_COLOR = "#0284c7";

function clamp(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

// Mix a hex color toward white to produce a lighter derived tint.
export function lighten(hex: string, factor = 0.28): string {
  try {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const nr = clamp(r + (255 - r) * factor);
    const ng = clamp(g + (255 - g) * factor);
    const nb = clamp(b + (255 - b) * factor);
    return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb
      .toString(16)
      .padStart(2, "0")}`;
  } catch {
    return hex;
  }
}

// Very light tint for backgrounds (chips / icon wells).
export function tintBg(hex: string): string {
  return lighten(hex, 0.82);
}
