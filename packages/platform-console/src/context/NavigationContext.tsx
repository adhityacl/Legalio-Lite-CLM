import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

// The workspace is a single page served at APP_PATH; the active page lives in
// the `tab` query parameter (e.g. /app?tab=contracts) so every page can be
// bookmarked, shared, reloaded and walked with the browser back/forward buttons.
export const APP_PATH = '/app';
export const TAB_PARAM = 'tab';
/** Deep link to one record of the page: `/app?tab=contracts&id=C0001`. */
export const RECORD_PARAM = 'id';
const RECORD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

const TAB_PATTERN = /^[a-z0-9-]+$/;

const normalizePath = (path: string) => path.toLowerCase().replace(/\/+$/, '') || '/';

/** True when the current location is the workspace shell (`/` or `/app`). */
export const isAppLocation = (basePath = APP_PATH): boolean => {
  if (typeof window === 'undefined') return false;
  const path = normalizePath(window.location.pathname);
  return path === basePath || (basePath === APP_PATH && path === '/');
};

/** Reads `?tab=` from the current URL; null when absent or malformed. */
export const readTabFromUrl = (basePath = APP_PATH): string | null => {
  if (typeof window === 'undefined' || !isAppLocation(basePath)) return null;
  const tab = new URLSearchParams(window.location.search).get(TAB_PARAM)?.trim().toLowerCase();
  return tab && TAB_PATTERN.test(tab) ? tab : null;
};

/** Reads `?id=` (the record to open on the page); null when absent or malformed. */
export const readRecordFromUrl = (basePath = APP_PATH): string | null => {
  if (typeof window === 'undefined' || !isAppLocation(basePath)) return null;
  const id = new URLSearchParams(window.location.search).get(RECORD_PARAM)?.trim();
  return id && RECORD_PATTERN.test(id) ? id : null;
};

/** Query parameters that belong to one page's list (page, search, sort, filters); they do not follow the user to another page. */
export const LIST_PARAM_PREFIX = 'l.';

/** Builds `/app?tab=<tab>[&id=<record>]`, keeping any other query parameters and the hash. The record id and the list state never outlive their page. */
export const buildAppUrl = (tab: string, basePath = APP_PATH, recordId?: string | null): string => {
  const params = new URLSearchParams(isAppLocation(basePath) ? window.location.search : '');
  if (params.get(TAB_PARAM) !== tab) for (const key of [...params.keys()]) if (key.startsWith(LIST_PARAM_PREFIX)) params.delete(key);
  params.set(TAB_PARAM, tab);
  if (recordId && RECORD_PATTERN.test(recordId)) params.set(RECORD_PARAM, recordId);
  else params.delete(RECORD_PARAM);
  return `${basePath}?${params.toString()}${isAppLocation(basePath) ? window.location.hash : ''}`;
};

interface SetTabOptions {
  /** Replace the current history entry instead of pushing a new one (redirects, guards). */
  replace?: boolean;
  /** Record to open on the destination page; it is written to the URL as `id` so the page can be shared. */
  recordId?: string | null;
}

interface NavigationContextType {
  activeTab: string;
  setActiveTab: (tab: string, itemToSelect?: any, options?: SetTabOptions) => void;
  /** Same as setActiveTab but never adds a history entry — use for permission/module redirects and alias mapping. */
  replaceActiveTab: (tab: string, intent?: string) => void;
  /** `?id=` of the current URL: the record this page should open (deep link or search result); null otherwise. */
  recordId: string | null;
  /** Drops `id` from the URL (history entry replaced) once the page has opened the record. */
  clearRecordId: () => void;
  /** One-shot UI intent carried by a legacy alias (e.g. open the Departments dialog). */
  intent: string | null;
  consumeIntent: () => string | null;
  selectedItem: any | null;
  setSelectedItem: (item: any | null) => void;
  clearSelectedItem: () => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

const writeTabToUrl = (tab: string, replace: boolean, basePath = APP_PATH, recordId: string | null = null) => {
  if (typeof window === 'undefined' || !isAppLocation(basePath)) return;
  const isSameUrl =
    normalizePath(window.location.pathname) === basePath && readTabFromUrl(basePath) === tab && readRecordFromUrl(basePath) === recordId;
  if (isSameUrl) return;
  const url = buildAppUrl(tab, basePath, recordId);
  if (replace) {
    window.history.replaceState({ tab }, '', url);
  } else {
    window.history.pushState({ tab }, '', url);
  }
};

export const NavigationProvider: React.FC<{ children: ReactNode; defaultTab?: string; basePath?: string }> = ({
  children,
  defaultTab = 'login',
  basePath = APP_PATH,
}) => {
  const [activeTab, setActiveTabState] = useState<string>(() => readTabFromUrl(basePath) ?? defaultTab);
  const [recordId, setRecordId] = useState<string | null>(() => readRecordFromUrl(basePath));
  const [selectedItem, setSelectedItemState] = useState<any | null>(null);
  const [intent, setIntent] = useState<string | null>(null);

  // Canonicalize the initial URL (`/` or `/app` without a tab → `/app?tab=…`)
  // without adding a history entry.
  useEffect(() => {
    if (!readTabFromUrl(basePath)) writeTabToUrl(activeTab, true, basePath);
    // Only on mount; later changes are written by setActiveTab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser back/forward: follow the URL without writing it back.
  useEffect(() => {
    const handlePopState = () => {
      const tab = readTabFromUrl(basePath);
      if (tab) {
        setActiveTabState(tab);
        setRecordId(readRecordFromUrl(basePath));
      } else if (isAppLocation(basePath)) {
        setActiveTabState(defaultTab);
        writeTabToUrl(defaultTab, true, basePath);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [defaultTab, basePath]);

  const setActiveTab = useCallback((tab: string, itemToSelect?: any, options?: SetTabOptions) => {
    setActiveTabState(tab);
    setRecordId(options?.recordId ?? null);
    writeTabToUrl(tab, options?.replace ?? false, basePath, options?.recordId ?? null);
    if (itemToSelect !== undefined) {
      setSelectedItemState(itemToSelect);
    }
  }, [basePath]);

  const replaceActiveTab = useCallback((tab: string, nextIntent?: string) => {
    setActiveTabState(tab);
    setRecordId(null);
    if (nextIntent) setIntent(nextIntent);
    writeTabToUrl(tab, true, basePath);
  }, [basePath]);

  const clearRecordId = useCallback(() => {
    setRecordId(null);
    if (typeof window !== 'undefined' && isAppLocation(basePath) && readRecordFromUrl(basePath)) {
      const tab = readTabFromUrl(basePath);
      if (tab) window.history.replaceState({ tab }, '', buildAppUrl(tab, basePath, null));
    }
  }, [basePath]);

  const consumeIntent = useCallback(() => {
    const current = intent;
    if (current) setIntent(null);
    return current;
  }, [intent]);

  const setSelectedItem = useCallback((item: any | null) => {
    setSelectedItemState(item);
  }, []);

  const clearSelectedItem = useCallback(() => {
    setSelectedItemState(null);
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        activeTab,
        setActiveTab,
        replaceActiveTab,
        recordId,
        clearRecordId,
        intent,
        consumeIntent,
        selectedItem,
        setSelectedItem,
        clearSelectedItem,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};

/** Allows shared presentation components to work outside the workspace shell. */
export const useOptionalActiveTab = (): string | undefined => useContext(NavigationContext)?.activeTab;
