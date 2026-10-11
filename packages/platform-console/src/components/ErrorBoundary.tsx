import { getPreferenceUser } from '../lib/userPreferences';
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { translateStatic as t } from '../context/LanguageContext';

import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Text } from '@legalio/ui-components/text';
import { Button } from '@legalio/ui-components/button';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
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
        <div className="min-h-screen w-full flex items-center justify-center p-g13 bg-background text-foreground font-sans">
          <Card className="w-full max-w-g610 p-g21 sm:p-g34 space-y-g21 text-center">
            <Avatar size="lg" className="mx-auto rounded-xl bg-status-warning-soft border border-status-warning-border text-status-warning"><AvatarFallback className="bg-transparent text-inherit"><AlertTriangle className="w-g26 h-g26" /></AvatarFallback></Avatar>

            <div className="space-y-g8">
              <Heading as="h2" size="lg" weight="bold">
                {t('error_boundary.title', 'Terjadi Kendala Memuat Tampilan')}
              </Heading>
              <Text size="sm" tone="muted" className="mx-auto max-w-g377">
                {t('error_boundary.description', 'Aplikasi mengalami galat saat memuat komponen antarmuka. Anda dapat memuat ulang halaman atau membersihkan cache sesi lokal.')}
              </Text>
            </div>

            {this.state.error && (
              <Alert status="error" className="text-start">
                <AlertIndicator />
                <AlertContent><AlertDescription className="font-mono text-xs wrap-break-word">
                  {this.state.error.message || t('error_boundary.unknown_error', 'Galat tampilan yang tidak diketahui')}
                </AlertDescription></AlertContent>
              </Alert>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-g13 pt-g8">
              <Button onClick={this.handleReload} className="w-full sm:w-auto">
                <RefreshCw aria-hidden="true" />
                {t('error_boundary.reload', 'Muat Ulang Halaman')}
              </Button>
              <Button variant="outline" onClick={this.handleResetCache} className="w-full sm:w-auto">
                <RotateCcw aria-hidden="true" />
                {t('error_boundary.reset', 'Reset Sesi & Cache')}
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
