/**
 * Table View Preferences Utility
 * Saves and retrieves user column visibility preferences in localStorage.
 */

export function getSavedColumnPreferences<T extends Record<string, boolean>>(
  viewKey: string,
  defaultColumns: T
): T {
  try {
    const saved = localStorage.getItem(`lms_table_columns_${viewKey}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      const sanitized = { ...defaultColumns } as Record<string, boolean>;
      for (const key of Object.keys(defaultColumns)) {
        if (typeof parsed[key] === 'boolean') {
          sanitized[key] = parsed[key];
        }
      }
      return sanitized as T;
    }
  } catch (e) {
    console.error(`Failed to load column preferences for ${viewKey}:`, e);
  }
  return defaultColumns;
}

export function saveColumnPreferences(viewKey: string, columns: Record<string, boolean>): void {
  try {
    localStorage.setItem(`lms_table_columns_${viewKey}`, JSON.stringify(columns));
  } catch (e) {
    console.error(`Failed to save column preferences for ${viewKey}:`, e);
  }
}
