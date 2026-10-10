import { gray, grayDark, mauve, mauveDark, slate, slateDark, sage, sageDark, olive, oliveDark, sand, sandDark, tomato, tomatoDark, red, redDark, ruby, rubyDark, crimson, crimsonDark, pink, pinkDark, plum, plumDark, purple, purpleDark, violet, violetDark, iris, irisDark, indigo, indigoDark, blue, blueDark, cyan, cyanDark, teal, tealDark, jade, jadeDark, green, greenDark, grass, grassDark, bronze, bronzeDark, gold, goldDark, brown, brownDark, orange, orangeDark, amber, amberDark, yellow, yellowDark, lime, limeDark, mint, mintDark, sky, skyDark } from '@radix-ui/colors';

export interface AccentPalette {
  name: string;
  label: string;
  light: string[];
  dark: string[];
}

/** Official Radix opaque sRGB scales. Step 9 is the stored family identifier. */
export const accentPalettes: AccentPalette[] = [
  { name: 'gray', label: 'Gray', light: Object.values(gray), dark: Object.values(grayDark) },
  { name: 'mauve', label: 'Mauve', light: Object.values(mauve), dark: Object.values(mauveDark) },
  { name: 'slate', label: 'Slate', light: Object.values(slate), dark: Object.values(slateDark) },
  { name: 'sage', label: 'Sage', light: Object.values(sage), dark: Object.values(sageDark) },
  { name: 'olive', label: 'Olive', light: Object.values(olive), dark: Object.values(oliveDark) },
  { name: 'sand', label: 'Sand', light: Object.values(sand), dark: Object.values(sandDark) },
  { name: 'tomato', label: 'Tomato', light: Object.values(tomato), dark: Object.values(tomatoDark) },
  { name: 'red', label: 'Red', light: Object.values(red), dark: Object.values(redDark) },
  { name: 'ruby', label: 'Ruby', light: Object.values(ruby), dark: Object.values(rubyDark) },
  { name: 'crimson', label: 'Crimson', light: Object.values(crimson), dark: Object.values(crimsonDark) },
  { name: 'pink', label: 'Pink', light: Object.values(pink), dark: Object.values(pinkDark) },
  { name: 'plum', label: 'Plum', light: Object.values(plum), dark: Object.values(plumDark) },
  { name: 'purple', label: 'Purple', light: Object.values(purple), dark: Object.values(purpleDark) },
  { name: 'violet', label: 'Violet', light: Object.values(violet), dark: Object.values(violetDark) },
  { name: 'iris', label: 'Iris', light: Object.values(iris), dark: Object.values(irisDark) },
  { name: 'indigo', label: 'Indigo', light: Object.values(indigo), dark: Object.values(indigoDark) },
  { name: 'blue', label: 'Blue', light: Object.values(blue), dark: Object.values(blueDark) },
  { name: 'cyan', label: 'Cyan', light: Object.values(cyan), dark: Object.values(cyanDark) },
  { name: 'teal', label: 'Teal', light: Object.values(teal), dark: Object.values(tealDark) },
  { name: 'jade', label: 'Jade', light: Object.values(jade), dark: Object.values(jadeDark) },
  { name: 'green', label: 'Green', light: Object.values(green), dark: Object.values(greenDark) },
  { name: 'grass', label: 'Grass', light: Object.values(grass), dark: Object.values(grassDark) },
  { name: 'bronze', label: 'Bronze', light: Object.values(bronze), dark: Object.values(bronzeDark) },
  { name: 'gold', label: 'Gold', light: Object.values(gold), dark: Object.values(goldDark) },
  { name: 'brown', label: 'Brown', light: Object.values(brown), dark: Object.values(brownDark) },
  { name: 'orange', label: 'Orange', light: Object.values(orange), dark: Object.values(orangeDark) },
  { name: 'amber', label: 'Amber', light: Object.values(amber), dark: Object.values(amberDark) },
  { name: 'yellow', label: 'Yellow', light: Object.values(yellow), dark: Object.values(yellowDark) },
  { name: 'lime', label: 'Lime', light: Object.values(lime), dark: Object.values(limeDark) },
  { name: 'mint', label: 'Mint', light: Object.values(mint), dark: Object.values(mintDark) },
  { name: 'sky', label: 'Sky', light: Object.values(sky), dark: Object.values(skyDark) },
];

export function findAccentPalette(color: string): AccentPalette | undefined {
  return accentPalettes.find(palette => palette.light[8].toUpperCase() === color.toUpperCase());
}

function rgb(color: string) {
  return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
}

/** WCAG relative luminance, used to keep solid action labels readable. */
export function contrastRatio(first: string, second: string): number {
  const luminance = (color: string) => rgb(color).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mix(first: string, second: string, amount: number): string {
  const a = rgb(first);
  const b = rgb(second);
  return '#' + a.map((value, index) => Math.round(value * (1 - amount) + b[index] * amount).toString(16).padStart(2, '0')).join('');
}

/** Keep the chosen hue while bringing the pair above the text contrast target. */
function readableBackground(background: string, foreground: string, target = 4.5): string {
  if (contrastRatio(background, foreground) >= target) return background;
  const destination = contrastRatio('#000000', foreground) >= contrastRatio('#ffffff', foreground) ? '#000000' : '#ffffff';
  for (let percent = 1; percent <= 100; percent++) {
    const adjusted = mix(background, destination, percent / 100);
    if (contrastRatio(adjusted, foreground) >= target) return adjusted;
  }
  return destination;
}

const darkLabelPalettes = new Set(['amber', 'yellow', 'lime', 'mint', 'sky']);

/** Legacy custom colors remain usable until an organization chooses a Radix family. */
export function organizationThemeTokens(color: string, dark: boolean): Record<string, string> {
  const validColor = /^#[0-9a-f]{6}$/i.test(color) && color.toUpperCase() !== '#06C755' ? color : '#2653F6'; // #06C755 = legacy default green
  const palette = findAccentPalette(validColor);
  const scale = palette?.[dark ? 'dark' : 'light'];
  const paletteSolid = scale?.[8] || validColor;
  const foreground = palette
    ? darkLabelPalettes.has(palette.name) ? '#111111' : '#ffffff'
    : contrastRatio('#ffffff', paletteSolid) >= 4.5 ? '#ffffff' : '#111111';
  const solid = readableBackground(paletteSolid, foreground);
  const hover = readableBackground(scale?.[9] || mix(solid, '#000000', 0.12), foreground, 5);
  const soft = scale?.[2] || mix(validColor, dark ? '#111827' : '#ffffff', dark ? 0.8 : 0.92);
  const surface = dark ? '#111827' : '#ffffff';
  const rawText = scale?.[10] || mix(validColor, dark ? '#ffffff' : '#000000', dark ? 0.55 : 0.45);
  const text = readableBackground(rawText, surface);
  const softText = readableBackground(text, soft);
  const disabledBackground = scale?.[3] || mix(validColor, surface, 0.86);
  const disabledForeground = readableBackground(text, disabledBackground);
  return {
    '--brand-primary': validColor,
    '--line-brand-green': paletteSolid,
    '--line-brand-green-hover': hover,
    '--line-brand-green-light': soft,
    '--line-brand-green-dark': softText,
    '--line-brand-green-text': softText,
    '--line-brand-green-strong': solid,
    '--color-accent-strong-hover': hover,
    '--line-on-accent': foreground,
    '--line-on-accent-hover': foreground,
    '--primary': solid,
    '--primary-foreground': foreground,
    '--primary-hover': hover,
    '--primary-hover-foreground': foreground,
    '--primary-disabled': disabledBackground,
    '--primary-disabled-foreground': disabledForeground,
    '--accent': soft,
    '--accent-foreground': softText,
    '--ring': scale?.[7] || solid,
    '--sidebar-primary': solid,
    '--sidebar-primary-foreground': foreground,
    '--sidebar-accent': soft,
    '--sidebar-accent-foreground': softText,
    '--sidebar-ring': scale?.[7] || solid,
    '--chart-1': solid,
    '--table-selected': soft,
  };
}
