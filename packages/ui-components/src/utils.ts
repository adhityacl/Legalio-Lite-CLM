export { cn } from "./moduix/lib/cn"

/**
 * Text color that stays readable (WCAG AA) on an arbitrary background hex,
 * e.g. a tenant's brand color: white on dark colors, near-black on light ones.
 */
export function readableTextOn(hex: string): '#FFFFFF' | '#111111' {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#FFFFFF';
  const channel = (i: number) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // Pick whichever of white (L=1) / #111111 (L≈0.0056) gives the higher ratio.
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.0556) ? '#FFFFFF' : '#111111';
}
