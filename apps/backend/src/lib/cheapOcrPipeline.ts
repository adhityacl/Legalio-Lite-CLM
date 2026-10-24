import { sql } from '../db';
import { computeBufferSha256 } from './pdfProcessing';
import { optimizePdfOffThread } from './pdfWorkerPool';
import { currentAiOrganization } from '../aiLimits';

export interface CheapOcrPayload {
  mode: 'text' | 'vision' | 'hybrid';
  extractedText?: string;
  inlineData?: {
    data: string;
    mimeType: string;
  };
  originalPages: number;
  processedPages: number;
  originalKb: number;
  optimizedKb: number;
  hasDigitalText: boolean;
  summary: string;
  fileHash?: string;
}

// SHA-256 hash calculation and in-memory LRU cache

export function computeInputSha256(input: string | Buffer): string {
  if (Buffer.isBuffer(input)) {
    return computeBufferSha256(input);
  }
  const clean = input.includes('base64,') ? input.split('base64,')[1] : input;
  return computeBufferSha256(Buffer.from(clean, 'base64'));
}

/**
 * Database-backed (table `ai_ocr_cache`, src/schema.ts) instead of an
 * in-memory Map, so a cached OCR/AI result survives a server restart —
 * previously every deploy silently threw away every cached result and
 * forced the next request for an already-analyzed file to re-run OCR/Gemini
 * from scratch. Same public interface as before, so callers are unaffected.
 */
class OcrMemoryCache {
  private readonly maxEntries = 300;
  private readonly ttlMs = 24 * 60 * 60 * 1000; // 24 hours

  private makeKey(hash: string, taskType: string): string {
    return `${taskType}:${hash}`;
  }

  async get(hash: string, taskType: string): Promise<any | null> {
    if (!hash) return null;
    const key = this.makeKey(hash, taskType);
    const row = await sql.get(`SELECT payload, "createdAt" FROM ai_ocr_cache WHERE cache_key = ?`, key) as
      | { payload: string; createdAt: string }
      | undefined;
    if (!row) return null;

    if (Date.now() - new Date(row.createdAt).getTime() > this.ttlMs) {
      await sql.run(`DELETE FROM ai_ocr_cache WHERE cache_key = ?`, key);
      return null;
    }

    try {
      return JSON.parse(row.payload);
    } catch {
      return null;
    }
  }

  async set(hash: string, taskType: string, data: any): Promise<void> {
    if (!hash || !data) return;
    const key = this.makeKey(hash, taskType);
    const count = (await sql.get(`SELECT COUNT(*) AS n FROM ai_ocr_cache`) as { n: number }).n;
    if (count >= this.maxEntries) {
      await sql.run(`DELETE FROM ai_ocr_cache WHERE cache_key IN (
            SELECT cache_key FROM ai_ocr_cache ORDER BY "createdAt" ASC LIMIT ?
          )`, count - this.maxEntries + 1);
    }
    await sql.run(`INSERT INTO ai_ocr_cache (cache_key, payload, "createdAt") VALUES (?, ?, ?) ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, "createdAt" = excluded."createdAt"`, key, JSON.stringify(data), new Date().toISOString());
  }

  async clear(): Promise<void> {
    await sql.run(`DELETE FROM ai_ocr_cache`);
  }

  async size(): Promise<number> {
    return (await sql.get(`SELECT COUNT(*) AS n FROM ai_ocr_cache`) as { n: number }).n;
  }
}

export const globalOcrCache = new OcrMemoryCache();

/**
 * Task-agnostic layer on top of the same `ai_ocr_cache` table (key prefix
 * `transcript:`): the document's plain-text transcript, independent of
 * which feature (partner/spending/contract/IO parse) first read it. A
 * document's content doesn't go stale the way a task-specific structured
 * result might, so reads here skip the 24h TTL the rest of the cache uses.
 * ponytail: shares the 300-entry eviction pool with task-result entries, so
 * a burst of unrelated writes could in theory evict a transcript early —
 * give transcripts their own table/quota if that's ever observed in practice.
 */
/** Transcripts are cached per organization (key `transcript:<organizationId>:<hash>`), so tenants never share OCR output. */
const transcriptScope = () => `transcript:${currentAiOrganization() ?? 'platform'}`;

export async function getCachedTranscript(hash: string): Promise<string | null> {
  if (!hash) return null;
  const row = await sql.get(`SELECT payload FROM ai_ocr_cache WHERE cache_key = ?`, `${transcriptScope()}:${hash}`) as
    | { payload: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

export async function setCachedTranscript(hash: string, text: string): Promise<void> {
  if (!hash || !text.trim()) return;
  await globalOcrCache.set(hash, transcriptScope(), text);
}

/**
 * Clean and structure extracted text for optimal Gemini extraction.
 */
function cleanExtractedTextForLLM(rawText: string): string {
  if (!rawText) return '';
  const cleaned = rawText
    .replace(/[\r\v\f]/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // If text is exceptionally large (> 60k chars), preserve essential beginning and ending execution blocks
  if (cleaned.length > 60000) {
    const head = cleaned.slice(0, 45000);
    const tail = cleaned.slice(-15000);
    return `${head}\n\n... [BAGIAN TENGAH DOKUMEN DISINGKAT OLEH FAST-TRACK OCR] ...\n\n${tail}`;
  }
  return cleaned;
}

/**
 * Builds standard contents array for Gemini generateContent call:
 * - PDF-Inspector Fast Route: If digital text is present (>100 chars), feeds clean text directly (< 1.5s execution time!).
 * - Vision Fallback Route: If scanned/image-heavy, feeds pre-filtered Base64 PDF for Gemini Multimodal OCR.
 */
// PDF inspection and slimming (pdf-parse, pdf-lib) run in a worker thread when the bundle ships `pdfWorker.cjs` (pdfWorkerPool.ts), so a
// large scan does not stall the other requests; without it (development, tests) they run inline.
export async function buildCheapOcrContents(
  rawInput: string | Buffer,
  systemPrompt: string,
  options?: { forceVision?: boolean }
): Promise<{
  contents: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }>;
  ocrStats: {
    mode: 'text' | 'vision';
    originalPages: number;
    processedPages: number;
    originalKb: number;
    optimizedKb: number;
    hasDigitalText: boolean;
    inspectionMs: number;
    classification: string;
    fileHash: string;
    /** Text of each page of the original PDF (fresh digital-text extractions only; absent for cached transcripts and scans). */
    pages?: Array<{ num: number; text: string }>;
  };
}> {
  // Task-agnostic transcript cache: if some earlier call (any feature) already
  // paid for reading this exact file, reuse that transcript instead of
  // re-running PDF inspection/page-scoring or a fresh Gemini vision call.
  if (!options?.forceVision) {
    const earlyHash = computeInputSha256(rawInput);
    const cachedTranscript = await getCachedTranscript(earlyHash);
    if (cachedTranscript) {
      const cleanedText = cleanExtractedTextForLLM(cachedTranscript);
      const formattedContent = `${systemPrompt}\n\n=== DOKUMEN (TRANSKRIP TERSIMPAN / CACHED TRANSCRIPT) ===\n${cleanedText}`;
      return {
        contents: [{ text: formattedContent }],
        ocrStats: {
          mode: 'text',
          originalPages: 0,
          processedPages: 0,
          originalKb: 0,
          optimizedKb: Math.round(Buffer.byteLength(cleanedText, 'utf8') / 1024),
          hasDigitalText: true,
          inspectionMs: 0,
          classification: 'cached_transcript',
          fileHash: earlyHash,
        },
      };
    }
  }

  const isString = typeof rawInput === 'string';
  const isPDF = isString
    ? rawInput.startsWith('JVBERi0') || rawInput.includes('application/pdf') || rawInput.startsWith('data:application/pdf')
    : true;

  if (isPDF) {
    const opt = await optimizePdfOffThread(rawInput);
    const originalKb = Math.round(opt.originalSizeBytes / 1024);
    const optimizedKb = Math.round(opt.optimizedSizeBytes / 1024);
    const report = opt.inspectionReport;
    const fileHash = opt.fileHash || computeInputSha256(rawInput);

    // Fast-Track: Use clean digital text when available and vision not forced
    if (opt.hasDigitalText && opt.extractedText && !options?.forceVision) {
      const cleanedText = cleanExtractedTextForLLM(opt.extractedText);
      const formattedContent = `${systemPrompt}\n\n=== DOKUMEN DIGITAL (PDF-INSPECTOR FAST-TRACK / TEKS ASLI DOKUMEN) ===\n${cleanedText}`;
      // Free byproduct: local extraction already produced this text at no
      // extra (Gemini) cost, so cache it too — the next call for a different
      // task skips even the local pdf-parse/page-scoring work above.
      await setCachedTranscript(fileHash, opt.extractedText);

      return {
        contents: [{ text: formattedContent }],
        ocrStats: {
          mode: 'text',
          originalPages: opt.originalPageCount,
          processedPages: opt.processedPageCount,
          originalKb,
          optimizedKb,
          hasDigitalText: true,
          inspectionMs: report.inspectionTimeMs,
          classification: report.classification,
          fileHash,
          ...(opt.pagesText?.length ? { pages: opt.pagesText } : {}),
        },
      };
    }

    // Vision fallback for scanned documents
    return {
      contents: [
        {
          inlineData: {
            data: opt.optimizedBase64,
            mimeType: 'application/pdf',
          },
        },
        {
          text: systemPrompt,
        },
      ],
      ocrStats: {
        mode: 'vision',
        originalPages: opt.originalPageCount,
        processedPages: opt.processedPageCount,
        originalKb,
        optimizedKb,
        hasDigitalText: opt.hasDigitalText,
        inspectionMs: report.inspectionTimeMs,
        classification: report.classification,
        fileHash,
      },
    };
  }

  // Non-PDF (Images: PNG / JPEG)
  const isPNG = isString && (rawInput.includes('image/png') || rawInput.startsWith('data:image/png'));
  const mimeType = isPNG ? 'image/png' : 'image/jpeg';
  const cleanData = isString ? rawInput.split(',')[1] || rawInput : Buffer.from(rawInput).toString('base64');
  const buffer = Buffer.from(cleanData, 'base64');
  const kbSize = Math.round(cleanData.length * 0.75 / 1024);
  const fileHash = computeBufferSha256(buffer);

  return {
    contents: [
      {
        inlineData: {
          data: cleanData,
          mimeType,
        },
      },
      {
        text: systemPrompt,
      },
    ],
    ocrStats: {
      mode: 'vision',
      originalPages: 1,
      processedPages: 1,
      originalKb: kbSize,
      optimizedKb: kbSize,
      hasDigitalText: false,
      inspectionMs: 0,
      classification: 'image',
      fileHash,
    },
  };
}

export * from './pdfProcessing';
