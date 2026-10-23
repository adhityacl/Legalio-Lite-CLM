import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { Text } from '@legalio/ui-components/text';
import { translateStatic as t } from '../context/LanguageContext';

interface Props {
  children: ReactNode;
  /** The page this boundary guards; a different value (another page) clears a previous error. */
  routeId: string;
  onGoHome?: () => void;
}
interface State { error: Error | null; failedRoute: string | null }

/**
 * Per-page error boundary: a view that throws while rendering (or a lazy chunk that fails to load) shows an inline message with
 * a retry instead of blanking the whole application, and navigating to another page clears it.
 */
export class RouteBoundary extends Component<Props, State> {
  state: State = { error: null, failedRoute: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A new page starts clean.
    if (state.error && state.failedRoute !== null && state.failedRoute !== props.routeId) return { error: null, failedRoute: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`Page "${this.props.routeId}" failed to render:`, error, info.componentStack);
    this.setState({ failedRoute: this.props.routeId });
  }

  private retry = () => this.setState({ error: null, failedRoute: null });

  render() {
    if (!this.state.error) return this.props.children;
    const chunkFailure = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(this.state.error.message);
    return (
      <div role="alert" data-testid="route-error" className="mx-auto flex max-w-g610 flex-col items-center gap-g13 py-g42 text-center">
        <AlertTriangle aria-hidden="true" className="size-g34 text-status-warning" />
        <h2 className="text-xl font-semibold text-foreground">{t('route_error.title', 'This page could not be shown')}</h2>
        <Text size="sm" tone="muted">
          {chunkFailure
            ? t('route_error.chunk', 'A part of the application could not be loaded, usually after an update. Reload the page to continue.')
            : t('route_error.description', 'Something went wrong while showing this page. Your data is safe; try again or go back to the dashboard.')}
        </Text>
        <div className="flex flex-wrap items-center justify-center gap-g13">
          {chunkFailure
            ? <Button type="button" onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" />{t('route_error.reload', 'Reload')}</Button>
            : <Button type="button" onClick={this.retry}><RefreshCw aria-hidden="true" />{t('route_error.retry', 'Try again')}</Button>}
          {this.props.onGoHome && <Button type="button" variant="outline" onClick={() => { this.retry(); this.props.onGoHome?.(); }}>{t('route_error.home', 'Go to dashboard')}</Button>}
        </div>
      </div>
    );
  }
}
