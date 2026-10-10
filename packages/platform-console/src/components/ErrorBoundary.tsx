import { getPreferenceUser } from '../lib/userPreferences';
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { translateStatic as t } from '../context/LanguageContext';

interface Props {
  children: ReactNode;
  resetPath?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('Uncaught error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetCache = () => {
    try {
      // Personal browser-local text overrides of the signed-in identity, plus this tab's selection.
      const userId = getPreferenceUser();
      if (userId) localStorage.removeItem(`user:${userId}:customTranslations`);
      sessionStorage.clear();
    } catch (e) {
      console.warn('Failed clearing cache:', e);
    }
    window.location.href = this.props.resetPath || '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 bg-canvas text-ink font-sans">
          <div className="ds-panel w-full max-w-lg p-6 sm:p-8 space-y-6 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-status-warning-soft dark:bg-status-warning-soft/50 border border-status-warning-border flex items-center justify-center text-status-warning shadow-xs">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-ink dark:text-white">
                {t('error_boundary.title', 'Terjadi Kendala Memuat Tampilan')}
              </h2>
              <p className="text-xs text-ink-soft max-w-md mx-auto leading-relaxed">
                {t('error_boundary.description', 'Aplikasi mengalami galat saat memuat komponen antarmuka. Anda dapat memuat ulang halaman atau membersihkan cache sesi lokal.')}
              </p>
            </div>

            {this.state.error && (
              <div className="ds-panel p-3 text-left overflow-hidden">
                <p className="font-mono text-xs text-status-danger wrap-break-word font-semibold">
                  {this.state.error.message || t('error_boundary.unknown_error', 'Galat tampilan yang tidak diketahui')}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-accent-strong hover:bg-accent-strong-hover text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t('error_boundary.reload', 'Muat Ulang Halaman')}</span>
              </button>
              <button
                type="button"
                onClick={this.handleResetCache}
                className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-surface-2 hover:bg-surface-2 dark:hover:bg-surface-2 text-ink text-xs font-semibold transition-all border border-hairline flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('error_boundary.reset', 'Reset Sesi & Cache')}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
