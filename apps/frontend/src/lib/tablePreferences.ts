/**
 * Table View Preferences Utility
 * Saves and retrieves user column visibility and rows-per-page preferences in localStorage.
 */
import { useState } from 'react';

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

export function getSavedRowsPerPage(viewKey: string, fallback: number): number {
  try {
    const saved = Number(localStorage.getItem(`lms_table_rows_${viewKey}`));
    if (Number.isInteger(saved) && saved > 0) return saved;
  } catch (e) {
    console.error(`Failed to load rows per page for ${viewKey}:`, e);
  }
  return fallback;
}

/** Rows-per-page state that remembers the user's last choice per table. */
export function useRowsPerPage(viewKey: string, fallback = 5): [number, (size: number) => void] {
  const [size, setSize] = useState(() => getSavedRowsPerPage(viewKey, fallback));
  const update = (next: number) => {
    setSize(next);
    try {
      localStorage.setItem(`lms_table_rows_${viewKey}`, String(next));
    } catch (e) {
      console.error(`Failed to save rows per page for ${viewKey}:`, e);
    }
  };
  return [size, update];
}
