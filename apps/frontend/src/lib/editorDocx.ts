import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  WidthType,
  convertMillimetersToTwip,
  type FileChild,
  type ParagraphChild,
} from 'docx';
import { pageSizeMm, type PageLayout } from '@legalio/shared/pageLayout';

/**
 * Converts the editor's (already cleaned) HTML into a real .docx that uses the same page setup as the on-screen
 * pages: paper size, orientation, margins, header, footer and page numbers.
 */

const DEFAULT_FONT = 'Arial';
const BODY_HALF_POINTS = 24; // 12 pt
const PX_TO_TWIP = 15;
/** The editor's line height (1.625 em) expressed as Word's "multiple" of Arial's natural 1.15 em line. */
const LINE_SPACING = 340;
const PARAGRAPH_AFTER = 180; // 9 pt, like the editor's paragraph margin
/** Header and footer lines (1.4 em, as on screen) in Word's multiple of a 1.15 em single line. */
const HEADER_FOOTER_LINE_SPACING = 292;

const HEADINGS: Record<string, { size: number; before: number; after: number; level: (typeof HeadingLevel)[keyof typeof HeadingLevel] }> = {
  H1: { size: 45, before: 360, after: 180, level: HeadingLevel.HEADING_1 },
  H2: { size: 36, before: 300, after: 120, level: HeadingLevel.HEADING_2 },
  H3: { size: 30, before: 240, after: 120, level: HeadingLevel.HEADING_3 },
  H4: { size: 26, before: 240, after: 120, level: HeadingLevel.HEADING_4 },
  H5: { size: 24, before: 200, after: 100, level: HeadingLevel.HEADING_5 },
  H6: { size: 24, before: 200, after: 100, level: HeadingLevel.HEADING_6 },
};

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  subScript?: boolean;
  superScript?: boolean;
  color?: string;
  font?: string;
  size?: number;
  highlight?: string;
  shading?: string;
}

interface ListContext {
  ordered: boolean;
  level: number;
  instance: number;
}

const ALIGNMENTS: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

/** `rgb(1, 2, 3)` or `#abc` / `#aabbcc` to `AABBCC`; undefined for anything else. */
export function cssColorToHex(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value.trim());
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return undefined;
  const digits = hex[1].length === 3 ? hex[1].split('').map((digit) => digit + digit).join('') : hex[1];
  return digits.toUpperCase();
}

/** `12pt` or `16px` to Word half-points. */
export function cssSizeToHalfPoints(value: string | null | undefined): number | undefined {
  const match = /^([\d.]+)(pt|px)$/.exec((value || '').trim());
  if (!match) return undefined;
  const points = match[2] === 'pt' ? Number(match[1]) : Number(match[1]) * 0.75;
  return points > 0 ? Math.round(points * 2) : undefined;
}

const firstFont = (value: string | null | undefined) => (value || '').split(',')[0].replaceAll('"', '').replaceAll("'", '').trim() || undefined;

function styleFromElement(element: HTMLElement, inherited: RunStyle): RunStyle {
  const style: RunStyle = { ...inherited };
  switch (element.tagName) {
    case 'STRONG': case 'B': style.bold = true; break;
    case 'EM': case 'I': style.italics = true; break;
    case 'U': case 'INS': style.underline = true; break;
    case 'S': case 'STRIKE': case 'DEL': style.strike = true; break;
    case 'SUB': style.subScript = true; break;
    case 'SUP': style.superScript = true; break;
    case 'MARK': style.highlight = 'yellow'; break;
    case 'CODE': style.font = 'Courier New'; break;
    default: break;
  }
  const css = element.style;
  const color = cssColorToHex(css.color);
  if (color) style.color = color;
  const font = firstFont(css.fontFamily);
  if (font) style.font = font;
  const size = cssSizeToHalfPoints(css.fontSize);
  if (size) style.size = size;
  const background = cssColorToHex(css.backgroundColor);
  if (background && element.tagName === 'SPAN') style.shading = background;
  if (css.fontWeight === 'bold' || Number(css.fontWeight) >= 600) style.bold = true;
  if (css.fontStyle === 'italic') style.italics = true;
  if (css.textDecoration.includes('underline')) style.underline = true;
  if (css.textDecoration.includes('line-through')) style.strike = true;
  return style;
}

function run(text: string, style: RunStyle, extra: { break?: number } = {}): TextRun {
  return new TextRun({
    text,
    break: extra.break,
    bold: style.bold,
    italics: style.italics,
    underline: style.underline ? {} : undefined,
    strike: style.strike,
    subScript: style.subScript,
    superScript: style.superScript,
    color: style.color,
    font: style.font,
    size: style.size,
    highlight: style.highlight as 'yellow' | undefined,
    shading: style.shading ? { type: ShadingType.CLEAR, fill: style.shading, color: 'auto' } : undefined,
  });
}

/** Inline content of an element as Word runs (and hyperlinks). */
function inlineChildren(node: Node, style: RunStyle): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent || '').replace(/\s+/g, ' ');
      if (text) children.push(run(text, style));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const element = child as HTMLElement;
    if (element.tagName === 'BR') {
      children.push(new TextRun({ break: 1 }));
    } else if (element.tagName === 'IMG') {
      const picture = imageRun(element as HTMLImageElement);
      if (picture) children.push(picture);
    } else if (element.hasAttribute('data-page-number')) {
      // Header/footer page fields: Word fills in each page's number or the page count.
      const field = element.getAttribute('data-page-number') === 'total' ? PageNumber.TOTAL_PAGES : PageNumber.CURRENT;
      children.push(new TextRun({ children: [field], bold: style.bold, italics: style.italics, color: style.color, font: style.font, size: style.size }));
    } else if (element.tagName === 'A' && element.getAttribute('href')) {
      children.push(new ExternalHyperlink({
        link: element.getAttribute('href') || '',
        children: inlineChildren(element, { ...styleFromElement(element, style), color: style.color ?? '0563C1', underline: true }) as TextRun[],
      }));
    } else {
      children.push(...inlineChildren(element, styleFromElement(element, style)));
    }
  });
  return children;
}

/** Word picture types, from the data URL the editor stores. */
const IMAGE_TYPES: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' };

/** An editor picture (data URL, size prepared by `prepareImages`) as a Word inline picture; null for other sources. */
function imageRun(image: HTMLImageElement): ImageRun | null {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(image.getAttribute('src') || '');
  const type = match && IMAGE_TYPES[match[1].toLowerCase()];
  const width = Number(image.getAttribute('width'));
  const height = Number(image.getAttribute('height'));
  if (!match || !type || !(width > 0) || !(height > 0)) return null;
  const binary = atob(match[2]);
  const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new ImageRun({ type, data, transformation: { width, height }, floating: floatingOf(image), altText: { name: image.alt || 'Picture', description: image.alt || '', title: image.alt || '' } });
}

const EMU_PER_PX = 9525;

/** Word's floating-picture settings for the editor's Wrap Text choice; undefined keeps the picture in line with text. */
function floatingOf(image: HTMLImageElement) {
  const wrap = image.getAttribute('data-wrap');
  if (!wrap || wrap === 'inline') return undefined;
  const align = image.getAttribute('data-align') === 'right' ? HorizontalPositionAlign.RIGHT
    : image.getAttribute('data-align') === 'center' ? HorizontalPositionAlign.CENTER : HorizontalPositionAlign.LEFT;
  if (wrap === 'behind' || wrap === 'front') {
    // Offset from where the picture is anchored in the text, as dragged on screen.
    return {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.CHARACTER, offset: Math.round(Number(image.getAttribute('data-offset-x') || 0) * EMU_PER_PX) },
      verticalPosition: { relative: VerticalPositionRelativeFrom.LINE, offset: Math.round(Number(image.getAttribute('data-offset-y') || 0) * EMU_PER_PX) },
      wrap: { type: TextWrappingType.NONE },
      behindDocument: wrap === 'behind',
      allowOverlap: true,
    };
  }
  const gap = (wrap === 'tight' ? 6 : wrap === 'through' ? 3 : 12) * EMU_PER_PX;
  // A dragged picture: distance from the paragraph's left (or right) edge and top, as on screen.
  const offsetX = Number(image.getAttribute('data-offset-x') || 0);
  const offsetY = Number(image.getAttribute('data-offset-y') || 0);
  const textWidth = Number(image.getAttribute('data-text-width')) || 0;
  const fromLeft = align === HorizontalPositionAlign.RIGHT ? textWidth - offsetX - Number(image.getAttribute('width')) : offsetX;
  const placed = (offsetX || offsetY) && align !== HorizontalPositionAlign.CENTER;
  return {
    horizontalPosition: placed
      ? { relative: HorizontalPositionRelativeFrom.MARGIN, offset: Math.round(fromLeft * EMU_PER_PX) }
      : { relative: HorizontalPositionRelativeFrom.MARGIN, align },
    verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: Math.round((wrap === 'topBottom' ? 0 : offsetY) * EMU_PER_PX) },
    wrap: wrap === 'topBottom'
      ? { type: TextWrappingType.TOP_AND_BOTTOM }
      : { type: wrap === 'square' ? TextWrappingType.SQUARE : TextWrappingType.TIGHT, side: TextWrappingSide.BOTH_SIDES },
    margins: { top: 4 * EMU_PER_PX, bottom: 4 * EMU_PER_PX, left: gap, right: gap },
  };
}

/**
 * Gives every picture its on-screen size in pixels: the stored width (else the natural width), no wider than the text
 * area, and the height from the picture's own proportions, as the editor shows it.
 */
async function prepareImages(roots: ParentNode[], maxWidthPx: number): Promise<void> {
  const images = roots.flatMap((root) => Array.from(root.querySelectorAll('img')));
  await Promise.all(images.map(async (image) => {
    const probe = new window.Image();
    probe.src = image.getAttribute('src') || '';
    try { await probe.decode(); } catch { return; }
    if (!probe.naturalWidth) return;
    const width = Math.min(maxWidthPx, Number(image.getAttribute('width')) || probe.naturalWidth);
    image.setAttribute('width', String(Math.round(width)));
    image.setAttribute('height', String(Math.round((width * probe.naturalHeight) / probe.naturalWidth)));
    // Right-side pictures are stored as a distance from the right edge; Word needs it from the left.
    image.setAttribute('data-text-width', String(maxWidthPx));
  }));
}

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'DIV', 'SECTION', 'ARTICLE']);

/** Paragraph settings from the editor's data attributes (line spacing, indents, Title / No Spacing style). */
function paragraphFormat(element: HTMLElement, spacing: { line: number; after: number; before?: number }) {
  const mm = (name: string) => Number.parseFloat(element.getAttribute(`data-${name}`) ?? '') || 0;
  const left = convertMillimetersToTwip(mm('indent-left'));
  const right = convertMillimetersToTwip(mm('indent-right'));
  const first = convertMillimetersToTwip(mm('indent-first'));
  const indent = left || right || first
    ? { left: left || undefined, right: right || undefined, firstLine: first > 0 ? first : undefined, hanging: first < 0 ? -first : undefined }
    : undefined;
  const multiple = Number.parseFloat(element.getAttribute('data-line-spacing') ?? '');
  const style = element.getAttribute('data-style');
  const line = style === 'no-spacing' ? 240 : multiple > 0 ? Math.round(multiple * 240) : spacing.line;
  const after = style === 'no-spacing' ? 0 : spacing.after;
  return { indent, spacing: { ...spacing, line, after } };
}

const alignmentOf = (element: HTMLElement) => ALIGNMENTS[element.style.textAlign] ?? (element.getAttribute('data-text-align') ? ALIGNMENTS[element.getAttribute('data-text-align')!] : undefined);

interface Converter {
  contentWidthTwips: number;
  /** Header and footer: compact single-spaced paragraphs, and tables only lay out columns (no cell borders). */
  headerFooter?: boolean;
  nextListInstance: () => number;
}

/** Block-level children of `parent` as Word paragraphs and tables. */
function blocks(parent: Node, converter: Converter, list?: ListContext, base: RunStyle = {}): FileChild[] {
  const out: FileChild[] = [];
  const loose: Node[] = [];
  const flushLoose = () => {
    if (!loose.length) return;
    const holder = document.createElement('div');
    loose.forEach((node) => holder.appendChild(node.cloneNode(true)));
    const children = inlineChildren(holder, base);
    if (children.length && (holder.textContent || '').trim()) {
      out.push(new Paragraph({ children, spacing: { line: LINE_SPACING, after: PARAGRAPH_AFTER } }));
    }
    loose.length = 0;
  };

  parent.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as HTMLElement).tagName)) {
      flushLoose();
      out.push(...blockOf(child as HTMLElement, converter, list, base));
    } else {
      loose.push(child);
    }
  });
  flushLoose();
  return out;
}

function blockOf(element: HTMLElement, converter: Converter, list: ListContext | undefined, base: RunStyle): FileChild[] {
  const tag = element.tagName;
  const align = alignmentOf(element);

  if (tag in HEADINGS) {
    const heading = HEADINGS[tag];
    return [new Paragraph({
      heading: heading.level,
      alignment: align,
      keepNext: true,
      ...paragraphFormat(element, { before: heading.before, after: heading.after, line: 300 }),
      children: inlineChildren(element, { ...base, bold: true, size: heading.size }),
    })];
  }

  if (tag === 'DIV' && element.hasAttribute('data-page-break')) return [new Paragraph({ children: [new PageBreak()] })];

  if (tag === 'P') {
    const title = element.getAttribute('data-style') === 'title';
    return [new Paragraph({
      alignment: align,
      ...paragraphFormat(element, converter.headerFooter
        ? { line: HEADER_FOOTER_LINE_SPACING, after: 0 }
        : { line: title ? 240 : LINE_SPACING, after: list ? 60 : title ? 80 : PARAGRAPH_AFTER }),
      numbering: list ? { reference: list.ordered ? 'numbers' : 'bullets', level: Math.min(list.level, 8), instance: list.instance } : undefined,
      children: inlineChildren(element, title ? { ...base, size: 56 } : base),
    })];
  }

  if (tag === 'UL' || tag === 'OL') {
    const ordered = tag === 'OL';
    // A nested list of the same kind continues its parent's numbering; a different kind starts its own.
    const context: ListContext = {
      ordered,
      level: list ? list.level + 1 : 0,
      instance: list && list.ordered === ordered ? list.instance : converter.nextListInstance(),
    };
    const out: FileChild[] = [];
    element.childNodes.forEach((item) => {
      if (item.nodeType === Node.ELEMENT_NODE && (item as HTMLElement).tagName === 'LI') out.push(...listItem(item as HTMLElement, converter, context, base));
    });
    return out;
  }

  if (tag === 'LI') return listItem(element, converter, list ?? { ordered: false, level: 0, instance: converter.nextListInstance() }, base);

  if (tag === 'BLOCKQUOTE') return quoteBlocks(element, base);

  if (tag === 'PRE') {
    return [new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: 'F1F5F9', color: 'auto' },
      spacing: { line: 260, after: PARAGRAPH_AFTER },
      children: [run(element.textContent || '', { font: 'Courier New', size: 20 })],
    })];
  }

  if (tag === 'HR') {
    return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } }, spacing: { before: 180, after: 180 } })];
  }

  if (tag === 'TABLE') return [tableOf(element, converter, base)];

  // DIV / SECTION / ARTICLE: transparent containers.
  return blocks(element, converter, list, base);
}

function quoteBlocks(element: HTMLElement, base: RunStyle): FileChild[] {
  const paragraphs = Array.from(element.querySelectorAll(':scope > p'));
  return (paragraphs.length ? paragraphs : [element]).map((source) => new Paragraph({
    indent: { left: 360 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'CBD5E1', space: 8 } },
    spacing: { line: LINE_SPACING, after: PARAGRAPH_AFTER },
    children: inlineChildren(source, { ...base, italics: true, color: '475569' }),
  }));
}

function listItem(item: HTMLElement, converter: Converter, context: ListContext, base: RunStyle): FileChild[] {
  const out: FileChild[] = [];
  let usedBullet = false;
  item.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as HTMLElement;
      if (element.tagName === 'UL' || element.tagName === 'OL') {
        out.push(...blockOf(element, converter, context, base));
        return;
      }
      if (element.tagName === 'P') {
        out.push(new Paragraph({
          alignment: alignmentOf(element),
          spacing: { line: LINE_SPACING, after: 60 },
          numbering: usedBullet ? undefined : { reference: context.ordered ? 'numbers' : 'bullets', level: Math.min(context.level, 8), instance: context.instance },
          indent: usedBullet ? { left: 720 * (context.level + 1) } : undefined,
          children: inlineChildren(element, base),
        }));
        usedBullet = true;
        return;
      }
    }
    if (!usedBullet) {
      const holder = document.createElement('div');
      holder.appendChild(child.cloneNode(true));
      if ((holder.textContent || '').trim()) {
        out.push(new Paragraph({
          spacing: { line: LINE_SPACING, after: 60 },
          numbering: { reference: context.ordered ? 'numbers' : 'bullets', level: Math.min(context.level, 8), instance: context.instance },
          children: inlineChildren(holder, base),
        }));
        usedBullet = true;
      }
    }
  });
  if (!out.length) {
    out.push(new Paragraph({ numbering: { reference: context.ordered ? 'numbers' : 'bullets', level: Math.min(context.level, 8), instance: context.instance }, children: [] }));
  }
  return out;
}

function tableOf(table: HTMLElement, converter: Converter, base: RunStyle): Table {
  const rows = Array.from(table.querySelectorAll('tr'));
  const columnCount = Math.max(1, ...rows.map((row) => Array.from(row.children).reduce((sum, cell) => sum + (Number((cell as HTMLElement).getAttribute('colspan')) || 1), 0)));
  const firstRowWidths: number[] = [];
  Array.from(rows[0]?.children ?? []).forEach((cell) => {
    const span = Number((cell as HTMLElement).getAttribute('colspan')) || 1;
    const widths = ((cell as HTMLElement).getAttribute('colwidth') || '').split(',').map(Number);
    for (let i = 0; i < span; i++) firstRowWidths.push(widths[i] > 0 ? widths[i] * PX_TO_TWIP : 0);
  });
  const known = firstRowWidths.filter(Boolean).reduce((sum, width) => sum + width, 0);
  const missing = columnCount - firstRowWidths.filter(Boolean).length;
  const share = missing > 0 ? Math.max(720, Math.floor((converter.contentWidthTwips - known) / missing)) : 0;
  const columnWidths = Array.from({ length: columnCount }, (_, i) => firstRowWidths[i] || share || Math.floor(converter.contentWidthTwips / columnCount));
  const scale = Math.min(1, converter.contentWidthTwips / columnWidths.reduce((sum, width) => sum + width, 0));
  const widths = columnWidths.map((width) => Math.floor(width * scale));

  const border = converter.headerFooter ? { style: BorderStyle.NONE, size: 0, color: 'auto' } : { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const borders = { top: border, bottom: border, left: border, right: border };

  let columnIndex = 0;
  const occupied: number[] = [];
  const tableRows = rows.map((row, rowIndex) => {
    columnIndex = 0;
    const cells = Array.from(row.children).map((cellElement) => {
      const cell = cellElement as HTMLElement;
      while ((occupied[columnIndex] ?? 0) > rowIndex) columnIndex++;
      const columnSpan = Number(cell.getAttribute('colspan')) || 1;
      const rowSpan = Number(cell.getAttribute('rowspan')) || 1;
      const width = widths.slice(columnIndex, columnIndex + columnSpan).reduce((sum, value) => sum + value, 0);
      for (let i = 0; i < columnSpan; i++) occupied[columnIndex + i] = rowIndex + rowSpan;
      columnIndex += columnSpan;
      const isHeader = cell.tagName === 'TH';
      const fill = cssColorToHex(cell.style.backgroundColor) ?? cssColorToHex(cell.getAttribute('data-background-color')) ?? (isHeader ? 'F8FAFC' : undefined);
      const content = blocks(cell, converter, undefined, isHeader ? { ...base, bold: true } : base);
      return new TableCell({
        children: (content.length ? content : [new Paragraph({ children: [] })]) as Paragraph[],
        columnSpan: columnSpan > 1 ? columnSpan : undefined,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
        width: { size: width, type: WidthType.DXA },
        borders,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
      });
    });
    return new TableRow({ children: cells, tableHeader: rowIndex === 0 && Array.from(row.children).every((cell) => (cell as HTMLElement).tagName === 'TH'), cantSplit: true });
  });

  return new Table({ rows: tableRows, columnWidths: widths, width: { size: widths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA } });
}

/** Header or footer HTML as Word paragraphs, or nothing when it is empty. */
function headerFooterBlocks(body: HTMLElement, converter: Converter): Paragraph[] | null {
  if (!body.querySelector('[data-page-number], img') && !(body.textContent || '').trim()) return null;
  const children = blocks(body, { ...converter, headerFooter: true });
  return children.length ? (children as Paragraph[]) : null;
}

export async function htmlToDocxBlob(html: string, layout: PageLayout): Promise<Blob> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const size = pageSizeMm(layout);
  const margins = {
    top: convertMillimetersToTwip(layout.margins.top),
    right: convertMillimetersToTwip(layout.margins.right),
    bottom: convertMillimetersToTwip(layout.margins.bottom),
    left: convertMillimetersToTwip(layout.margins.left),
  };
  const pageWidth = convertMillimetersToTwip(size.width);
  const pageHeight = convertMillimetersToTwip(size.height);
  const contentWidthTwips = pageWidth - margins.left - margins.right;
  let instance = 0;
  const converter: Converter = { contentWidthTwips, nextListInstance: () => ++instance };

  const headerBody = new DOMParser().parseFromString(layout.header, 'text/html').body;
  const footerBody = new DOMParser().parseFromString(layout.footer, 'text/html').body;
  await prepareImages([doc.body, headerBody, footerBody], Math.floor(contentWidthTwips / PX_TO_TWIP));
  const children = blocks(doc.body, converter);
  const header = headerFooterBlocks(headerBody, converter);
  const footer = headerFooterBlocks(footerBody, converter);

  const bulletLevels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: ['•', '◦', '▪'][level % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const numberLevels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));

  const document_ = new Document({
    creator: 'Legalio',
    styles: {
      default: { document: { run: { font: DEFAULT_FONT, size: BODY_HALF_POINTS } } },
    },
    numbering: { config: [{ reference: 'bullets', levels: bulletLevels }, { reference: 'numbers', levels: numberLevels }] },
    sections: [{
      properties: {
        page: {
          size: { width: pageWidth, height: pageHeight, orientation: layout.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { ...margins, header: 720, footer: 720 },
        },
      },
      headers: header ? { default: new Header({ children: header }) } : undefined,
      footers: footer ? { default: new Footer({ children: footer }) } : undefined,
      children: children.length ? children : [new Paragraph({ children: [] })],
    }],
  });
  return Packer.toBlob(document_);
}
