/**
 * Utility functions for month parsing, end-of-month date formatting,
 * and display conversion across Dashboard, Partner Spending, and Google Sheets sync.
 */

export interface ParsedMonthInfo {
  year: string;           // e.g. "2026"
  month: string;          // e.g. "01" (2-digit: "01".."12")
  monthIndex: number;     // 0..11
  monthNameId: string;    // "Januari"
  monthNameEn: string;    // "January"
  monthShort: string;     // "Jan"
  endOfMonthDate: string; // e.g. "2026-01-31"
  displayLabel: string;   // "Januari 2026"
}

const MONTH_NAMES_ID: Record<string, string> = {
  '01': 'Januari',
  '02': 'Februari',
  '03': 'Maret',
  '04': 'April',
  '05': 'Mei',
  '06': 'Juni',
  '07': 'Juli',
  '08': 'Agustus',
  '09': 'September',
  '10': 'Oktober',
  '11': 'November',
  '12': 'Desember',
};

const MONTH_NAMES_EN: Record<string, string> = {
  '01': 'January',
  '02': 'February',
  '03': 'March',
  '04': 'April',
  '05': 'May',
  '06': 'June',
  '07': 'July',
  '08': 'August',
  '09': 'September',
  '10': 'October',
  '11': 'November',
  '12': 'December',
};

const MONTH_SHORT: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Returns the last day of the month as "YYYY-MM-DD"
 * e.g. (2026, 1) -> "2026-01-31", (2026, 2) -> "2026-02-28", (2024, 2) -> "2024-02-29"
 */
export const getEndOfMonthDate = (year: number | string, month: number | string): string => {
  const y = typeof year === 'string' ? parseInt(year, 10) : year;
  const m = typeof month === 'string' ? parseInt(month, 10) : month;
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return '';
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

/**
 * Parses any month string format into a structured ParsedMonthInfo object
 */
export const parseMonthStr = (mStr: string): ParsedMonthInfo | null => {
  if (!mStr) return null;
  const trimmed = mStr.trim();
  if (!trimmed) return null;

  let yyyy = '';
  let mm = '';

  // Case 1: Standard End-of-month Date "YYYY-MM-DD" (e.g. "2026-01-31" or "2026-01-15")
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const parts = trimmed.split('-');
    yyyy = parts[0];
    mm = parts[1];
  }
  // Case 2: "YYYY-MM" (e.g. "2026-01")
  else if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const parts = trimmed.split('-');
    yyyy = parts[0];
    mm = parts[1];
  }
  // Case 3: "MM-YYYY" (e.g. "01-2026")
  else if (/^\d{2}-\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('-');
    mm = parts[0];
    yyyy = parts[1];
  }
  // Case 4: YYYYMM (e.g. "202601")
  else if (/^(19|20)\d{2}(0[1-9]|1[0-2])$/.test(trimmed)) {
    yyyy = trimmed.slice(0, 4);
    mm = trimmed.slice(4, 6);
  }
  // Case 5: MMYYYY (e.g. "012026")
  else if (/^(0[1-9]|1[0-2])(19|20)\d{2}$/.test(trimmed)) {
    mm = trimmed.slice(0, 2);
    yyyy = trimmed.slice(2);
  }
  // Case 6: 6-digits fallback
  else if (/^\d{6}$/.test(trimmed)) {
    mm = trimmed.slice(0, 2);
    yyyy = trimmed.slice(2);
  }
  // Case 7: Text Month + Year (e.g. "Januari 2026", "January 2026", "Jan 2026")
  else {
    const parts = trimmed.split(/[\s,]+/);
    if (parts.length >= 2) {
      const mName = parts[0].toLowerCase();
      const possibleYear = parts[1];
      if (/^\d{4}$/.test(possibleYear)) {
        yyyy = possibleYear;
        const nameMap: Record<string, string> = {
          january: '01', jan: '01', januari: '01',
          february: '02', feb: '02', februari: '02',
          march: '03', mar: '03', maret: '03',
          april: '04', apr: '04',
          may: '05', mei: '05',
          june: '06', jun: '06', juni: '06',
          july: '07', jul: '07', juli: '07',
          august: '08', aug: '08', agustus: '08', agu: '08',
          september: '09', sep: '09',
          october: '10', oct: '10', oktober: '10', okt: '10',
          november: '11', nov: '11',
          december: '12', dec: '12', desember: '12', des: '12',
        };
        mm = nameMap[mName] || '';
      }
    }
  }

  const numM = parseInt(mm, 10);
  const numY = parseInt(yyyy, 10);
  if (!isNaN(numM) && numM >= 1 && numM <= 12 && !isNaN(numY) && numY >= 1900 && numY <= 2100) {
    const mmPadded = String(numM).padStart(2, '0');
    const yyyyStr = String(numY);
    const idx = numM - 1;
    const endOfMonthDate = getEndOfMonthDate(numY, numM);
    const monthNameId = MONTH_NAMES_ID[mmPadded] || '';
    const monthNameEn = MONTH_NAMES_EN[mmPadded] || '';
    const monthShort = MONTH_SHORT[idx] || '';

    return {
      year: yyyyStr,
      month: mmPadded,
      monthIndex: idx,
      monthNameId,
      monthNameEn,
      monthShort,
      endOfMonthDate,
      displayLabel: `${monthNameId} ${yyyyStr}`,
    };
  }

  return null;
};

/**
 * Parses all months from a string that may contain multiple space/comma separated tokens
 */
export const parseAllMonths = (input: string): ParsedMonthInfo[] => {
  if (!input) return [];
  const trimmed = input.trim();
  if (!trimmed) return [];

  // If input contains spaces or commas separating multiple items (e.g. "032026 042026 052026" or "2026-03-31, 2026-04-30")
  const tokens = trimmed.split(/[\s,;]+/).filter(Boolean);
  const results: ParsedMonthInfo[] = [];

  for (const token of tokens) {
    const parsed = parseMonthStr(token);
    if (parsed) {
      results.push(parsed);
    }
  }

  if (results.length === 0) {
    const single = parseMonthStr(trimmed);
    if (single) results.push(single);
  }

  return results;
};

/**
 * Formats a month period string for UI display (e.g. "Januari 2026" or "Maret 2026, April 2026")
 */
export const formatMonthTagDisplay = (mStr: string, lang: 'id' | 'en' | 'zh' | 'ID' | 'EN' | 'ZH' = 'id'): string => {
  if (!mStr) return '-';
  const parsedList = parseAllMonths(mStr);
  if (parsedList.length === 0) {
    return mStr;
  }

  const code = String(lang).toLowerCase();
  return parsedList
    .map((p) =>
      code === 'zh' ? `${p.year}年${p.monthIndex + 1}月` : code === 'en' ? `${p.monthNameEn} ${p.year}` : `${p.monthNameId} ${p.year}`,
    )
    .join(code === 'zh' ? '、' : ', ');
};

/**
 * Normalizes any month string into standard end-of-month date "YYYY-MM-DD" (e.g. "2026-01-31")
 */
export const normalizeMonthToDate = (mStr: string): string => {
  const parsed = parseMonthStr(mStr);
  return parsed ? parsed.endOfMonthDate : mStr;
};
