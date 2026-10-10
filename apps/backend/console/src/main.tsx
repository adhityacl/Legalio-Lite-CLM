import { TenantProvider } from '@legalio/platform-console/context/TenantContext';
import { AlertToastProvider } from '@legalio/platform-console/context/AlertToastContext';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@legalio/platform-console/context/AuthContext';
import { ThemeProvider } from '@legalio/platform-console/context/ThemeContext';
import { LanguageProvider } from '@legalio/platform-console/context/LanguageContext';
import { ConfirmDialogProvider } from '@legalio/platform-console/context/ConfirmDialogContext';
import { PlatformPermissionProvider } from '@legalio/platform-console/lib/permissions';
import { PolicyCatalogProvider } from '@legalio/platform-console/context/TenantSettingsContext';
import { NavigationProvider } from '@legalio/platform-console/context/NavigationContext';
import { ErrorBoundary } from '@legalio/platform-console/components/ErrorBoundary';
import { installApiFetchInterceptor } from '@legalio/platform-console/lib/apiFetch';
import { SystemConsole } from './SystemConsole';
import './index.css';

installApiFetchInterceptor();
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });
createRoot(document.getElementById('root')!).render(
  <StrictMode><ErrorBoundary resetPath="/sys"><QueryClientProvider client={client}><AuthProvider><ThemeProvider><LanguageProvider><ConfirmDialogProvider><AlertToastProvider><TenantProvider platformOnly><PlatformPermissionProvider><PolicyCatalogProvider><NavigationProvider basePath="/sys" defaultTab="admin-system-dashboard"><SystemConsole /></NavigationProvider></PolicyCatalogProvider></PlatformPermissionProvider></TenantProvider></AlertToastProvider></ConfirmDialogProvider></LanguageProvider></ThemeProvider></AuthProvider></QueryClientProvider></ErrorBoundary></StrictMode>,
);
