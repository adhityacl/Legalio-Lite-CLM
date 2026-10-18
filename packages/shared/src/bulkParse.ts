/**
 * Spreadsheet money: "1.000.000,50", "1,000,000.50", "Rp 1.500" or a plain number. The last separator is the decimal
 * point; a lone separator followed by exactly three digits (after 1-3 leading digits) is a thousands separator.
 * shortcut: "1.500" always reads as 1500, never 1.5; upgrade to a per-column locale if 3-decimal amounts appear.
 */
export const bulkNumber = (value: unknown): number => {
  const text = String(value ?? "").replace(/[^\d.,-]/g, "");
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let normalized = text;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    normalized = text.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const groups = text.split(lastDot >= 0 ? "." : ",");
    const thousands = groups.length > 2 || (groups[1].length === 3 && /^-?[1-9]\d{0,2}$/.test(groups[0]));
    normalized = groups.join(thousands ? "" : ".");
  }
  return Number(normalized) || 0;
};

/** Import columns holding calendar dates. */
export const BULK_DATE_FIELDS = ["start_date", "end_date", "invoice_date", "review_date"];

/**
 * True for DD/MM/YYYY-style text whose day and month are both 12 or less and differ ("03/04/2026"):
 * a file saved with US regional settings would mean the other order, and nothing in the file says which.
 */
export const bulkDateAmbiguous = (value: unknown): boolean => {
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}$/.exec(String(value ?? "").trim());
  return Boolean(dmy) && +dmy![1] <= 12 && +dmy![2] <= 12 && dmy![1] !== dmy![2] && bulkDate(value) !== null;
};

/** YYYY-MM-DD or DD/MM/YYYY (also - and .) to YYYY-MM-DD; "" when blank; null when it is not a real calendar date. */
export const bulkDate = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const [year, month, day] = iso ? [+iso[1], +iso[2], +iso[3]] : dmy ? [+dmy[3], +dmy[2], +dmy[1]] : [0, 0, 0];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
};
