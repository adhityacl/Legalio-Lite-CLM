export interface DiffPart {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

// ponytail: O(n·m) LCS over paragraphs — fine for contracts (hundreds of blocks); switch to Myers if documents reach many thousands.
export function diffParagraphs(before: string[], after: string[]): DiffPart[] {
  const n = before.length;
  const m = after.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      parts.push({ kind: 'same', text: before[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      parts.push({ kind: 'removed', text: before[i++] });
    } else {
      parts.push({ kind: 'added', text: after[j++] });
    }
  }
  while (i < n) parts.push({ kind: 'removed', text: before[i++] });
  while (j < m) parts.push({ kind: 'added', text: after[j++] });
  return parts;
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote';

/** Text of each innermost block element, in document order (browser only). */
export function htmlToParagraphs(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR))
    .filter((el) => !el.querySelector(BLOCK_SELECTOR))
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
