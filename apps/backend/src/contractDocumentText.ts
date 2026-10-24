/** Page-aware text of a contract document for extraction: digital PDFs per page, plain text, or the cached transcript of a scan. */
import { PublicError } from './apiErrors';
import { computeBufferSha256, inspectPdfDocument } from './lib/pdfProcessing';
import { getCachedTranscript } from './lib/cheapOcrPipeline';
import type { PageText } from './lib/provenance';

export const MAX_UPLOAD_TEXT_CHARS = 400_000;

/** Pasted/plain text: form feeds separate pages (as `pdftotext` writes them), otherwise it is one page. */
export function pagesFromText(text: string): PageText[] {
  const clipped = String(text ?? '').slice(0, MAX_UPLOAD_TEXT_CHARS);
  const parts = clipped.split('\f');
  return parts.map((part, index) => ({ page: index + 1, text: part })).filter((p) => p.text.trim());
}

export async function pagesFromBuffer(buffer: Buffer): Promise<{ pages: PageText[]; hash: string }> {
  const hash = computeBufferSha256(buffer);
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    const { report, pagesText } = await inspectPdfDocument(buffer);
    if (report.hasDigitalText && pagesText.length) return { pages: pagesText.map((p) => ({ page: p.num, text: p.text })), hash };
    // A scan the contract parser has already read keeps its transcript (organization-scoped); its page boundaries are not known.
    const transcript = await getCachedTranscript(hash);
    if (transcript) return { pages: pagesFromText(transcript), hash };
    throw new PublicError('This PDF has no text layer. Run it through the contract parser first (it keeps a transcript), or upload a text-based PDF.', 422, 'NO_DOCUMENT_TEXT');
  }
  // Plain text only: binary formats are refused instead of being sent to the model as garbage.
  const head = buffer.subarray(0, 4096);
  if (head.includes(0)) throw new PublicError('Only PDF and plain-text files can be analysed.', 415, 'UNSUPPORTED_FILE_TYPE');
  return { pages: pagesFromText(buffer.toString('utf8')), hash };
}
