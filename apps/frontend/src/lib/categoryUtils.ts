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

/**
 * Categories offered in pickers: the user's saved ones, then the industry
 * pack's categories (`extra`), then neutral defaults.
 */
export function getSavedCategories(extra: string[] = []): string[] {
  let saved: string[] = [];
  try {
    const raw = localStorage.getItem(CATEGORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) saved = parsed.filter((c) => typeof c === 'string');
  } catch (e) {
    console.error('Error reading saved categories:', e);
  }
  return Array.from(new Set([...saved, ...extra, ...DEFAULT_CATEGORIES]));
}

export function saveCategory(newCategory: string): string[] {
  const trimmed = newCategory.trim();
  if (!trimmed) return getSavedCategories();

  const current = getSavedCategories();
  const exists = current.some((c) => c.toLowerCase() === trimmed.toLowerCase());

  let updated = current;
  if (!exists) {
    updated = [trimmed, ...current];
    try {
      localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving category template:', e);
    }
  }
  return updated;
}

export function saveMultipleCategories(categories: string[]): string[] {
  let current = getSavedCategories();
  categories.forEach((cat) => {
    const trimmed = cat.trim();
    if (trimmed && !current.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      current = [trimmed, ...current];
    }
  });
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(current));
  } catch (e) {
    console.error('Error saving category templates:', e);
  }
  return current;
}
