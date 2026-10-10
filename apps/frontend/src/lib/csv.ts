/** Quote every cell (commas, quotes and line breaks stay inside it) and neutralise leading = + @ formulas. */
export const csvCell = (value: unknown): string => {
  let text = String(value ?? '');
  if (/^[=+@\t\r]/.test(text) || /^-.*[A-Za-z]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

/**
 * Download rows as a CSV that Excel opens cleanly: UTF-8 BOM keeps encoding intact and
 * "sep=," forces the comma delimiter even when the OS list separator is ";" (id-ID, EU).
 */
export function downloadCsv(filename: string, headers: unknown[], rows: unknown[][]): void {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  const blob = new Blob(['﻿sep=,\r\n' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Reads a CSV exported by this app or by Excel: strips the UTF-8 BOM, honours a leading
 * "sep=," line, auto-detects "," or ";" and keeps line breaks that sit inside quoted cells.
 */
export function parseCSV(input: string): { headers: string[]; rows: Record<string, string>[] } | null {
  let text = input.replace(/^﻿/, '');
  let delimiter = '';
  const sep = text.match(/^sep=(.)\r?\n/i);
  if (sep) {
    delimiter = sep[1];
    text = text.slice(sep[0].length);
  }
  if (!delimiter) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  }

  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const endRow = () => {
    row.push(cell.trim());
    cell = '';
    if (row.some((value) => value !== '')) records.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') endRow();
    else if (ch !== '\r') cell += ch;
  }
  endRow();

  if (records.length < 2) return null;
  const headers = records[0];
  const rows = records.slice(1).map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => { record[h] = values[idx] ?? ''; });
    return record;
  });
  return { headers, rows };
}
