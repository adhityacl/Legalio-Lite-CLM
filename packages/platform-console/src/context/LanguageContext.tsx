import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { loadAllCatalogs, loadCatalogWithFallback, loadedCatalog } from '../i18n/catalogLoader';
import { readPreference, setPreferenceUser, writePreference } from '../lib/userPreferences';
import { useOptionalIdentity } from './AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UITextDictionary, UITextLanguage, UITextOverrides } from '@legalio/types/uiTexts';

/** UI languages. `ZH` is Simplified Chinese, shown as "CN" in the language switcher. */
export type Language = UITextLanguage;

export const LANGUAGE_OPTIONS: ReadonlyArray<{ code: Language; label: string; nativeName: string; htmlLang: string }> = [
  { code: 'ID', label: 'ID', nativeName: 'Bahasa Indonesia', htmlLang: 'id' },
  { code: 'EN', label: 'EN', nativeName: 'English', htmlLang: 'en' },
  { code: 'ZH', label: 'ZH', nativeName: '简体中文', htmlLang: 'zh-CN' },
];

const isLanguage = (value: unknown): value is Language => value === 'ID' || value === 'EN' || value === 'ZH';
const emptyCatalogs = (): Record<Language, Record<string, string>> => ({ ID: {}, EN: {}, ZH: {} });
let sharedCustomTranslations = emptyCatalogs();

export interface DocumentTerminology {
  doc: string;
  docs: string;
  docShort: string;
}

const LEGACY_TERMS: DocumentTerminology = { doc: 'Insertion Order', docs: 'Insertion Orders', docShort: 'IO' };

/**
 * Older UI strings hardcode the advertising term "Insertion Order (IO)".
 * For organizations whose industry uses another commercial document
 * (order form, purchase order, statement of work, ...), rewrite the term.
 */
function applyTerminology(text: string, terms: DocumentTerminology): string {
  let out = text
    .replace(/\{docs\}/g, terms.docs)
    .replace(/\{doc\}/g, terms.doc)
    .replace(/\{docShort\}/g, terms.docShort);
  if (terms.doc !== LEGACY_TERMS.doc) {
    out = out
      .replace(/Insertion Orders/g, terms.docs)
      .replace(/Insertion Order/g, terms.doc)
      .replace(/\bIOs\b/g, `${terms.docShort}s`)
      .replace(/\bIO\b/g, terms.docShort);
  }
  return out;
}

export interface LanguageContextType {
  language: Language;
  /** Loads the language's catalog first, then switches, so the UI never shows raw keys. */
  setLanguage: (lang: Language) => void;
  /**
   * Translate `key`. `{name}` placeholders are filled from `vars`; `{doc}`,
   * `{docs}` and `{docShort}` are filled with the active organization's
   * commercial-document terminology (e.g. "Purchase Order").
   */
  t: (key: string, defaultText?: string, vars?: Record<string, string | number>) => string;
  /** Set by the organization settings: the label used for commercial documents. */
  setDocumentTerminology: (terms: DocumentTerminology) => void;
  /** Built-in texts of the languages loaded so far (all three after `loadAllLanguages`). */
  translations: Record<Language, Record<string, string>>;
  /** Loads every built-in catalog (the UI text editor and CSV export need all languages). */
  loadAllLanguages: () => Promise<void>;
  customTranslations: Record<Language, Record<string, string>>;
  exportToCSV: () => Promise<void>;
  importFromCSV: (csvContent: string) => Promise<{ success: boolean; updatedCount: number; error?: string }>;
  resetCustomTranslations: () => Promise<void>;
  updateSingleTranslation: (key: string, lang: Language, value: string) => Promise<void>;
  translationsBusy: boolean;
  translationsError: string | null;
}


/**
 * Built-in catalogs are loaded lazily per language (../i18n/catalogLoader). Until one is loaded it reads as empty,
 * so callers fall through to the next source (English, then the caller's default text).
 */
const NOT_LOADED: Record<string, string> = {};
const builtIn = (language: Language): Record<string, string> => loadedCatalog(language) ?? NOT_LOADED;

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

/**
 * Translation for code that runs outside the React tree (error boundary, library errors).
 * Uses the personal language and the latest shared dictionary; no document terminology.
 */
export function translateStatic(key: string, defaultText?: string, vars?: Record<string, string | number>): string {
  let language: Language = 'EN';
  let custom: Record<string, string> = {};
  try {
    const saved = readPreference('language');
    if (isLanguage(saved)) language = saved;
    custom = sharedCustomTranslations[language];
  } catch {
    /* storage unavailable — English catalog */
  }
  let text = custom[key] || builtIn(language)[key] || (language !== 'EN' ? builtIn('EN')[key] : '') || defaultText || key;
  for (const [name, value] of Object.entries(vars || {})) text = text.split(`{${name}}`).join(String(value));
  return text;
}

/** Column headers of the UI text CSV (export and re-import). */
const CSV_HEADERS = ['Key', 'Module', 'Bahasa_Indonesia', 'English', 'Chinese_简体中文'];

// Utility functions for CSV parsing
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Language stays personal. System Admin edits the server dictionary shared
 * by all users; active pages refresh it every five seconds and on focus.
 */
export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const identity = useOptionalIdentity();
  const userId = identity?.id ?? null;
  const [language, setLanguageState] = useState<Language>('EN');
  // Nothing renders until English and the chosen language are loaded; `catalogRevision` re-renders when more are loaded later.
  const [ready, setReady] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const languageRef = useRef<Language>('EN');
  const requestedRef = useRef<Language>('EN');
  const switchLanguage = useCallback((target: Language) => {
    requestedRef.current = target;
    loadCatalogWithFallback(target)
      .catch((err) => console.warn('Could not load the UI texts for', target, err))
      .finally(() => {
        // Only the latest request wins, and a failed load still lets the app render (default texts).
        if (requestedRef.current !== target) return;
        languageRef.current = target;
        setLanguageState(target);
        setCatalogRevision((n) => n + 1);
        setReady(true);
      });
  }, []);
  const loadAllLanguages = useCallback(async () => {
    await loadAllCatalogs();
    setCatalogRevision((n) => n + 1);
  }, []);
  const queryClient = useQueryClient();
  const queryKey = ['platform', 'ui-texts'];
  const dictionary = useQuery<UITextDictionary>({
    queryKey,
    queryFn: async () => {
      const response = await fetch('/api/system/ui-texts', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load shared UI texts.');
      return response.json();
    },
    // ponytail: one read per active browser every 5s; use SSE if polling load becomes significant.
    refetchInterval: 5_000,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const customTranslations = dictionary.data?.overrides || emptyCatalogs();
  useEffect(() => { sharedCustomTranslations = customTranslations; }, [customTranslations]);
  const saveDictionary = useMutation({
    mutationFn: async (values: { overrides?: Partial<UITextOverrides>; reset?: true }): Promise<UITextDictionary> => {
      const response = await fetch('/api/platform/configuration', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'uiTexts', values }),
      });
      if (!response.ok) throw new Error(builtIn(language)['tb.texts_save_failed'] || 'Could not save the UI texts.');
      return response.json();
    },
    onSuccess: (data) => {
      sharedCustomTranslations = data.overrides;
      queryClient.setQueryData(queryKey, data);
    },
  });
  const translationsBusy = !dictionary.isSuccess || saveDictionary.isPending;

  // Switching identity loads that identity's preferences (or the defaults).
  useEffect(() => {
    setPreferenceUser(userId);
    const saved = readPreference('language');
    switchLanguage(isLanguage(saved) ? saved : userId ? 'EN' : languageRef.current);
  }, [userId, switchLanguage]);

  const setLanguage = (lang: Language) => {
    switchLanguage(lang);
    writePreference('language', lang);
  };

  // Screen readers pick pronunciation from <html lang>.
  useEffect(() => {
    document.documentElement.lang = LANGUAGE_OPTIONS.find((o) => o.code === language)?.htmlLang || 'en';
  }, [language]);

  const [terms, setTerms] = useState<DocumentTerminology>(LEGACY_TERMS);
  const setDocumentTerminology = useCallback((next: DocumentTerminology) => {
    setTerms((prev) => (prev.doc === next.doc && prev.docs === next.docs && prev.docShort === next.docShort ? prev : next));
  }, []);

  const resolve = (key: string, defaultText?: string): string => {
    // 1. Custom overrides for the current language
    const customPrimary = customTranslations[language]?.[key];
    if (customPrimary !== undefined && customPrimary !== '') return customPrimary;

    // 2. Built-in catalog for the current language
    const primary = builtIn(language)[key];
    if (primary !== undefined && primary !== '') return primary;

    // 3. English UI with no English entry: use the caller's default text,
    //    then the Indonesian catalog as a last resort.
    if (language === 'EN') {
      return defaultText || builtIn('ID')[key] || key;
    }
    // 4. Indonesian and Chinese UIs fall back to English.
    const customFallback = customTranslations.EN?.[key];
    if (customFallback !== undefined && customFallback !== '') return customFallback;
    const fallback = builtIn('EN')[key];
    if (fallback !== undefined && fallback !== '') return fallback;
    return defaultText || key;
  };

  const t = (key: string, defaultText?: string, vars?: Record<string, string | number>): string => {
    let text = applyTerminology(resolve(key, defaultText), terms);
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  };

  const exportToCSV = async () => {
    await loadAllCatalogs();
    const codes: Language[] = ['ID', 'EN', 'ZH'];
    const allKeys = Array.from(
      new Set(codes.flatMap((code) => [...Object.keys(builtIn(code)), ...Object.keys(customTranslations[code] || {})])),
    ).sort();

    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [CSV_HEADERS.join(',')];
    for (const key of allKeys) {
      const module = key.split('.')[0] || 'General';
      const texts = codes.map((code) => customTranslations[code]?.[key] || builtIn(code)[key] || '');
      rows.push([key, module, ...texts].map(quote).join(','));
    }

    // UTF-8 BOM so Excel opens with proper UTF-8 encoding
    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `LMS_UI_Texts_Structure_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importFromCSV = async (csvContent: string): Promise<{ success: boolean; updatedCount: number; error?: string }> => {
    try {
      await loadAllCatalogs();
      const cleanContent = csvContent.replace(/^\uFEFF/, '');
      const lines = splitCSVLines(cleanContent);
      if (lines.length < 2) {
        return { success: false, updatedCount: 0, error: t('ui_text.import_empty', 'File CSV kosong atau tidak memiliki baris data.') };
      }

      const headerRow = parseCSVRow(lines[0]).map((h) => h.toLowerCase().replace(/^"|"$/g, '').trim());
      const findColumn = (names: string[], fallback: number) => {
        const index = headerRow.findIndex((h) => names.some((name) => h === name || h.startsWith(`${name}_`) || h.startsWith(`${name} `)));
        return index === -1 ? fallback : index;
      };
      const keyIdx = findColumn(['key'], 0);
      const columns: Array<[Language, number]> = [
        ['ID', findColumn(['bahasa_indonesia', 'bahasa indonesia', 'indonesian', 'id'], 2)],
        ['EN', findColumn(['english', 'en'], 3)],
        ['ZH', findColumn(['chinese', 'zh', 'cn', '中文', '简体中文'], 4)],
      ];

      let updatedCount = 0;
      const newCustom = emptyCatalogs();

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length <= keyIdx) continue;
        const key = row[keyIdx]?.replace(/^"|"$/g, '').trim();
        if (!key) continue;
        for (const [code, index] of columns) {
          const value = index < row.length ? row[index]?.replace(/^"|"$/g, '').trim() : undefined;
          if (value) newCustom[code][key] = value === builtIn(code)[key] ? '' : value;
        }
        updatedCount++;
      }

      await saveDictionary.mutateAsync({ overrides: newCustom });
      return { success: true, updatedCount };
    } catch (err: any) {
      return { success: false, updatedCount: 0, error: err.message || t('ui_text.import_failed', 'Gagal memproses file CSV.') };
    }
  };

  const resetCustomTranslations = async () => {
    await saveDictionary.mutateAsync({ reset: true });
  };

  const updateSingleTranslation = async (key: string, lang: Language, value: string) => {
    await loadAllCatalogs();
    await saveDictionary.mutateAsync({ overrides: { [lang]: { [key]: value === builtIn(lang)[key] ? '' : value } } });
  };

  void catalogRevision;
  const translations: Record<Language, Record<string, string>> = { ID: builtIn('ID'), EN: builtIn('EN'), ZH: builtIn('ZH') };
  if (!ready) return null;
  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
        setDocumentTerminology,
        translations,
        loadAllLanguages,
        customTranslations,
        exportToCSV,
        importFromCSV,
        resetCustomTranslations,
        updateSingleTranslation,
        translationsBusy,
        translationsError: dictionary.isError ? t('tb.texts_load_failed') : null,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
