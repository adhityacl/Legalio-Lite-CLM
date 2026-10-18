import { pageSizeMm, pageSizePx, type PageLayout } from '@legalio/shared/pageLayout';

/**
 * Print / "Save as PDF" of the paged editor. The pages are cloned into an isolated frame sized to the paper, with
 * the gap between pages removed and a page break after each one, so each on-screen page prints as one sheet.
 */
export const PRINT_FRAME_ATTRIBUTE = 'data-legalio-print-frame';

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const documentStyles = () =>
  Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((node) => node.outerHTML)
    .join('\n');

/** The full HTML document that is printed: all app styles, the paper size, and a clone of the pages. */
export function buildPrintHtml(pages: HTMLElement, layout: PageLayout, title: string): string {
  const clone = pages.cloneNode(true) as HTMLElement;
  clone.removeAttribute('contenteditable');
  // Fill-in fields print as their plain value, like the Word download.
  clone.querySelectorAll('.fillable-slot').forEach((slot) => {
    slot.replaceWith(document.createTextNode((slot.querySelector('.slot-value, .slot-text')?.textContent ?? '').trim()));
  });
  clone.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'));
  const { width, height } = pageSizeMm(layout);
  // Exactly N sheets: without the gaps the pages total a pixel or two over, which would print a blank last sheet.
  const pageCount = Math.max(1, clone.querySelector('[data-rm-pagination]')?.children.length ?? 1);
  const sheetsHeight = pageCount * pageSizePx(layout).height;
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${documentStyles()}
<style>
  @page { size: ${width}mm ${height}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .rm-with-pagination { border: 0 !important; box-shadow: none !important; height: ${sheetsHeight}px !important; min-height: 0 !important; overflow: hidden !important; }
  /* One sheet per drawn page: no gap, and a hard page break where the gap was. */
  .rm-pagination-gap { height: 0 !important; border: 0 !important; margin: 0 !important; break-after: page; page-break-after: always; }
  .rm-page-break:last-child .rm-pagination-gap { break-after: auto; page-break-after: auto; }
  .fillable-slot { border: none !important; background: transparent !important; padding: 0 !important; box-shadow: none !important; color: inherit !important; }
  .fillable-slot .slot-icon-badge { display: none !important; }
  .comment-anchor { background: transparent !important; border: none !important; text-decoration: none !important; }
  .comment-anchor::after { content: none !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>${clone.outerHTML}</body>
</html>`;
}

/** Opens the browser's print dialog for the pages (choose "Save as PDF" there). */
export function printEditorDocument(pages: HTMLElement, layout: PageLayout, title: string): void {
  document.querySelectorAll(`iframe[${PRINT_FRAME_ATTRIBUTE}]`).forEach((frame) => frame.remove());
  const frame = document.createElement('iframe');
  frame.setAttribute(PRINT_FRAME_ATTRIBUTE, '');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  const printWindow = frame.contentWindow;
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(buildPrintHtml(pages, layout, title));
  printWindow.document.close();
  printWindow.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 1000), { once: true });
  // Let the cloned styles and fonts settle before the dialog measures the pages.
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 400);
}
