import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignInForm } from './components/SignInForm';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { ConfirmDialogProvider } from './context/ConfirmDialogContext';
import { AlertToastProvider } from './context/AlertToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { TenantProvider } from './context/TenantContext';
import { TenantSettingsProvider } from './context/TenantSettingsContext';
import { NavigationProvider, useNavigation, buildAppUrl } from './context/NavigationContext';
import { PermissionProvider } from './lib/permissions';
import { InvitationPrompt } from './components/account/InvitationPrompt';
import { LoadingState } from './components/StateScreen';
import { rememberReturnTo, takeReturnTo } from './lib/returnTo';

// The signed-in shell (navigation, header, workspace providers, page registry) is its own chunk: the sign-in page does not pay for it.
// It is fetched as soon as the browser is idle, so it is normally there before the person has finished signing in.
const loadShell = () => import('./shell/AuthenticatedApp');
const AuthenticatedApp = lazy(() => loadShell().then((m) => ({ default: m.AuthenticatedApp })));
if (typeof window !== 'undefined') {
  const whenIdle = (window as { requestIdleCallback?: (callback: () => void) => void }).requestIdleCallback;
  if (whenIdle) whenIdle(() => { void loadShell(); }); else setTimeout(() => { void loadShell(); }, 200);
}

const LazyPrivacyPolicyView = lazy(() => import('./components/PrivacyPolicyView').then((m) => ({ default: m.PrivacyPolicyView })));
const LazyTermsOfServiceView = lazy(() => import('./components/TermsOfServiceView').then((m) => ({ default: m.TermsOfServiceView })));

/** Mounts the signed-in application only while there is a user, so its hooks never run conditionally. */
const MainApp: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  return user ? (
    <Suspense fallback={<LoadingState label={t('app.memuat_halaman', 'Memuat halaman...')} />}>
      <AuthenticatedApp user={user} />
    </Suspense>
  ) : null;
};

const isPrivacyRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
  const hash = window.location.hash.toLowerCase();
  return (
    path === '/privacy' ||
    path === '/privacy-policy' ||
    hash === '#privacy' ||
    hash === '#privacy-policy'
  );
};

const isTermsRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
  const hash = window.location.hash.toLowerCase();
  return (
    path === '/tos' ||
    path === '/terms' ||
    path === '/terms-of-service' ||
    hash === '#tos' ||
    hash === '#terms' ||
    hash === '#terms-of-service'
  );
};

const AppContent = () => {
  const { user, loading } = useAuth();
  const { activeTab, recordId, setActiveTab, replaceActiveTab } = useNavigation();
  const { t } = useLanguage();
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState<boolean>(isPrivacyRoute);
  const [showTermsOfService, setShowTermsOfService] = useState<boolean>(isTermsRoute);
  const startup = useRef(true);

  useEffect(() => {
    const handleLocationChange = () => {
      setShowPrivacyPolicy(isPrivacyRoute());
      setShowTermsOfService(isTermsRoute());
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  useEffect(() => {
    if (loading || showPrivacyPolicy || showTermsOfService) return;
    const firstLoad = startup.current;
    startup.current = false;
    if (!user) {
      // A page asked for while signed out (a bookmark or a deep link like ?tab=contracts&id=C0001) is picked up again after sign-in.
      // Signing out from inside the app does not leave a destination behind.
      if (activeTab !== 'login') {
        if (firstLoad) rememberReturnTo(activeTab, recordId);
        replaceActiveTab('login');
      }
      return;
    }
    if (activeTab === 'login') {
      const target = takeReturnTo();
      if (target) setActiveTab(target.tab, undefined, { replace: true, recordId: target.recordId });
      else replaceActiveTab(user.platformRole === 'superuser' ? 'admin-system-dashboard' : 'dashboard');
    }
  }, [activeTab, loading, recordId, replaceActiveTab, setActiveTab, showPrivacyPolicy, showTermsOfService, user]);

  const handleOpenPrivacy = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/privacy');
    }
    setShowPrivacyPolicy(true);
    setShowTermsOfService(false);
  };

  const handleOpenTerms = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/tos');
    }
    setShowTermsOfService(true);
    setShowPrivacyPolicy(false);
  };

  const handleBackToMain = () => {
    setShowPrivacyPolicy(false);
    setShowTermsOfService(false);
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
      if (
        path === '/privacy' ||
        path === '/privacy-policy' ||
        path === '/tos' ||
        path === '/terms' ||
        path === '/terms-of-service' ||
        window.location.hash
      ) {
        window.history.pushState(null, '', buildAppUrl(activeTab));
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground ">
        <LoadingState delayed label={t('app.memuat', 'Memuat...')} />
      </div>
    );
  }

  if (showPrivacyPolicy) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">{t('app.memuat_kebijakan', 'Memuat kebijakan...')}</div>}>
        <LazyPrivacyPolicyView onBack={handleBackToMain} />
      </Suspense>
    );
  }

  if (showTermsOfService) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">{t('app.memuat_syarat_ketentuan', 'Memuat syarat & ketentuan...')}</div>}>
        <LazyTermsOfServiceView onBack={handleBackToMain} />
      </Suspense>
    );
  }

  if (!user) {
    return (
        <SignInForm
          onOpenPrivacyPolicy={handleOpenPrivacy}
          onOpenTermsOfService={handleOpenTerms}
        />
    );
  }

  if (activeTab === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground ">
        <LoadingState delayed label={t('app.memuat', 'Memuat...')} />
      </div>
    );
  }

  return (
    <>
      <InvitationPrompt />
      <MainApp />
    </>
  );
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 10000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    // Identity → organization selection → capabilities → runtime policy (PRD §11.1).
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <LanguageProvider>
            <ConfirmDialogProvider>
              <AlertToastProvider>
                <TenantProvider>
                  <PermissionProvider>
                    <TenantSettingsProvider>
                      <NavigationProvider>
                        <AppContent />
                      </NavigationProvider>
                    </TenantSettingsProvider>
                  </PermissionProvider>
                </TenantProvider>
              </AlertToastProvider>
            </ConfirmDialogProvider>
          </LanguageProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
