import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { MAX_MARGIN_MM, MIN_MARGIN_MM, pageSizeMm, type PageLayout } from '@legalio/shared/pageLayout';

/** Paragraph indents in millimetres; `first` is the first line's offset from `left` (negative = hanging). */
export interface ParagraphIndent {
  left: number;
  right: number;
  first: number;
}

interface PageRulerProps {
  layout: PageLayout;
  /** The page element the ruler lines up with (its on-screen box already includes the zoom). */
  pageRef: React.RefObject<HTMLElement | null>;
  zoom: number;
  /** Indents of the paragraph with the caret; null when the caret is not in a paragraph. */
  indent: ParagraphIndent | null;
  /** Called while a margin is dragged (not persisted). */
  onPreview: (layout: PageLayout) => void;
  /** Called once when a margin drag ends. */
  onCommit: (layout: PageLayout) => void;
  /** Called once when an indent marker is released. */
  onIndentChange: (indent: ParagraphIndent) => void;
}

const RULER_SIZE = 22;
const MIN_TEXT_MM = 40;
type DragKind = 'marginLeft' | 'marginRight' | 'first' | 'hanging' | 'left' | 'right';

const round = (value: number) => Math.round(value * 10) / 10;

/** Ticks every 2.5 mm, numbered per centimetre counted from `originMm` (Word counts from the left or top margin). */
function ticks(lengthMm: number, mmPx: number, originMm: number, vertical: boolean): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (let step = -Math.floor(originMm / 2.5); originMm + step * 2.5 <= lengthMm; step++) {
    const position = (originMm + step * 2.5) * mmPx;
    const center = RULER_SIZE / 2;
    if (step % 4 === 0) {
      if (step !== 0 && position > 6 && position < lengthMm * mmPx - 6) {
        out.push(<text key={step} x={vertical ? center : position} y={vertical ? position + 3 : center + 3} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>{Math.abs(step / 4)}</text>);
      }
      continue;
    }
    const size = step % 2 === 0 ? 6 : 2;
    out.push(vertical
      ? <line key={step} y1={position} y2={position} x1={center - size / 2} x2={center + size / 2} className="stroke-muted-foreground" strokeWidth={1} />
      : <line key={step} x1={position} x2={position} y1={center - size / 2} y2={center + size / 2} className="stroke-muted-foreground" strokeWidth={1} />);
  }
  return out;
}

/**
 * Horizontal ruler in centimetres aligned with the page: grey margins, white text area, draggable margin edges and
 * Word's indent markers (first line, hanging, left and right indent) for the paragraph with the caret.
 */
export const PageRuler: React.FC<PageRulerProps> = ({ layout, pageRef, zoom, indent, onPreview, onCommit, onIndentChange }) => {
  const { t } = useLanguage();
  const barRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const [draft, setDraft] = useState<ParagraphIndent | null>(null);
  const drag = useRef<{ kind: DragKind; layout: PageLayout; indent: ParagraphIndent } | null>(null);
  const widthMm = pageSizeMm(layout).width;

  // Follow the page horizontally: scrolling, resizing and zooming move it.
  useEffect(() => {
    const measure = () => {
      const page = pageRef.current?.getBoundingClientRect();
      const bar = barRef.current?.getBoundingClientRect();
      if (!page || !bar) return;
      const next = { left: Math.round(page.left - bar.left), width: Math.round(page.width) };
      setBox((previous) => (previous && previous.left === next.left && previous.width === next.width ? previous : next));
    };
    measure();
    const frame = { id: 0 };
    const schedule = () => { cancelAnimationFrame(frame.id); frame.id = requestAnimationFrame(measure); };
    const scroller = pageRef.current?.closest('.overflow-auto');
    window.addEventListener('resize', schedule);
    scroller?.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    if (pageRef.current) observer.observe(pageRef.current);
    if (barRef.current) observer.observe(barRef.current);
    return () => {
      cancelAnimationFrame(frame.id);
      window.removeEventListener('resize', schedule);
      scroller?.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, [pageRef, zoom, layout.paper, layout.orientation]);

  const mmPx = box ? box.width / widthMm : 0;
  const shown = draft ?? indent;
  const { left: marginLeft, right: marginRight } = layout.margins;

  const startDrag = (kind: DragKind) => (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, layout, indent: indent ?? { left: 0, right: 0, first: 0 } };
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || !box || !barRef.current) return;
    const x = event.clientX - barRef.current.getBoundingClientRect().left - box.left;
    const position = Math.min(widthMm, Math.max(0, x / mmPx));
    const textWidth = widthMm - marginLeft - marginRight;
    const start = current.indent;

    if (current.kind === 'marginLeft' || current.kind === 'marginRight') {
      const side = current.kind === 'marginLeft' ? 'left' : 'right';
      const other = side === 'left' ? marginRight : marginLeft;
      const margin = side === 'left' ? position : widthMm - position;
      const clamped = round(Math.min(MAX_MARGIN_MM, widthMm - other - MIN_TEXT_MM, Math.max(MIN_MARGIN_MM, margin)));
      current.layout = { ...layout, margins: { ...layout.margins, [side]: clamped } };
      onPreview(current.layout);
      return;
    }

    const fromMargin = position - marginLeft;
    const firstAbsolute = start.left + start.first;
    let next = start;
    if (current.kind === 'first') next = { ...start, first: round(Math.max(-start.left, Math.min(textWidth - start.right - MIN_TEXT_MM / 4, fromMargin) - start.left)) };
    if (current.kind === 'hanging') {
      const left = round(Math.max(0, Math.min(textWidth - start.right - MIN_TEXT_MM / 4, fromMargin)));
      next = { ...start, left, first: round(firstAbsolute - left) };
    }
    if (current.kind === 'left') {
      const left = round(Math.max(Math.max(0, -start.first), Math.min(textWidth - start.right - MIN_TEXT_MM / 4, fromMargin)));
      next = { ...start, left };
    }
    if (current.kind === 'right') next = { ...start, right: round(Math.max(0, Math.min(textWidth - start.left - MIN_TEXT_MM / 4, widthMm - marginRight - position))) };
    current.indent = next;
    setDraft(next);
  };

  const endDrag = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDraft(null);
    if (current.kind === 'marginLeft' || current.kind === 'marginRight') onCommit(current.layout);
    else onIndentChange(current.indent);
  };

  const handlers = (kind: DragKind) => ({
    onPointerDown: startDrag(kind),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  const markerClass = 'absolute z-10 cursor-ew-resize touch-none border-0 bg-muted-foreground p-0 hover:bg-primary focus-visible:outline-2 focus-visible:outline-ring';
  const leftX = (marginLeft + (shown?.left ?? 0)) * mmPx;
  const firstX = (marginLeft + (shown?.left ?? 0) + (shown?.first ?? 0)) * mmPx;
  const rightX = (widthMm - marginRight - (shown?.right ?? 0)) * mmPx;

  return (
    <div ref={barRef} role="presentation" className="relative shrink-0 overflow-hidden border-b border-border bg-muted/40" style={{ height: RULER_SIZE + 6 }}>
      {box && mmPx > 0 && (
        <div className="absolute top-g3" style={{ left: box.left, width: box.width, height: RULER_SIZE }}>
          <div className="absolute inset-0 bg-border" />
          <div className="absolute inset-y-0 bg-card" style={{ left: marginLeft * mmPx, right: marginRight * mmPx }} />
          <svg width={box.width} height={RULER_SIZE} className="absolute inset-0" aria-hidden="true">{ticks(widthMm, mmPx, marginLeft, false)}</svg>
          {/* Margin edges: drag the boundary between grey and white, like Word. */}
          <span {...handlers('marginLeft')} title={`${t('page.drag_margin_left', 'Geser margin kiri')}: ${marginLeft} mm`} className="absolute inset-y-0 z-0 w-g8 cursor-ew-resize touch-none" style={{ left: marginLeft * mmPx - 4 }} />
          <span {...handlers('marginRight')} title={`${t('page.drag_margin_right', 'Geser margin kanan')}: ${marginRight} mm`} className="absolute inset-y-0 z-0 w-g8 cursor-ew-resize touch-none" style={{ left: (widthMm - marginRight) * mmPx - 4 }} />
          {shown && (
            <>
              <button type="button" {...handlers('first')} aria-label={`${t('ruler.first_line_indent', 'First line indent')}: ${shown.first} mm`} title={t('ruler.first_line_indent', 'First line indent')}
                className={`${markerClass} h-g8 w-g13 [clip-path:polygon(0_0,100%_0,50%_100%)]`} style={{ left: firstX - 6, top: 0 }} />
              <button type="button" {...handlers('hanging')} aria-label={`${t('ruler.hanging_indent', 'Hanging indent')}: ${shown.left} mm`} title={t('ruler.hanging_indent', 'Hanging indent')}
                className={`${markerClass} h-g8 w-g13 [clip-path:polygon(50%_0,100%_100%,0_100%)]`} style={{ left: leftX - 6, top: RULER_SIZE - 13 }} />
              <button type="button" {...handlers('left')} aria-label={`${t('ruler.left_indent', 'Left indent')}: ${shown.left} mm`} title={t('ruler.left_indent', 'Left indent')}
                className={`${markerClass} h-g5 w-g13`} style={{ left: leftX - 6, top: RULER_SIZE - 5 }} />
              <button type="button" {...handlers('right')} aria-label={`${t('ruler.right_indent', 'Right indent')}: ${shown.right} mm`} title={t('ruler.right_indent', 'Right indent')}
                className={`${markerClass} h-g8 w-g13 [clip-path:polygon(50%_0,100%_100%,0_100%)]`} style={{ left: rightX - 6, top: RULER_SIZE - 8 }} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface VerticalRulerProps {
  layout: PageLayout;
  pageRef: React.RefObject<HTMLElement | null>;
  zoom: number;
  /** Zero-based page the ruler follows (the page with the caret). */
  activePage: number;
  /** Distance between the tops of two pages in unzoomed pixels. */
  pageStride: number;
}

/** Vertical ruler beside the workspace, lined up with the active page: grey top and bottom margins, white body. */
export const VerticalRuler: React.FC<VerticalRulerProps> = ({ layout, pageRef, zoom, activePage, pageStride }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const heightMm = pageSizeMm(layout).height;

  useEffect(() => {
    const measure = () => {
      const page = pageRef.current?.getBoundingClientRect();
      const bar = barRef.current?.getBoundingClientRect();
      const element = pageRef.current;
      if (!page || !bar || !element) return;
      const scale = element.offsetWidth ? page.width / element.offsetWidth : 1;
      const height = (page.width / pageSizeMm(layout).width) * heightMm;
      const next = { top: Math.round(page.top - bar.top + activePage * pageStride * scale), height: Math.round(height) };
      setBox((previous) => (previous && previous.top === next.top && previous.height === next.height ? previous : next));
    };
    measure();
    const frame = { id: 0 };
    const schedule = () => { cancelAnimationFrame(frame.id); frame.id = requestAnimationFrame(measure); };
    const scroller = pageRef.current?.closest('.overflow-auto');
    window.addEventListener('resize', schedule);
    scroller?.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    if (pageRef.current) observer.observe(pageRef.current);
    return () => {
      cancelAnimationFrame(frame.id);
      window.removeEventListener('resize', schedule);
      scroller?.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, [pageRef, zoom, layout, activePage, pageStride, heightMm]);

  const mmPx = box ? box.height / heightMm : 0;
  return (
    <div ref={barRef} role="presentation" className="relative w-g26 shrink-0 overflow-hidden border-e border-border bg-muted/40">
      {box && mmPx > 0 && (
        <div className="absolute start-g2" style={{ top: box.top, height: box.height, width: RULER_SIZE }}>
          <div className="absolute inset-0 bg-border" />
          <div className="absolute inset-x-0 bg-card" style={{ top: layout.margins.top * mmPx, bottom: layout.margins.bottom * mmPx }} />
          <svg width={RULER_SIZE} height={box.height} className="absolute inset-0" aria-hidden="true">{ticks(heightMm, mmPx, layout.margins.top, true)}</svg>
        </div>
      )}
    </div>
  );
};
