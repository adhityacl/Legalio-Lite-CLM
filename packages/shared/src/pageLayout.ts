/**
 * Page setup of a contract document: the one description the on-screen pages, the DOCX export and the print
 * output all read, so they agree on paper size, margins, header and footer.
 */
export type PaperSize = 'A4' | 'LETTER' | 'LEGAL';
export type Orientation = 'portrait' | 'landscape';

export interface PageLayout {
  paper: PaperSize;
  orientation: Orientation;
  /** Millimetres. */
  margins: { top: number; right: number; bottom: number; left: number };
  /**
   * Rich text (editor HTML), repeated on every page. `<span data-page-number="page">` and `"total"` are the page
   * number and the page count. Rendered only after sanitising (see the editor's header and footer rendering).
   */
  header: string;
  footer: string;
}

/** Header or footer text as stored before it became rich text: three plain slots with `{page}` / `{total}`. */
interface LegacyHeaderFooter {
  left?: unknown;
  center?: unknown;
  right?: unknown;
}

export const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  LETTER: { width: 215.9, height: 279.4 },
  LEGAL: { width: 215.9, height: 355.6 },
};

/** Word's margin presets. */
export const MARGIN_PRESETS = {
  normal: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  narrow: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  moderate: { top: 25.4, right: 19.1, bottom: 25.4, left: 19.1 },
  wide: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 },
} as const;

export const DEFAULT_PAGE_LAYOUT: PageLayout = {
  paper: 'A4',
  orientation: 'portrait',
  margins: { ...MARGIN_PRESETS.normal },
  header: '',
  footer: '<p style="text-align: right">Halaman <span data-page-number="page"></span> dari <span data-page-number="total"></span></p>',
};

export const MIN_MARGIN_MM = 5;
export const MAX_MARGIN_MM = 80;
const MAX_TEXT = 300;
// Room for a letterhead logo (pictures are stored inline as compressed data URLs).
const MAX_HTML = 2_000_000;

const PX_PER_MM = 96 / 25.4;
export const mmToPx = (mm: number) => Math.round(mm * PX_PER_MM);
export const pxToMm = (px: number) => Math.round((px / PX_PER_MM) * 10) / 10;

export function pageSizeMm(layout: Pick<PageLayout, 'paper' | 'orientation'>) {
  const paper = PAPER_MM[layout.paper];
  return layout.orientation === 'portrait' ? { width: paper.width, height: paper.height } : { width: paper.height, height: paper.width };
}

export function pageSizePx(layout: Pick<PageLayout, 'paper' | 'orientation'>) {
  const { width, height } = pageSizeMm(layout);
  return { width: mmToPx(width), height: mmToPx(height) };
}

const margin = (value: unknown, fallback: number) => {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) ? Math.round(Math.min(MAX_MARGIN_MM, Math.max(MIN_MARGIN_MM, number)) * 10) / 10 : fallback;
};
const text = (value: unknown, fallback: string) =>
  typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TEXT) : fallback;

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const legacyText = (value: unknown) =>
  escapeHtml(text(value, ''))
    .replaceAll('{page}', '<span data-page-number="page"></span>')
    .replaceAll('{total}', '<span data-page-number="total"></span>');

/** Old three-slot text as rich text: one paragraph per filled slot, aligned like the slot. */
function legacyToHtml(slots: LegacyHeaderFooter): string {
  return (['left', 'center', 'right'] as const)
    .filter((slot) => text(slots[slot], '').trim())
    .map((slot) => (slot === 'left' ? `<p>${legacyText(slots[slot])}</p>` : `<p style="text-align: ${slot === 'center' ? 'center' : 'right'}">${legacyText(slots[slot])}</p>`))
    .join('');
}

/** Header or footer HTML, bounded in size. Not sanitised here: whoever renders it as HTML sanitises it. */
const headerFooter = (value: unknown, fallback: string): string => {
  if (typeof value === 'string') return value.length <= MAX_HTML ? value : fallback;
  if (value && typeof value === 'object') return legacyToHtml(value as LegacyHeaderFooter);
  return fallback;
};

/** Anything stored or sent becomes a valid layout: unknown values fall back to the defaults. */
export function sanitizePageLayout(input: unknown): PageLayout {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const d = DEFAULT_PAGE_LAYOUT;
  return {
    paper: source.paper in PAPER_MM ? source.paper : d.paper,
    orientation: source.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: {
      top: margin(source.margins?.top, d.margins.top),
      right: margin(source.margins?.right, d.margins.right),
      bottom: margin(source.margins?.bottom, d.margins.bottom),
      left: margin(source.margins?.left, d.margins.left),
    },
    header: headerFooter(source.header, d.header),
    footer: headerFooter(source.footer, d.footer),
  };
}

export function parsePageLayout(json: string | null | undefined): PageLayout {
  if (!json) return sanitizePageLayout(undefined);
  try {
    return sanitizePageLayout(JSON.parse(json));
  } catch {
    return sanitizePageLayout(undefined);
  }
}
