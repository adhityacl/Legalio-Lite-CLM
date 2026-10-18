import DOMPurify from 'dompurify';
import { mmToPx, pageSizePx, type PageLayout } from '@legalio/shared/pageLayout';

export * from '@legalio/shared/pageLayout';

/** Distance of the header and footer text from the page edge (Word's default, 0.5 in). */
export const HEADER_FOOTER_DISTANCE_PX = 48;
export const PAGE_GAP_PX = 28;

/** Header or footer HTML with visible content (text, or a page-number field). */
export const hasHeaderFooterContent = (html: string) => /data-page-number|<img/.test(html) || Boolean(html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());

/**
 * Header or footer as the HTML the pagination extension renders on every page (it uses innerHTML, so the stored HTML
 * is sanitised here): page-number fields become the extension's per-page counter, the page count a fixed number.
 */
export function headerFooterHtml(html: string, pageNumberClass: string, totalPages: number): string {
  if (!hasHeaderFooterContent(html)) return '';
  const holder = document.createElement('div');
  holder.innerHTML = DOMPurify.sanitize(html);
  holder.querySelectorAll('[data-page-number]').forEach((field) => {
    if (field.getAttribute('data-page-number') === 'total') field.replaceWith(String(Math.max(1, totalPages)));
    else field.replaceWith(Object.assign(document.createElement('span'), { className: pageNumberClass }));
  });
  return `<div class="pg-hf-content">${holder.innerHTML}</div>`;
}

/** Rendered heights (px) of the header and footer text, measured on the page. */
export interface HeaderFooterHeights {
  header: number;
  footer: number;
}

/**
 * Options for the pagination extension. Like Word, the header starts 0.5 in from the page edge inside the top margin
 * and the body starts at the margin, or below the header when the header is taller than the margin.
 */
export function paginationOptions(layout: PageLayout, totalPages: number, heights: HeaderFooterHeights = { header: 0, footer: 0 }) {
  const { width, height } = pageSizePx(layout);
  return {
    pageWidth: width,
    pageHeight: height,
    pageGap: PAGE_GAP_PX,
    marginTop: HEADER_FOOTER_DISTANCE_PX,
    marginBottom: HEADER_FOOTER_DISTANCE_PX,
    marginLeft: mmToPx(layout.margins.left),
    marginRight: mmToPx(layout.margins.right),
    // The extension adds the header height itself, so leave it out of the gap above the body.
    contentMarginTop: Math.max(0, mmToPx(layout.margins.top) - HEADER_FOOTER_DISTANCE_PX - heights.header),
    contentMarginBottom: Math.max(0, mmToPx(layout.margins.bottom) - HEADER_FOOTER_DISTANCE_PX - heights.footer),
    headerLeft: headerFooterHtml(layout.header, 'rm-page-number-plus', totalPages),
    headerRight: '',
    footerLeft: headerFooterHtml(layout.footer, 'rm-page-number', totalPages),
    footerRight: '',
  };
}

/** The editor DOM, or null before the editor view is mounted (TipTap 3 throws when `view` is read too early). */
export function mountedEditorDom(editor: { view: { dom: HTMLElement } }): HTMLElement | null {
  try {
    return editor.view.dom;
  } catch {
    return null;
  }
}
