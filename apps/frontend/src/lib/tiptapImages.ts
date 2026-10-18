import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import Image from '@tiptap/extension-image';

/**
 * Pictures in contract documents: inserted from a file, pasted or dropped, resizable by their corner handles, and
 * laid out with Word's "Wrap Text" choices (in line with text by default).
 *
 * shortcut: pictures are stored inside the document HTML as compressed data URLs (so every saved version carries
 * them); move them to server-side file storage when documents with many pictures make saves slow.
 */

/** Longest side after downscaling; enough for print at the page width. */
const MAX_SIDE_PX = 1600;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

/** Word's "Wrap Text" choices. */
export const IMAGE_WRAPS = ['inline', 'square', 'tight', 'through', 'topBottom', 'behind', 'front'] as const;
export type ImageWrap = (typeof IMAGE_WRAPS)[number];
export type ImageAlign = 'left' | 'center' | 'right';
/** Wraps that take the picture out of the text and place it at a dragged offset from where it is anchored. */
export const FREE_WRAPS: ReadonlySet<ImageWrap> = new Set(['behind', 'front']);
/** Wraps where text flows beside the picture, so it can only sit at the left or the right. */
export const SIDE_WRAPS: ReadonlySet<ImageWrap> = new Set(['square', 'tight', 'through']);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageFormat: {
      setImageWrap: (wrap: ImageWrap) => ReturnType;
      setImageAlign: (align: ImageAlign) => ReturnType;
      /** Width in px; the height follows the picture's proportions. */
      setImageWidth: (width: number) => ReturnType;
      setImageAlt: (alt: string) => ReturnType;
    };
  }
}

const numberAttribute = (name: string) => ({
  default: 0,
  parseHTML: (element: HTMLElement) => Number(element.getAttribute(`data-${name}`)) || 0,
  renderHTML: () => ({}),
});

/** Margins (px) that place a picture at its dragged position, for its wrap and side. */
type WrapMargins = { left?: number; right?: number; top?: number };

/** Layout of a picture's box from its wrap settings, on the editor's picture box and on the stored `<img>`. */
function wrapLayout(attrs: Record<string, any>): { data: Record<string, string>; margins: WrapMargins } {
  const wrap: ImageWrap = IMAGE_WRAPS.includes(attrs.wrap) ? attrs.wrap : 'inline';
  if (wrap === 'inline') return { data: {}, margins: {} };
  const align: ImageAlign = SIDE_WRAPS.has(wrap) && attrs.align === 'center' ? 'left' : attrs.align ?? 'left';
  const x = Math.round(attrs.offsetX || 0);
  const y = Math.round(attrs.offsetY || 0);
  const data: Record<string, string> = { 'data-wrap': wrap, 'data-align': align };
  if (x || y || FREE_WRAPS.has(wrap)) Object.assign(data, { 'data-offset-x': String(x), 'data-offset-y': String(y) });
  // Behind / in front: offset from where the picture is anchored. Wrapped pictures: distance from the paragraph's
  // left or right edge (on the side the picture sits) and from its top. Top and bottom: distance from the left.
  if (FREE_WRAPS.has(wrap)) return { data, margins: { left: x, top: y } };
  if (!x && !y) return { data, margins: {} };
  if (wrap === 'topBottom') return { data, margins: align === 'center' ? {} : align === 'right' ? { right: x } : { left: x } };
  return { data, margins: { ...(align === 'right' ? { right: x } : { left: x }), top: y } };
}

const marginStyle = (margins: WrapMargins) =>
  Object.entries(margins).map(([side, value]) => `margin-${side}: ${value}px`).join('; ');

function applyWrapLayout(box: HTMLElement, attrs: Record<string, any>) {
  for (const name of ['data-wrap', 'data-align', 'data-offset-x', 'data-offset-y']) box.removeAttribute(name);
  box.style.marginLeft = '';
  box.style.marginRight = '';
  box.style.marginTop = '';
  const { data, margins } = wrapLayout(attrs);
  Object.entries(data).forEach(([name, value]) => box.setAttribute(name, value));
  if (margins.left !== undefined) box.style.marginLeft = `${margins.left}px`;
  if (margins.right !== undefined) box.style.marginRight = `${margins.right}px`;
  if (margins.top !== undefined) box.style.marginTop = `${margins.top}px`;
}

/**
 * Where a dragged picture lands, from its box on screen after the drag (Word: pictures move freely in every wrap mode,
 * also out into the page margins). Returns the document position to anchor it at and its new attributes; null when it
 * was dropped outside the text.
 */
function dropTarget(view: EditorView, attrs: Record<string, any>, box: DOMRect, pointer: { x: number; y: number }, scale: number):
  { anchor: number; attrs: Record<string, any> } | null {
  const wrap: ImageWrap = attrs.wrap ?? 'inline';
  // The anchor is looked up at the nearest point inside the text area; the picture itself may sit outside it.
  const page = view.dom as HTMLElement;
  const bounds = page.getBoundingClientRect();
  const padding = getComputedStyle(page);
  const inside = (x: number, y: number) => ({
    left: Math.min(bounds.right - Number.parseFloat(padding.paddingRight) * scale - 2, Math.max(bounds.left + Number.parseFloat(padding.paddingLeft) * scale + 2, x)),
    top: Math.min(bounds.bottom - 2, Math.max(bounds.top + 2, y)),
  });
  const at = (x: number, y: number) => {
    const found = view.posAtCoords(inside(x, y));
    if (!found) return null;
    const $pos = view.state.doc.resolve(found.pos);
    return $pos.parent.inlineContent ? $pos : null;
  };
  if (wrap === 'inline') {
    const $pos = at(pointer.x, pointer.y);
    return $pos ? { anchor: $pos.pos, attrs } : null;
  }
  // Anchor in the paragraph under the picture's top-left corner (or under the pointer when that is outside the text).
  const $pos = at(box.left + 2, box.top + 2) ?? at(pointer.x, pointer.y);
  if (!$pos) return null;
  const paragraph = view.nodeDOM($pos.before()) as HTMLElement | null;
  const edges = paragraph?.getBoundingClientRect();
  if (!edges) return null;
  if (wrap === 'topBottom') {
    return { anchor: $pos.pos, attrs: { ...attrs, align: 'left', offsetX: Math.round((box.left - edges.left) / scale), offsetY: 0 } };
  }
  // Text flows on the side away from the picture: the half of the paragraph it is dropped in decides the side.
  const right = box.left + box.width / 2 > (edges.left + edges.right) / 2;
  return {
    anchor: $pos.start(),
    attrs: {
      ...attrs,
      align: right ? 'right' : 'left',
      offsetX: Math.round((right ? edges.right - box.right : box.left - edges.left) / scale),
      offsetY: Math.round((box.top - edges.top) / scale),
    },
  };
}

/** Whether a screen point is on a character of text (as opposed to empty space in a paragraph). */
function onLetter(x: number, y: number): boolean {
  const caret = document.caretRangeFromPoint?.(x, y);
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const text = caret.startContainer as Text;
  const range = document.createRange();
  for (const offset of [caret.startOffset - 1, caret.startOffset]) {
    if (offset < 0 || offset >= text.length) continue;
    range.setStart(text, offset);
    range.setEnd(text, offset + 1);
    if (Array.from(range.getClientRects()).some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return true;
  }
  return false;
}

/**
 * Changes the selected picture and keeps it selected (TipTap's updateAttributes turns the picture selection into a
 * caret, which would hide the Picture Format tab and drop a behind-text picture back under the text).
 */
const updateSelectedPicture = (change: (attrs: Record<string, any>) => Record<string, any>) =>
  ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
    const { selection } = tr;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return false;
    if (dispatch) {
      tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, ...change(selection.node.attrs) });
      tr.setSelection(NodeSelection.create(tr.doc, selection.from));
    }
    return true;
  };

export const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      wrap: {
        default: 'inline',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-wrap') || 'inline',
        // One renderer for all wrap attributes, so the stored picture carries a consistent layout.
        renderHTML: (attributes: Record<string, any>) => {
          const { data, margins } = wrapLayout(attributes);
          const style = marginStyle(margins);
          return style ? { ...data, style } : data;
        },
      },
      align: { default: 'left', parseHTML: (element: HTMLElement) => element.getAttribute('data-align') || 'left', renderHTML: () => ({}) },
      offsetX: numberAttribute('offset-x'),
      offsetY: numberAttribute('offset-y'),
    };
  },

  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;
    return (props) => {
      const view = parent(props) as any;
      const box = view.dom as HTMLElement;
      let attrs = props.node.attrs;
      applyWrapLayout(box, attrs);
      const update = view.update?.bind(view);
      view.update = (node: any, ...rest: any[]) => {
        const kept = update ? update(node, ...rest) : false;
        if (kept) {
          attrs = node.attrs;
          applyWrapLayout(box, attrs);
          // The resize view only sizes the picture while dragging; a width typed in the ribbon is applied here.
          const image = box.querySelector('img');
          if (image && attrs.width) image.style.width = `${attrs.width}px`;
        }
        return kept;
      };
      // Drag the picture to where it should sit, in every wrap mode (Word): behind / in front of text it stays
      // anchored and keeps the offset; otherwise it moves into the text where it is dropped.
      box.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('[data-resize-handle]') || !props.editor.isEditable) return;
        event.preventDefault();
        const editorView = props.editor.view;
        const page = editorView.dom as HTMLElement;
        const scale = page.offsetWidth ? page.getBoundingClientRect().width / page.offsetWidth : 1;
        const start = { x: event.clientX, y: event.clientY };
        let moved = { x: 0, y: 0 };
        box.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => {
          moved = { x: moveEvent.clientX - start.x, y: moveEvent.clientY - start.y };
          box.style.transform = `translate(${moved.x / scale}px, ${moved.y / scale}px)`;
        };
        const end = (endEvent: PointerEvent) => {
          box.removeEventListener('pointermove', move);
          box.removeEventListener('pointerup', end);
          box.removeEventListener('pointercancel', end);
          const dropped = box.getBoundingClientRect();
          box.style.transform = '';
          const position = typeof props.getPos === 'function' ? props.getPos() : undefined;
          if (position === undefined) return;
          // The cancelled pointer event kept the editor from focusing and selecting: focus first, then select.
          editorView.focus();
          const dragged = Math.hypot(moved.x, moved.y) >= 4 && endEvent.type === 'pointerup';
          const { state } = editorView;
          const node = state.doc.nodeAt(position);
          if (!node) return;
          const tr = state.tr;
          if (dragged && FREE_WRAPS.has(attrs.wrap)) {
            tr.setNodeMarkup(position, undefined, { ...attrs, offsetX: Math.round((attrs.offsetX || 0) + moved.x / scale), offsetY: Math.round((attrs.offsetY || 0) + moved.y / scale) });
            tr.setSelection(NodeSelection.create(tr.doc, position));
          } else if (dragged) {
            const target = dropTarget(editorView, attrs, dropped, { x: endEvent.clientX, y: endEvent.clientY }, scale);
            if (!target) {
              tr.setSelection(NodeSelection.create(tr.doc, position));
            } else {
              tr.delete(position, position + node.nodeSize);
              const anchor = tr.mapping.map(target.anchor);
              tr.insert(anchor, node.type.create(target.attrs, node.content, node.marks));
              tr.setSelection(NodeSelection.create(tr.doc, anchor));
              editorView.dispatch(tr);
              // Taking the picture out of its old place can move the text below; nudge it once to where it was dropped.
              if (target.attrs.wrap !== 'inline') requestAnimationFrame(() => {
                const placed = (editorView.nodeDOM(anchor) as HTMLElement | null)?.getBoundingClientRect();
                const current = editorView.state.doc.nodeAt(anchor);
                if (!placed || current?.type.name !== 'image') return;
                const dx = (dropped.left - placed.left) / scale;
                const dy = target.attrs.wrap === 'topBottom' ? 0 : (dropped.top - placed.top) / scale;
                if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
                const offsetX = Math.round(current.attrs.offsetX + (current.attrs.align === 'right' ? -dx : dx));
                const fix = editorView.state.tr.setNodeMarkup(anchor, undefined, { ...current.attrs, offsetX, offsetY: Math.round(current.attrs.offsetY + dy) });
                editorView.dispatch(fix.setSelection(NodeSelection.create(fix.doc, anchor)));
              });
              return;
            }
          } else {
            tr.setSelection(NodeSelection.create(tr.doc, position));
          }
          editorView.dispatch(tr);
        };
        box.addEventListener('pointermove', move);
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);
      });
      return view;
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      // Behind-text pictures lie under the text, which catches clicks: a click that is not on a letter selects them.
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const behind = document.elementsFromPoint(event.clientX, event.clientY)
                .find((element) => element.matches('[data-resize-container][data-wrap="behind"]'));
              if (!behind || behind.contains(event.target as Node) || onLetter(event.clientX, event.clientY)) return false;
              const position = view.posAtDOM(behind, 0);
              const at = view.state.doc.nodeAt(position)?.type.name === 'image' ? position : position - 1;
              if (view.state.doc.nodeAt(at)?.type.name !== 'image') return false;
              event.preventDefault();
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
              view.focus();
              return true;
            },
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageWrap: (wrap) => updateSelectedPicture(() => ({ wrap, offsetX: 0, offsetY: 0 })),
      setImageAlign: (align) => updateSelectedPicture(() => ({ align, offsetX: 0, offsetY: 0 })),
      setImageAlt: (alt) => updateSelectedPicture(() => ({ alt })),
      setImageWidth: (width) => updateSelectedPicture(({ width: oldWidth, height: oldHeight }) => {
        const ratio = Number(oldHeight) > 0 && Number(oldWidth) > 0 ? Number(oldHeight) / Number(oldWidth) : null;
        return { width: Math.round(width), height: ratio ? Math.round(width * ratio) : null };
      }),
    };
  },
}).configure({
  inline: true,
  allowBase64: true,
  resize: { enabled: true, directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], minWidth: 24, minHeight: 24, alwaysPreserveAspectRatio: true },
});

export class ImageTooLargeError extends Error {}

/** A picture file as a downscaled data URL and its size: JPEG, or PNG when the picture has transparency or PNG is smaller. */
export async function compressImage(file: File): Promise<{ src: string; width: number; height: number }> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageTooLargeError(file.name);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  let transparent = false;
  for (let alpha = 3; alpha < pixels.length && !transparent; alpha += 4) transparent = pixels[alpha] < 255;
  if (transparent) return { src: canvas.toDataURL('image/png'), width, height };
  // Screenshots of text are often smaller (and sharper) as PNG, photos as JPEG: keep the smaller one.
  const jpeg = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const png = file.type === 'image/png' ? canvas.toDataURL('image/png') : null;
  return { src: png && png.length < jpeg.length ? png : jpeg, width, height };
}

const imageFiles = (files: FileList | File[] | null | undefined) => Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));

/**
 * Inserts picture files at `position` (default: the selection). Shown at most as wide as the text area; resizing
 * later changes the stored width and height.
 */
export async function insertImageFiles(editor: Editor, files: FileList | File[], position?: number, onError?: (error: unknown) => void) {
  const textWidth = (editor.view.dom as HTMLElement).clientWidth || 600;
  for (const file of imageFiles(files)) {
    try {
      const image = await compressImage(file);
      const scale = Math.min(1, textWidth / image.width);
      const attrs = { src: image.src, alt: file.name.replace(/\.[^.]+$/, ''), width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
      const chain = editor.chain().focus();
      if (position === undefined) chain.setImage(attrs).run();
      else chain.insertContentAt(position, { type: 'image', attrs }).run();
    } catch (error) {
      onError?.(error);
    }
  }
}

/** Paste and drop of picture files (screenshots, files from the desktop) into the editor. */
export const ImagePasteDrop = Extension.create<{ onError?: (error: unknown) => void }>({
  name: 'imagePasteDrop',

  addOptions() {
    return { onError: undefined };
  },

  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [new Plugin({
      props: {
        handlePaste: (_view, event) => {
          const files = imageFiles(event.clipboardData?.files);
          // Copied text with pictures (web pages, Word) pastes as HTML; only a bare picture is taken as a file.
          const text = event.clipboardData?.getData('text/plain')?.trim();
          if (!files.length || text) return false;
          event.preventDefault();
          void insertImageFiles(editor, files, undefined, options.onError);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = imageFiles(event.dataTransfer?.files);
          if (moved || !files.length) return false;
          event.preventDefault();
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertImageFiles(editor, files, position, options.onError);
          return true;
        },
      },
    })];
  },
});
