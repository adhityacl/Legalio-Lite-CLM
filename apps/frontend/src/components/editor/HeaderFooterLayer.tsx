import React, { useEffect, useRef, useState } from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import { useLanguage } from '../../context/LanguageContext';
import { mmToPx, type PageLayout } from '@legalio/shared/pageLayout';
import type { HeaderFooterKind } from './ContractEditorToolbar';

export interface HeaderFooterEditing {
  kind: HeaderFooterKind;
  /** Zero-based page the editing happens on. */
  page: number;
}

interface HeaderFooterLayerProps {
  layout: PageLayout;
  /** The rich-text editor of the header or footer being edited. */
  editor: Editor | null;
  pageCount: number;
  pageHeight: number;
  /** Distance between the tops of two pages (page height plus the gap). */
  pageStride: number;
  /** Distance of the header and footer text from the page edge. */
  textDistance: number;
  editing: HeaderFooterEditing | null;
  /** Leaving the header or footer (click on the page body, or Esc). */
  onExit: () => void;
  /** Clicks inside this element but outside the header or footer end the editing (Word: click the body). */
  boundaryRef: React.RefObject<HTMLElement | null>;
}

/**
 * Word-style header and footer editing on the page itself. The pagination extension draws the header and footer of
 * every page (dimmed); while one is edited this layer adds the dashed boundary and badge on each page and puts the
 * header or footer editor, a full rich-text editor like the body, over the page that was double-clicked.
 */
export const HeaderFooterLayer: React.FC<HeaderFooterLayerProps> = ({
  layout, editor, pageCount, pageHeight, pageStride, textDistance, editing, onExit, boundaryRef,
}) => {
  const { t } = useLanguage();
  const zoneRef = useRef<HTMLDivElement>(null);
  const [textHeight, setTextHeight] = useState(0);

  // Caret into the header or footer when editing starts.
  useEffect(() => {
    if (editing && editor) requestAnimationFrame(() => editor.commands.focus('start'));
  }, [editing?.kind, editing?.page, editor]);

  // The boundary sits below the header text when it grows past the margin, as in Word.
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const observer = new ResizeObserver(() => setTextHeight(zone.offsetHeight));
    observer.observe(zone);
    return () => observer.disconnect();
  }, [editing?.kind, editing?.page]);

  // A click on the page body (or anywhere else in the canvas) ends the editing, like in Word.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (zoneRef.current?.contains(target) || !boundaryRef.current?.contains(target)) return;
      onExit();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, boundaryRef, onExit]);

  if (!editing || !editor) return null;

  const isHeader = editing.kind === 'header';
  const label = isHeader ? t('ribbon.header', 'Header') : t('ribbon.footer', 'Footer');
  const boundary = isHeader
    ? Math.max(mmToPx(layout.margins.top), textDistance + textHeight)
    : Math.min(pageHeight - mmToPx(layout.margins.bottom), pageHeight - textDistance - textHeight);
  const pageTop = editing.page * pageStride;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {Array.from({ length: pageCount }, (_, page) => (
        <React.Fragment key={page}>
          {/* Dashed boundary across the full page width, with the badge on the body side of it. */}
          <div className="absolute inset-x-0 border-t border-dashed border-primary" style={{ top: page * pageStride + boundary }} />
          <span
            className="absolute start-0 rounded-sm bg-primary/10 px-g5 py-g2 text-xs leading-none text-primary"
            style={isHeader ? { top: page * pageStride + boundary + 3 } : { top: page * pageStride + boundary - 3, transform: 'translateY(-100%)' }}
          >
            {label}
          </span>
        </React.Fragment>
      ))}
      <div
        ref={zoneRef}
        role="group"
        aria-label={label}
        // The page number fields show this page's number while editing; every page gets its own when drawn.
        style={{
          top: isHeader ? pageTop + textDistance : pageTop + pageHeight - textDistance,
          transform: isHeader ? undefined : 'translateY(-100%)',
          left: mmToPx(layout.margins.left),
          right: mmToPx(layout.margins.right),
          ['--hf-page' as string]: `"${editing.page + 1}"`,
          ['--hf-total' as string]: `"${pageCount}"`,
        }}
        className="pg-hf-editor pointer-events-auto absolute bg-card"
        onKeyDown={(event) => { if (event.key === 'Escape') onExit(); }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};
