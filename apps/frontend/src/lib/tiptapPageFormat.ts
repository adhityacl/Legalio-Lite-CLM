import { Extension, Node } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

/**
 * Word-style paragraph formatting and manual page breaks for the paged editor.
 *
 * Paragraph attributes are stored twice in the HTML: as data attributes (read back by the editor and the DOCX export)
 * and as inline style (what the screen and print show).
 */

/** Word "multiple" line spacing; 1 is single spacing, which is 1.15 em for Arial-like fonts. */
export const LINE_SPACINGS = ['1', '1.15', '1.5', '2', '2.5', '3'] as const;
const SINGLE_LINE_EM = 1.15;
export const INDENT_STEP_MM = 12.7;
export type ParagraphStyleName = 'title' | 'no-spacing';

const number = (value: string | null) => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setLineSpacing: (multiple: string | null) => ReturnType;
      /** Millimetres; `first` is the first-line offset from `left` (negative for a hanging indent). */
      setParagraphIndent: (indent: { left?: number | null; right?: number | null; first?: number | null }) => ReturnType;
      shiftParagraphIndent: (direction: 1 | -1) => ReturnType;
      setParagraphStyle: (style: ParagraphStyleName | null) => ReturnType;
    };
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}

const TEXT_BLOCKS = ['paragraph', 'heading'];

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',

  addGlobalAttributes() {
    const mm = (name: string, css: (value: number) => string) => ({
      default: null,
      parseHTML: (element: HTMLElement) => number(element.getAttribute(`data-${name}`)),
      renderHTML: (attributes: Record<string, unknown>) => {
        const value = attributes[name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] as number | null;
        return value == null || value === 0 ? {} : { [`data-${name}`]: String(value), style: css(value) };
      },
    });
    return [{
      types: TEXT_BLOCKS,
      attributes: {
        lineSpacing: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-line-spacing'),
          renderHTML: (attributes) => attributes.lineSpacing
            ? { 'data-line-spacing': attributes.lineSpacing, style: `line-height: ${Math.round(Number(attributes.lineSpacing) * SINGLE_LINE_EM * 100) / 100}` }
            : {},
        },
        indentLeft: mm('indent-left', (value) => `margin-left: ${value}mm`),
        indentRight: mm('indent-right', (value) => `margin-right: ${value}mm`),
        indentFirst: mm('indent-first', (value) => `text-indent: ${value}mm`),
        paragraphStyle: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-style'),
          renderHTML: (attributes) => (attributes.paragraphStyle ? { 'data-style': attributes.paragraphStyle } : {}),
        },
      },
    }];
  },

  addCommands() {
    const update = (attributes: Record<string, unknown>) => ({ commands }: { commands: any }) =>
      TEXT_BLOCKS.map((type) => commands.updateAttributes(type, attributes)).some(Boolean);
    return {
      setLineSpacing: (multiple) => update({ lineSpacing: multiple }),
      setParagraphIndent: (indent) => update(Object.fromEntries(
        Object.entries({ indentLeft: indent.left, indentRight: indent.right, indentFirst: indent.first }).filter(([, value]) => value !== undefined),
      )),
      shiftParagraphIndent: (direction) => ({ editor, commands }) => {
        const current = Number(editor.getAttributes('paragraph').indentLeft ?? editor.getAttributes('heading').indentLeft ?? 0);
        const next = Math.max(0, Math.round((current + direction * INDENT_STEP_MM) * 10) / 10);
        return commands.setParagraphIndent({ left: next || null });
      },
      setParagraphStyle: (style) => ({ chain }) =>
        chain().setParagraph().updateAttributes('paragraph', { paragraphStyle: style, lineSpacing: null }).run(),
    };
  },
});

/** Height of each page-break filler: from where the break sits down to the bottom of that page's body. */
function fitPageBreaks(dom: HTMLElement): boolean {
  const breaks = dom.querySelectorAll<HTMLElement>('[data-page-break]');
  if (!breaks.length) return false;
  const box = dom.getBoundingClientRect();
  const scale = dom.offsetWidth ? box.width / dom.offsetWidth : 1;
  let changed = false;
  breaks.forEach((element) => {
    if (element.closest('td, th')) return;
    const top = element.getBoundingClientRect().top;
    // The pagination extension draws each page end (footer, gap, next header) as a "breaker" float.
    const breaker = Array.from(dom.querySelectorAll<HTMLElement>('.breaker'))
      .map((node) => node.getBoundingClientRect())
      .find((rect) => rect.bottom > top + 1);
    // No page end below yet: take one page height so the extension adds the next page, then fit again.
    const height = breaker ? Math.max(0, (breaker.top - top) / scale) : Number.parseFloat(dom.style.getPropertyValue('--rm-page-height')) || 1123;
    if (Math.abs((Number.parseFloat(element.style.height) || 0) - height) > 0.5) {
      element.style.height = `${height}px`;
      changed = true;
    }
  });
  return changed;
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },

  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'page-break' }];
  },

  addCommands() {
    return {
      // Same placement rules as TipTap's horizontal rule: split the paragraph and leave the caret after the break.
      setPageBreak: () => ({ chain, state, editor }) => {
        if (editor.isActive('table')) return false;
        const { $from, $to } = state.selection;
        const current = chain();
        if (state.selection instanceof NodeSelection) current.insertContentAt($to.pos, { type: this.name });
        else if ($from.parentOffset === 0 && $from.parent.content.size === 0) current.insertContentAt({ from: Math.max($from.pos - 1, 0), to: $to.pos }, { type: this.name });
        else current.insertContent({ type: this.name });
        return current.command(({ tr, dispatch }) => {
          if (!dispatch) return true;
          const { $to: end } = tr.selection;
          if (end.nodeAfter?.isTextblock) tr.setSelection(TextSelection.create(tr.doc, end.pos + 1));
          else if (!end.nodeAfter) {
            const paragraph = end.parent.type.contentMatch.defaultType?.create();
            if (paragraph) {
              tr.insert(end.end(), paragraph);
              tr.setSelection(TextSelection.create(tr.doc, end.end() + 1));
            }
          }
          tr.scrollIntoView();
          return true;
        }).run();
      },
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      view: (view) => {
        let frame = 0;
        const fit = () => {
          frame = 0;
          if (!view.dom.isConnected) return;
          // A changed filler moves the content below it: let the pagination extension count the pages again.
          if (fitPageBreaks(view.dom as HTMLElement)) view.dispatch(view.state.tr.setMeta('pageBreakFit', true));
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
        const resize = new ResizeObserver(schedule);
        resize.observe(view.dom);
        schedule();
        return {
          update: schedule,
          destroy: () => { cancelAnimationFrame(frame); resize.disconnect(); },
        };
      },
    })];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageNumber: {
      insertPageNumber: (kind: 'page' | 'total') => ReturnType;
    };
  }
}

/**
 * Page number (or page count) field for headers and footers. Stored as `<span data-page-number="page">`; the page
 * renderer and the DOCX export turn it into the real number of each page.
 */
export const PageNumber = Node.create({
  name: 'pageNumber',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: {
        default: 'page',
        parseHTML: (element) => (element.getAttribute('data-page-number') === 'total' ? 'total' : 'page'),
        renderHTML: (attributes) => ({ 'data-page-number': attributes.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-page-number]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes];
  },

  renderText({ node }) {
    return node.attrs.kind === 'total' ? '{total}' : '{page}';
  },

  addCommands() {
    return {
      insertPageNumber: (kind) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { kind } }),
    };
  },
});
