import React, { createContext, useContext, useEffect, useState } from 'react';
import { readPreference, writePreference } from '../lib/userPreferences';
import { useOptionalIdentity } from './AuthContext';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const systemTheme = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/** Theme is a personal preference stored under `user:<userId>:theme` (PRD §6.7). */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const identity = useOptionalIdentity();
  const userId = identity?.id ?? null;
  const [theme, setTheme] = useState<Theme>(systemTheme);

  useEffect(() => {
    const saved = readPreference('theme', userId);
    setTheme(saved === 'dark' || saved === 'light' ? saved : systemTheme());
  }, [userId]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.moduixTheme = 'legalio';
    root.dataset.moduixColorScheme = theme;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Only an explicit choice is stored; defaults are never persisted.
  const choose = (next: Theme) => {
    setTheme(next);
    writePreference('theme', next, userId);
  };
  const toggleTheme = () => choose(theme === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, setTheme: choose, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
