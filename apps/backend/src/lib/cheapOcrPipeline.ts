import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import crypto from 'crypto';
import { sql } from '../db';
import { currentAiOrganization } from '../aiLimits';

export interface PdfInspectionReport {
  isScanned: boolean;
  classification: 'digital_text' | 'scanned_image' | 'hybrid';
  textLength: number;
  characterDensity: number;
  inspectionTimeMs: number;
  pageCount: number;
  hasDigitalText: boolean;
}

export interface OptimizedPdfResult {
  optimizedBase64: string;
  originalPageCount: number;
  processedPageCount: number;
  pagesIncluded: number[];
  originalSizeBytes: number;
  optimizedSizeBytes: number;
  mimeType: string;
  extractedText?: string;
  hasDigitalText: boolean;
  inspectionReport: PdfInspectionReport;
  pageScores?: Array<{ page: number; score: number; categories: string[] }>;
  fileHash?: string;
}

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

export function computeBufferSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

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

// Legal keyword taxonomy and category definitions

export interface KeywordCategory {
  name: string;
  weight: number;
  terms: string[];
  regexPatterns?: RegExp[];
}

export const LEGAL_KEYWORD_TAXONOMY: KeywordCategory[] = [
  // A. Identitas Para Pihak & Pembukaan (Parties & Recitals)
  {
    name: 'parties_recitals',
    weight: 25,
    terms: [
      'para pihak', 'pihak pertama', 'pihak kedua', 'yang bertandatangan',
      'menerangkan bahwa', 'komparisi', 'selanjutnya disebut', 'kedudukan hukum',
      'akta pendirian', 'berkedudukan di', 'selaku direktur', 'kuasa hukum',
      'by and between', 'parties', 'first party', 'second party', 'recitals',
      'witnesseth', 'hereinafter referred to', 'duly represented by'
    ],
    regexPatterns: [
      /pihak\s+(?:pertama|kesatu|kedua|ketiga)/i,
      /first\s+party|second\s+party/i
    ]
  },

  // B. Jangka Waktu, Masa Berlaku & Periode (Duration & Term)
  {
    name: 'duration_term',
    weight: 35,
    terms: [
      'jangka waktu', 'masa berlaku', 'periode perjanjian', 'waktu pelaksanaan',
      'mulai berlaku', 'tanggal efektif', 'berakhir pada', 'kedaluwarsa',
      'perpanjangan otomatis', 'masa sewa', 'tenggang waktu', 'durasi kontrak',
      'berlaku efektif', 'perpanjangan berkala', 'sampai pengakhiran',
      'term and termination', 'validity period', 'effective date', 'commencement date',
      'expiration date', 'duration of agreement', 'auto renewal', 'extended period',
      'tacit renewal', 'renewal period', 'initial term'
    ],
    regexPatterns: [
      /(?:jangka\s+waktu|masa\s+berlaku|effective\s+date|term\s+of\s+agreement)/i,
      /\d+\s*(?:hari|bulan|tahun|days|months|years)/i
    ]
  },

  // C. Nilai Kontrak, Harga, Biaya & Komersial (Commercial & Pricing)
  {
    name: 'commercial_pricing',
    weight: 40,
    terms: [
      'nilai kontrak', 'nilai perjanjian', 'harga sewa', 'harga pekerjaan',
      'biaya jasa', 'biaya platform', 'skema pembayaran', 'termin pembayaran',
      'imbalan', 'tata cara pembayaran', 'kompensasi', 'invoice', 'faktur',
      'uang muka', 'pajak pertambahan nilai', 'ppn', 'pph', 'rekening bank',
      'nominal', 'sebesar rp', 'tarif', 'komisi', 'rekening penampung',
      'contract value', 'fee', 'pricing', 'cost of service', 'platform fee',
      'payment terms', 'invoicing', 'consideration', 'commercial terms',
      'schedule of rates', 'compensation', 'service fee', 'monthly recurring'
    ],
    regexPatterns: [
      /(?:rp|idr|\$)\s*[\d\.,]+/i,
      /(?:nilai\s+kontrak|biaya\s+layanan|payment\s+terms|harga\s+total)/i
    ]
  },

  // D. Pengakhiran, Pemutusan & Pemberitahuan (Termination & Notice Period)
  {
    name: 'termination_notice',
    weight: 30,
    terms: [
      'pemutusan perjanjian', 'pengakhiran kerjasama', 'pembatalan', 'surat peringatan',
      'pemberitahuan tertulis', 'masa tenggang', 'pemberitahuan pengakhiran',
      'notice period', 'hari kalender', 'hari kerja sebelum berakhir', 'pengakhiran sepihak',
      'termination', 'termination for convenience', 'termination for cause',
      'written notice', 'prior notice', 'notice period', 'days prior notice',
      'events of default', 'early termination'
    ],
    regexPatterns: [
      /(?:notice\s+period|pemberitahuan\s+tertulis|pengakhiran\s+perjanjian)/i,
      /(?:30|14|60|90)\s*(?:hari|days)/i
    ]
  },

  // E. Denda, Penalti, Ganti Rugi & Sanksi (Penalties & Liabilities)
  {
    name: 'penalties_liability',
    weight: 20,
    terms: [
      'denda keterlambatan', 'sanksi', 'ganti rugi', 'penalti', 'kelalaian',
      'wanprestasi', 'tanggung jawab ganti rugi', 'pembatasan tanggung jawab',
      'liquidated damages', 'late payment penalty', 'indemnity', 'indemnification',
      'limitation of liability', 'breach of contract', 'default penalty'
    ]
  },

  // F. Lampiran, Rincian Biaya & Scope of Work (Attachments & Schedules)
  {
    name: 'attachments_sow',
    weight: 25,
    terms: [
      'lampiran', 'jadwal pelaksanaan', 'rincian biaya', 'spesifikasi teknis',
      'tabel harga', 'addendum', 'amandemen', 'perubahan perjanjian',
      'ketentuan khusus', 'daftar harga', 'ketentuan komersial',
      'appendix', 'attachment', 'schedule', 'annexure', 'exhibit',
      'statement of work', 'sow', 'scope of services', 'pricing matrix'
    ],
    regexPatterns: [
      /(?:lampiran\s+[a-z0-9]|schedule\s+[a-z0-9]|appendix\s+[a-z0-9]|annexure\s+[a-z0-9])/i
    ]
  },

  // G. Eksekusi, Tanda Tangan & Meterai (Execution & Signatures)
  {
    name: 'execution_signatures',
    weight: 35,
    terms: [
      'demikian perjanjian ini dibuat', 'tanda tangan', 'meterai', 'materai',
      'ditandatangani oleh', 'selaku direktur', 'kuasa hukum', 'stempel perusahaan',
      'cap basah', 'rangkap 2', 'bermeterai cukup',
      'in witness whereof', 'signed and executed', 'signatures', 'authorized signatory',
      'stamp & seal', 'duly authorized', 'executed as an agreement'
    ],
    regexPatterns: [
      /(?:tanda\s+tangan|meterai|materai|in\s+witness\s+whereof|signatures)/i
    ]
  }
];

/**
 * Score a text snippet based on the comprehensive legal keyword taxonomy.
 */
export function scoreLegalText(text: string): { score: number; matchedCategories: string[] } {
  if (!text) return { score: 0, matchedCategories: [] };
  const lower = text.toLowerCase();
  let totalScore = 0;
  const matchedCategories: string[] = [];

  for (const cat of LEGAL_KEYWORD_TAXONOMY) {
    let catMatched = false;

    // Check keyword terms
    for (const term of cat.terms) {
      if (lower.includes(term.toLowerCase())) {
        catMatched = true;
        totalScore += cat.weight;
        break;
      }
    }

    // Check regex patterns
    if (!catMatched && cat.regexPatterns) {
      for (const pattern of cat.regexPatterns) {
        if (pattern.test(text)) {
          catMatched = true;
          totalScore += Math.round(cat.weight * 0.8);
          break;
        }
      }
    }

    if (catMatched) {
      matchedCategories.push(cat.name);
    }
  }

  return { score: totalScore, matchedCategories };
}

// Fast inspection and page text extraction

export async function inspectPdfDocument(buffer: Buffer): Promise<{
  report: PdfInspectionReport;
  rawText: string;
  pagesText: Array<{ num: number; text: string }>;
}> {
  const startMs = Date.now();
  let rawText = '';
  let pageCount = 1;
  const pagesText: Array<{ num: number; text: string }> = [];

  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    if (typeof parser.destroy === 'function') {
      try {
        await parser.destroy();
      } catch {
        // ignore
      }
    }
    rawText = (result?.text || '').trim();
    if (result?.total) {
      pageCount = result.total;
    }
    if (Array.isArray(result?.pages)) {
      result.pages.forEach((p: any, idx: number) => {
        pagesText.push({
          num: p.num || idx + 1,
          text: p.text || '',
        });
      });
    }
  } catch {
    rawText = '';
  }

  const inspectionTimeMs = Date.now() - startMs;
  const textLength = rawText.length;
  const characterDensity = pageCount > 0 ? textLength / pageCount : textLength;

  const hasDigitalText = textLength >= 100 && characterDensity >= 40;
  const isScanned = !hasDigitalText;

  let classification: 'digital_text' | 'scanned_image' | 'hybrid' = 'scanned_image';
  if (hasDigitalText) {
    classification = characterDensity > 300 ? 'digital_text' : 'hybrid';
  }

  const report: PdfInspectionReport = {
    isScanned,
    classification,
    textLength,
    characterDensity: Math.round(characterDensity),
    inspectionTimeMs,
    pageCount,
    hasDigitalText,
  };

  return { report, rawText, pagesText };
}

export async function extractDigitalTextFromPdf(buffer: Buffer): Promise<string> {
  const { rawText } = await inspectPdfDocument(buffer);
  return rawText;
}

// Smart page keyword scoring and slimming

/**
 * Intelligent PDF Slimming with Expanded Legal Keyword Page Scoring:
 * 1. If total pages <= 15: preserves 100% of pages.
 * 2. If total pages > 15:
 *    - Always guarantees first 3 pages (Parties, Recitals, Title).
 *    - Always guarantees last 2 pages (Execution, Signatures, Seals).
 *    - Scores middle pages using comprehensive legal keyword taxonomy (Pricing, Duration, Notice, SOW, Penalties).
 *    - Selects top scored pages up to max limit (18-20 pages) in sorted order.
 */
export async function optimizePdfForCheapOcr(pdfInput: string | Buffer): Promise<OptimizedPdfResult> {
  let buffer: Buffer;

  if (typeof pdfInput === 'string') {
    const cleanBase64 = pdfInput.includes('base64,') ? pdfInput.split('base64,')[1] : pdfInput;
    buffer = Buffer.from(cleanBase64, 'base64');
  } else {
    buffer = pdfInput;
  }

  const originalSizeBytes = buffer.length;
  const fileHash = computeBufferSha256(buffer);

  // 1. Fast inspection & per-page text
  const { report, rawText: extractedText, pagesText } = await inspectPdfDocument(buffer);

  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const originalPageCount = pdfDoc.getPageCount();
    report.pageCount = originalPageCount;

    // If PDF is 15 pages or fewer, keep full document
    if (originalPageCount <= 15) {
      const allPages = Array.from({ length: originalPageCount }, (_, i) => i + 1);
      return {
        optimizedBase64: buffer.toString('base64'),
        originalPageCount,
        processedPageCount: originalPageCount,
        pagesIncluded: allPages,
        originalSizeBytes,
        optimizedSizeBytes: originalSizeBytes,
        mimeType: 'application/pdf',
        extractedText,
        hasDigitalText: report.hasDigitalText,
        inspectionReport: report,
        fileHash,
      };
    }

    // Determine crucial page indices (0-indexed) for large agreements (> 15 pages)
    const selectedIndicesSet = new Set<number>();
    const pageScores: Array<{ page: number; score: number; categories: string[] }> = [];

    // Guaranteed opening pages (Pages 1, 2, 3 -> index 0, 1, 2)
    for (let i = 0; i < Math.min(3, originalPageCount); i++) {
      selectedIndicesSet.add(i);
    }

    // Guaranteed closing/execution pages (Last 2 pages)
    if (originalPageCount > 3) {
      selectedIndicesSet.add(originalPageCount - 2);
      selectedIndicesSet.add(originalPageCount - 1);
    }

    // Score all pages using extracted per-page text if available
    const middleCandidateScores: Array<{ index: number; score: number; categories: string[] }> = [];

    if (pagesText && pagesText.length > 0) {
      pagesText.forEach((pt) => {
        const pageIdx = pt.num - 1;
        if (pageIdx >= 0 && pageIdx < originalPageCount) {
          const { score, matchedCategories } = scoreLegalText(pt.text);
          pageScores.push({ page: pt.num, score, categories: matchedCategories });
          if (!selectedIndicesSet.has(pageIdx)) {
            middleCandidateScores.push({ index: pageIdx, score, categories: matchedCategories });
          }
        }
      });
    }

    // Sort middle candidates by score descending
    middleCandidateScores.sort((a, b) => b.score - a.score);

    // Target total processed pages: up to 18 pages
    const maxTargetPages = Math.min(18, originalPageCount);
    const slotsAvailable = maxTargetPages - selectedIndicesSet.size;

    if (middleCandidateScores.length > 0 && slotsAvailable > 0) {
      // Pick top-scoring middle pages (prioritizing pages with detected legal categories)
      const topPicks = middleCandidateScores.slice(0, slotsAvailable);
      topPicks.forEach((pick) => selectedIndicesSet.add(pick.index));
    } else if (selectedIndicesSet.size < maxTargetPages) {
      // Fallback for scanned PDF without digital text: evenly sample important middle sections
      for (let i = 3; i < Math.min(10, originalPageCount); i++) {
        selectedIndicesSet.add(i);
      }
      for (let i = Math.max(0, originalPageCount - 6); i < originalPageCount; i++) {
        selectedIndicesSet.add(i);
      }
    }

    const selectedIndices = Array.from(selectedIndicesSet)
      .filter((idx) => idx >= 0 && idx < originalPageCount)
      .sort((a, b) => a - b);

    // Create a new slim PDF with only selected crucial pages
    const slimDoc = await PDFDocument.create();
    const copiedPages = await slimDoc.copyPages(pdfDoc, selectedIndices);
    copiedPages.forEach((page) => slimDoc.addPage(page));

    const optimizedBytes = await slimDoc.save();
    const optimizedBuffer = Buffer.from(optimizedBytes);

    return {
      optimizedBase64: optimizedBuffer.toString('base64'),
      originalPageCount,
      processedPageCount: selectedIndices.length,
      pagesIncluded: selectedIndices.map((i) => i + 1),
      originalSizeBytes,
      optimizedSizeBytes: optimizedBuffer.length,
      mimeType: 'application/pdf',
      extractedText,
      hasDigitalText: report.hasDigitalText,
      inspectionReport: report,
      pageScores,
      fileHash,
    };
  } catch {
    return {
      optimizedBase64: buffer.toString('base64'),
      originalPageCount: report.pageCount || 1,
      processedPageCount: report.pageCount || 1,
      pagesIncluded: [1],
      originalSizeBytes,
      optimizedSizeBytes: originalSizeBytes,
      mimeType: 'application/pdf',
      extractedText,
      hasDigitalText: report.hasDigitalText,
      inspectionReport: report,
      fileHash,
    };
  }
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
// TODO(perf): PDF inspection/text extraction (pdf-parse, pdf-lib) runs on the event loop and can stall other requests for large
// scans. Move `inspectPdf`/`optimizePdf` into a worker_threads worker (Buffer transferred in, result JSON out); not done in
// Phase 1 because pdf-parse/pdf-lib are bundled by esbuild into a single CJS file and the worker entry needs its own bundle.
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
    const opt = await optimizePdfForCheapOcr(rawInput);
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
