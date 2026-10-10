/**
 * Standard File Naming Utilities
 * 
 * Formats:
 * - Contract:           Contract-[Partner Name]-[Document Type]-[Start Date]-[Contract No].[ext]
 * - Agreement Addendum: Contract-[Partner Name]-Agreement Addendum-[Start Date]-[Addendum No].[ext]
 * - IO:                 IO-[Partner Name]-[Media Channel]-[Start Date]-[IO No].[ext]
 * - Invoice:            Invoice-[Vendor Name]-[Period]-[Invoice Date]-[Invoice No].[ext]
 * - Billing:            Billing-[Vendor Name]-[Period]-[Invoice Date]-[Invoice No].[ext]
 * - Due Diligence:      DD-[Vendor Name]-[Document Name]-[Document Date]-[Sequence].[ext]
 */

export function sanitizeFilePart(val: string | undefined | null, fallback = ''): string {
  if (!val) return fallback;
  const sanitized = String(val)
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
}

export function getFileExtension(fileNameOrExt: string | undefined | null, defaultExt = '.pdf'): string {
  if (!fileNameOrExt) return defaultExt;
  const match = fileNameOrExt.match(/\.[0-9a-z]+$/i);
  if (match) return match[0];
  if (fileNameOrExt.startsWith('.')) return fileNameOrExt;
  return `.${fileNameOrExt}`;
}

/**
 * Converts date string (YYYY-MM-DD, DD/MM/YYYY, ISO string, or Date) to YYYYMMDD.
 * Example: "2023-02-09" -> "20230209", "09/02/2023" -> "20230209"
 */
export function formatToYYYYMMDD(dateVal?: string | Date | null, fallback = ''): string {
  if (!dateVal) {
    if (fallback) return fallback;
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }
  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return fallback || '20260101';
    return `${dateVal.getFullYear()}${String(dateVal.getMonth() + 1).padStart(2, '0')}${String(dateVal.getDate()).padStart(2, '0')}`;
  }
  const str = String(dateVal).trim();
  if (/^\d{8}$/.test(str)) return str;

  // YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}${ymdMatch[2].padStart(2, '0')}${ymdMatch[3].padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}${dmyMatch[2].padStart(2, '0')}${dmyMatch[1].padStart(2, '0')}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  const digits = str.replace(/[^0-9]/g, '');
  if (digits.length >= 8) return digits.slice(0, 8);
  return digits || fallback || '20260101';
}

/**
 * Converts period string (YYYY-MM, YYYYMM, array) to YYYYMM.
 * Example: "2023-02" -> "202302", ["2023-02", "2023-03"] -> "202302"
 */
export function formatToYYYYMM(periodVal?: string | string[] | null, fallback = ''): string {
  if (!periodVal) {
    if (fallback) return fallback;
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (Array.isArray(periodVal)) {
    const valid = periodVal.map((p) => formatToYYYYMM(p)).filter(Boolean);
    return valid[0] || fallback || '202601';
  }
  const str = String(periodVal).trim();
  if (/^\d{6}$/.test(str)) return str;

  const ymMatch = str.match(/^(\d{4})[-/.](\d{1,2})/);
  if (ymMatch) {
    return `${ymMatch[1]}${ymMatch[2].padStart(2, '0')}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  const digits = str.replace(/[^0-9]/g, '');
  if (digits.length >= 6) return digits.slice(0, 6);
  return digits || fallback || '202601';
}

/**
 * Standardize Due Diligence document names to English.
 */
export function standardizeDDDocName(docName?: string): string {
  if (!docName) return 'Business License';
  const lower = docName.toLowerCase().trim();
  if (lower.includes('nda') || lower.includes('non-disclosure') || lower.includes('kerahasiaan')) return 'NDA';
  if (lower.includes('akta') || lower.includes('deed') || lower.includes('pendirian') || lower.includes('anggaran dasar')) return 'Deed of Establishment';
  if (lower.includes('nib') || lower.includes('nomor induk berusaha') || lower.includes('license') || lower.includes('izin usaha')) return 'Business License';
  if (lower.includes('npwp') || lower.includes('skt') || lower.includes('pajak') || lower.includes('tax')) return 'Tax ID';
  if (lower.includes('ktp') || lower.includes('passport') || lower.includes('direksi') || lower.includes('id card')) return 'Director ID';
  if (lower.includes('rekening') || lower.includes('bank') || lower.includes('koran') || lower.includes('statement')) return 'Bank Statement';
  if (lower.includes('sppkp') || lower.includes('vat') || lower.includes('pkp')) return 'VAT Registration';
  if (lower.includes('form') || lower.includes('due diligence') || lower.includes('dd')) return 'Due Diligence Form';
  return sanitizeFilePart(docName, 'Business License');
}

/**
 * Contract & Agreement Addendum File Naming:
 * Contract:           Contract-[Partner Name]-[Document Type]-[Start Date]-[Contract No].[ext]
 * Agreement Addendum: Contract-[Partner Name]-Agreement Addendum-[Start Date]-[Addendum No].[ext]
 * 
 * Example: Contract-Hainan AdTiger-Master Agreement-20230209-01A_ITS_I_2023.pdf
 * Example: Contract-Hainan AdTiger-Agreement Addendum-20240301-ADD-001.pdf
 */
export function formatContractFileName(params: {
  partnerName?: string;
  documentType?: string;
  startDate?: string | Date;
  contractNumber?: string;
  rawFileName?: string;
}): string {
  const ext = getFileExtension(params.rawFileName, '.pdf');
  const partner = sanitizeFilePart(params.partnerName, 'Partner');
  const isAddendum = params.documentType?.toLowerCase().includes('addendum');
  const docType = isAddendum ? 'Agreement Addendum' : sanitizeFilePart(params.documentType, 'Master Agreement');
  const sDate = formatToYYYYMMDD(params.startDate);
  const ctrNo = sanitizeFilePart(params.contractNumber, isAddendum ? 'ADD-001' : '01A_ITS_I_2023');
  return `Contract-${partner}-${docType}-${sDate}-${ctrNo}${ext}`;
}

/**
 * IO File Naming:
 * IO-[Partner Name]-[Media Channel]-[Start Date]-[IO No].[ext]
 * 
 * Example: IO-Hainan AdTiger-Google Ads-20230209-IO-001.pdf
 */
export function formatIOFileName(params: {
  partnerName?: string;
  mediaChannel?: string;
  startDate?: string | Date;
  ioNumber?: string;
  rawFileName?: string;
}): string {
  const ext = getFileExtension(params.rawFileName, '.pdf');
  const partner = sanitizeFilePart(params.partnerName, 'Partner');
  const channel = sanitizeFilePart(params.mediaChannel, 'Google Ads');
  const sDate = formatToYYYYMMDD(params.startDate);
  const ioNo = sanitizeFilePart(params.ioNumber, 'IO-001');
  return `IO-${partner}-${channel}-${sDate}-${ioNo}${ext}`;
}

/**
 * Invoice File Naming:
 * Invoice-[Vendor Name]-[Period]-[Invoice Date]-[Invoice No].[ext]
 * 
 * Example: Invoice-Hainan AdTiger-202302-20230228-INV-001.pdf
 */
export function formatInvoiceFileName(params: {
  partnerName?: string;
  period?: string | string[];
  invoiceMonth?: string | string[];
  invoiceDate?: string | Date;
  invoiceNumber?: string;
  rawFileName?: string;
}): string {
  const ext = getFileExtension(params.rawFileName, '.pdf');
  const vendor = sanitizeFilePart(params.partnerName, 'Vendor');
  const period = formatToYYYYMM(params.period || params.invoiceMonth);
  const invDate = formatToYYYYMMDD(params.invoiceDate);
  const invNo = sanitizeFilePart(params.invoiceNumber, 'INV-001');
  return `Invoice-${vendor}-${period}-${invDate}-${invNo}${ext}`;
}

/**
 * Billing File Naming:
 * Billing-[Vendor Name]-[Period]-[Invoice Date]-[Invoice No].[ext]
 * 
 * Example: Billing-Hainan AdTiger-202302-20230228-INV-001.pdf
 */
export function formatBillingFileName(params: {
  partnerName?: string;
  period?: string | string[];
  invoiceMonth?: string | string[];
  invoiceDate?: string | Date;
  invoiceNumber?: string;
  rawFileName?: string;
}): string {
  const ext = getFileExtension(params.rawFileName, '.pdf');
  const vendor = sanitizeFilePart(params.partnerName, 'Vendor');
  const period = formatToYYYYMM(params.period || params.invoiceMonth);
  const invDate = formatToYYYYMMDD(params.invoiceDate);
  const invNo = sanitizeFilePart(params.invoiceNumber, 'INV-001');
  return `Billing-${vendor}-${period}-${invDate}-${invNo}${ext}`;
}

/**
 * Due Diligence File Naming:
 * DD-[Vendor Name]-[Document Name]-[Document Date]-[Sequence].[ext]
 * 
 * Example: DD-Hainan AdTiger-Business License-20230209-01.pdf
 */
export function formatDueDiligenceFileName(params: {
  vendorName?: string;
  documentName?: string;
  documentDate?: string | Date;
  sequence?: number | string;
  rawFileName?: string;
}): string {
  const ext = getFileExtension(params.rawFileName, '.pdf');
  const vendor = sanitizeFilePart(params.vendorName, 'Vendor');
  const docName = standardizeDDDocName(params.documentName);
  const docDate = formatToYYYYMMDD(params.documentDate);
  const seqNum = typeof params.sequence === 'number'
    ? String(params.sequence).padStart(2, '0')
    : params.sequence ? String(params.sequence).padStart(2, '0') : '01';
  return `DD-${vendor}-${docName}-${docDate}-${seqNum}${ext}`;
}

