import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import crypto from 'crypto';

/**
 * The CPU-bound half of the OCR pipeline: PDF inspection, per-page text extraction, legal-keyword page scoring and slimming.
 * It touches neither the database nor the request context, so it can run inside a worker thread (see pdfWorkerPool.ts) as well as
 * inline; `cheapOcrPipeline.ts` re-exports everything here.
 */

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


export function computeBufferSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
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

