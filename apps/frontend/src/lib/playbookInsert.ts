import type { Editor } from '@tiptap/core';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Plain wording as editor paragraphs (blank-line separated blocks; single line breaks stay inside the paragraph). */
export const wordingToHtml = (text: string) =>
  text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

/** The document range of `quote` (a sentence the playbook check reported, whitespace-collapsed), or null when it is no longer in the document. */
export function findQuoteRange(editor: Editor, quote: string): { from: number; to: number } | null {
  const tokens = quote.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const regex = new RegExp(tokens.map(escapeRegex).join('[\\s\\ufffc]+'));
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isTextblock) return !found;
    // Leaf inline nodes (hard breaks, fill-in slots) count as one character, so offsets in this text are offsets in the document.
    const text = node.textBetween(0, node.content.size, '\n', '￼');
    const match = regex.exec(text);
    if (match) found = { from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length };
    return false;
  });
  return found;
}

/** Puts the library wording into the document: over the quoted sentence when it is still there, else at the cursor. Returns what happened. */
export function applyPlaybookWording(editor: Editor, wording: string, quote: string | null): 'replaced' | 'inserted' {
  if (quote) {
    const range = findQuoteRange(editor, quote);
    if (range) {
      editor.chain().focus().insertContentAt(range, wording.replace(/\s*\n\s*/g, ' ').trim()).run();
      return 'replaced';
    }
  }
  editor.chain().focus().insertContent(wordingToHtml(wording)).run();
  return 'inserted';
}
