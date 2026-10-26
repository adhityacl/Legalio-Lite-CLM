export const CATEGORY_STORAGE_KEY = 'LMS_SAVED_PARTNERSHIP_CATEGORIES';

/** Industry-neutral defaults; the active industry pack adds its own. */
export const DEFAULT_CATEGORIES = [
  'Supplier',
  'Service Provider',
  'Customer',
  'Consulting',
  'IT',
  'Logistics',
  'Marketing',
  'Legal Services',
  'Finance & Accounting',
];

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Categories the user typed before. Older versions also stored the defaults here; they are ignored when read. */
function readUserCategories(): string[] {
  try {
    const raw = localStorage.getItem(CATEGORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string' && !DEFAULT_CATEGORIES.some((d) => sameText(d, c))) : [];
  } catch (e) {
    console.error('Error reading saved categories:', e);
    return [];
  }
}

function writeUserCategories(categories: string[]) {
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
  } catch (e) {
    console.error('Error saving category templates:', e);
  }
}

/** Case-insensitive de-duplication that keeps the first spelling. */
function unique(categories: string[]): string[] {
  const out: string[] = [];
  for (const c of categories) if (c.trim() && !out.some((o) => sameText(o, c))) out.push(c);
  return out;
}

/**
 * Categories offered in pickers: the industry pack's categories (`industry`) first, so suggestions fit the organization's
 * kind of partnerships, then the ones the user typed before, then neutral defaults.
 */
export function getSavedCategories(industry: string[] = []): string[] {
  return unique([...industry, ...readUserCategories(), ...DEFAULT_CATEGORIES]);
}

/**
 * Remembers categories the user typed; ones already offered by the pack or the defaults are not stored. Returns the picker list.
 */
export function saveMultipleCategories(categories: string[], industry: string[] = []): string[] {
  const user = readUserCategories();
  const known = [...industry, ...user, ...DEFAULT_CATEGORIES];
  const added = unique(categories.map((c) => c.trim())).filter((c) => !known.some((k) => sameText(k, c)));
  if (added.length) writeUserCategories([...added, ...user]);
  return getSavedCategories(industry);
}

export function saveCategory(newCategory: string, industry: string[] = []): string[] {
  return saveMultipleCategories([newCategory], industry);
}
