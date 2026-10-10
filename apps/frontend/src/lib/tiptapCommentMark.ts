import { Mark, mergeAttributes, type Editor } from '@tiptap/core';
import type { Mark as PMMark } from '@tiptap/pm/model';
import type { CommentType, DocumentComment } from '@legalio/types/documents';

/**
 * Anchors a comment or suggestion to a text range. Stored in the document HTML as
 * `<span data-comment-id>`, so the anchor follows the text through later edits.
 * `excludes: ''` lets several comments overlap on the same text.
 */
export const CommentAnchor = Mark.create({
  name: 'commentAnchor',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => ({ 'data-comment-id': attrs.commentId }),
      },
      kind: {
        default: 'comment',
        parseHTML: (el) => el.getAttribute('data-comment-kind') || 'comment',
        renderHTML: (attrs) => ({ 'data-comment-kind': attrs.kind }),
      },
      suggestion: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-suggestion'),
        renderHTML: (attrs) => (attrs.suggestion ? { 'data-suggestion': attrs.suggestion } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'comment-anchor' }, HTMLAttributes), 0];
  },
});

export interface SelectionQuote {
  from: number;
  to: number;
  text: string;
}

interface AnchorRange {
  from: number;
  to: number;
  mark: PMMark;
}

function findCommentRanges(editor: Editor, commentId: string): AnchorRange[] {
  const ranges: AnchorRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === 'commentAnchor' && m.attrs.commentId === commentId);
    if (!mark) return;
    const last = ranges[ranges.length - 1];
    if (last && last.to === pos) last.to = pos + node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize, mark });
  });
  return ranges;
}

export function getSelectionQuote(editor: Editor): SelectionQuote | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const text = editor.state.doc.textBetween(from, to, ' ').trim();
  return text ? { from, to, text } : null;
}

/**
 * Locates a plain-text quote (e.g. from an AI suggestion, which only knows text,
 * never document positions) inside the live document, using the same `' '`
 * block-separator convention `addCommentAnchor` validates against below. Returns
 * the first match, or null if the quote can't be found verbatim anymore.
 */
export function findTextRange(editor: Editor, quote: string): SelectionQuote | null {
  const trimmed = quote.trim();
  if (!trimmed) return null;
  const { doc } = editor.state;
  let text = '';
  const posAt: number[] = [];
  let pendingSeparator = false;
  doc.descendants((node, pos) => {
    if (node.isText) {
      if (pendingSeparator) {
        posAt.push(pos);
        text += ' ';
        pendingSeparator = false;
      }
      const nodeText = node.text || '';
      for (let i = 0; i < nodeText.length; i++) posAt.push(pos + i);
      text += nodeText;
      return false;
    }
    if (node.isTextblock && text.length > 0) pendingSeparator = true;
    return true;
  });
  const index = text.indexOf(trimmed);
  if (index === -1) return null;
  const from = posAt[index];
  const to = posAt[index + trimmed.length - 1] + 1;
  return doc.textBetween(from, to, ' ').trim() === trimmed ? { from, to, text: trimmed } : null;
}

/** False when the quoted text moved or changed since it was selected. */
export function addCommentAnchor(
  editor: Editor,
  range: SelectionQuote,
  attrs: { commentId: string; kind: CommentType; suggestion?: string | null },
): boolean {
  const { doc, schema } = editor.state;
  if (range.to > doc.content.size || doc.textBetween(range.from, range.to, ' ').trim() !== range.text) return false;
  editor.view.dispatch(editor.state.tr.addMark(range.from, range.to, schema.marks.commentAnchor.create(attrs)));
  return true;
}

export function removeCommentAnchor(editor: Editor, commentId: string): boolean {
  const ranges = findCommentRanges(editor, commentId);
  if (!ranges.length) return false;
  const tr = editor.state.tr;
  for (const range of ranges) tr.removeMark(range.from, range.to, range.mark);
  editor.view.dispatch(tr);
  return true;
}

/** Replaces the anchored text with the suggestion, keeping the first run's formatting. */
export function applySuggestion(editor: Editor, commentId: string, newText: string): boolean {
  const ranges = findCommentRanges(editor, commentId);
  if (!ranges.length) return false;
  const from = ranges[0].from;
  const to = ranges[ranges.length - 1].to;
  const { doc, schema } = editor.state;
  const marks = (doc.nodeAt(from)?.marks ?? []).filter((m) => m.attrs.commentId !== commentId);
  const tr = editor.state.tr;
  if (newText) tr.replaceWith(from, to, schema.text(newText, marks));
  else tr.delete(from, to);
  editor.view.dispatch(tr);
  return true;
}

export function focusComment(editor: Editor, commentId: string): boolean {
  const [first] = findCommentRanges(editor, commentId);
  if (!first) return false;
  editor.chain().focus().setTextSelection({ from: first.from, to: first.to }).scrollIntoView().run();
  return true;
}

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const unwrap = (el: Element) => el.replaceWith(...Array.from(el.childNodes));

export function stripCommentAnchors(html: string): string {
  if (!html.includes('data-comment-id')) return html;
  const doc = parseHtml(html);
  doc.body.querySelectorAll('span[data-comment-id]').forEach(unwrap);
  return doc.body.innerHTML;
}

export interface RedlineLabels {
  heading: string;
  suggestion: string;
  comment: string;
  deletion: string;
  formatDate: (iso: string) => string;
}

/**
 * Word-importable HTML with open suggestions as <del>/<ins> and open comments as numbered
 * highlights plus an appendix. ponytail: styled markup, not native Word tracked changes
 * (w:ins/w:del); switch to the `docx` package's InsertedTextRun/DeletedTextRun if counsel needs Accept/Reject inside Word.
 */
export function renderRedlineHtml(html: string, comments: DocumentComment[], labels: RedlineLabels): string {
  const doc = parseHtml(html);
  const byId = new Map(comments.map((c) => [c.id, c]));
  const spans = Array.from(doc.body.querySelectorAll('span[data-comment-id]'));
  const lastSpanOf = new Map(spans.map((s) => [s.getAttribute('data-comment-id') || '', s]));
  const notes: DocumentComment[] = [];

  for (const span of spans) {
    const id = span.getAttribute('data-comment-id') || '';
    const comment = byId.get(id);
    if (!comment || comment.status !== 'open') {
      unwrap(span);
      continue;
    }
    const isSuggestion = comment.comment_type === 'suggestion';
    const wrapper = doc.createElement(isSuggestion ? 'del' : 'span');
    wrapper.setAttribute('style', isSuggestion ? 'color:#b91c1c;text-decoration:line-through' : 'background-color:#fef08a');
    wrapper.append(...Array.from(span.childNodes));
    span.replaceWith(wrapper);
    if (lastSpanOf.get(id) !== span) continue;

    notes.push(comment);
    const trailing: Node[] = [];
    if (isSuggestion && comment.new_text) {
      const ins = doc.createElement('ins');
      ins.setAttribute('style', 'color:#15803d;text-decoration:underline');
      ins.textContent = comment.new_text;
      trailing.push(ins);
    }
    const marker = doc.createElement('sup');
    marker.textContent = `[${notes.length}]`;
    trailing.push(marker);
    wrapper.after(...trailing);
  }

  for (const c of comments) {
    if (!c.parent_id && c.status === 'open' && !notes.includes(c)) notes.push(c);
  }
  if (!notes.length) return doc.body.innerHTML;

  const el = (tag: string, text?: string) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const list = el('ol');
  for (const note of notes) {
    const item = el('li');
    const kind = note.comment_type === 'suggestion' ? labels.suggestion : labels.comment;
    item.append(el('strong', note.author_name || '—'), ` (${labels.formatDate(note.created_at)}) — ${kind}`);
    if (note.quote) item.append(el('br'), el('em', `“${note.quote}”`));
    if (note.comment_type === 'suggestion') item.append(' → ', note.new_text ? el('strong', `“${note.new_text}”`) : labels.deletion);
    if (note.body) item.append(el('br'), note.body);
    const replies = comments.filter((c) => c.parent_id === note.id);
    if (replies.length) {
      const sub = el('ul');
      for (const reply of replies) {
        const li = el('li');
        li.append(el('strong', reply.author_name || '—'), `: ${reply.body}`);
        sub.append(li);
      }
      item.append(sub);
    }
    list.append(item);
  }
  doc.body.append(el('hr'), el('h2', labels.heading), list);
  return doc.body.innerHTML;
}
