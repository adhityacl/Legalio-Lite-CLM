import React, { useEffect, useState } from 'react';
import { authClient } from '../lib/auth-client';
import { useAuth } from '../context/AuthContext';
import { LANGUAGE_OPTIONS, useLanguage, type Language } from '../context/LanguageContext';
import { signInWithGoogle } from '../lib/googleAuthService';
import { Clock } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Card, CardDescription, CardTitle } from '@legalio/ui-components/card';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Input } from '@legalio/ui-components/input';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { PasswordInput, PasswordInputControl, PasswordInputIndicator, PasswordInputInput, PasswordInputLabel, PasswordInputVisibilityTrigger } from '@legalio/ui-components/password-input';
import { Separator } from '@legalio/ui-components/separator';
import { Text } from '@legalio/ui-components/text';
import { capturePendingInvitation, loadInvitationPreview, type InvitationPreview } from './account/InvitationPrompt';
import { Image } from '@legalio/ui-components/image';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
interface SignInFormProps {
  allowRegistration?: boolean;
  onOpenPrivacyPolicy?: () => void;
  onOpenTermsOfService?: () => void;
}

/**
 * Sign-in / registration screen.
 *
 * Built on the moduix Sign in block (Card, Field, InputGroup, PasswordInput, Alert).
 * Behaviour and the auth calls are unchanged.
 */
export const SignInForm: React.FC<SignInFormProps> = ({ onOpenPrivacyPolicy, onOpenTermsOfService, allowRegistration = true }) => {
  const { t, language, setLanguage } = useLanguage();
  const { login } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [resetHint, setResetHint] = useState(false);
  // True on a fresh install with no admin yet: this screen becomes "create the admin account".
  const [setupMode, setSetupMode] = useState(false);
  const [statusReady, setStatusReady] = useState(false);

  // An invitation link survives sign-in/registration in this tab (PRD §8.4).
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  useEffect(() => {
    if (!allowRegistration) return;
    const token = capturePendingInvitation();
    if (token) loadInvitationPreview(token).then(setInvitation).catch(() => {});
  }, [allowRegistration]);

  useEffect(() => {
    fetch('/api/system/public-status', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok && !allowRegistration) throw new Error(t('sys.status_failed', 'Could not load system status. Refresh to retry.'));
        return res.ok ? res.json() : null;
      })
      .then((status) => { setSetupMode(Boolean(status?.needsSetup)); setStatusReady(true); })
      .catch((err) => { if (!allowRegistration) setError(err.message); });
  }, [allowRegistration]);

  const handleOpenPrivacy = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onOpenPrivacyPolicy) {
      onOpenPrivacyPolicy();
    } else if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/privacy');
      window.dispatchEvent(new Event('popstate'));
    }
  };

  const handleOpenTerms = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onOpenTermsOfService) {
      onOpenTermsOfService();
    } else if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/tos');
      window.dispatchEvent(new Event('popstate'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (setupMode) {
        const res = await fetch('/api/system/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.error === 'ALREADY_SET_UP') setSetupMode(false);
          setError(data.message || t('login.setup_failed', 'Could not create the admin account.'));
          return;
        }
        await login(email, password);
      } else if (allowRegistration && isRegister) {
        const { error } = await authClient.signUp.email({ name, email, password });
        if (error) {
          const msg = (error.message || '').toLowerCase();
          const code = (error as any).code || '';
          if (code === 'BANNED_USER' || msg.includes('banned') || msg.includes('pending')) {
            try { await (authClient.signOut as any)(); } catch (_) {}
            setRegistrationSuccess(true);
          } else if (code === 'USER_ALREADY_EXISTS' || msg.includes('already exists') || msg.includes('already in use')) {
            setError(t('login.email_sudah_terdaftar_silakan_login_atau', 'Email sudah terdaftar. Silakan login atau gunakan email lain.'));
          } else {
            setError(error.message || t('login.err_register_failed'));
          }
        } else {
          try { await (authClient.signOut as any)(); } catch (_) {}
          setRegistrationSuccess(true);
        }
      } else {
        await login(email, password, rememberMe);
      }
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      const code = err?.code || '';
      if (code === 'BANNED_USER' || msg.includes('banned') || msg.includes('pending')) {
        setError(t('login.err_pending'));
      } else if (code === 'INVALID_EMAIL_OR_PASSWORD' || msg.includes('invalid') || msg.includes('credential')) {
        setError(t('login.email_atau_kata_sandi_salah_silakan', 'Email atau kata sandi salah. Silakan coba lagi.'));
      } else {
        setError(err.message || (isRegister ? t('login.err_register_failed') : t('login.err_failed')));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithGoogle();
      if (result.sessionToken) {
        window.location.reload();
        return;
      }
      // Google accepted, but the server refused (e.g. the account isn't invited).
      setError(t('login.gagal_masuk_dengan_google', 'Gagal masuk dengan Google.'));
    } catch (err: any) {
      console.error('Google sign in error:', err);
      setError(err?.message || t('login.gagal_masuk_dengan_google', 'Gagal masuk dengan Google.'));
    } finally {
      setLoading(false);
    }
  };

  const isPending = /menunggu|pending/i.test(error);
  const blocked = loading || (!allowRegistration && !statusReady);
  const shell = (card: React.ReactNode) => (
    <AuthShell language={language} setLanguage={setLanguage} t={t} onOpenPrivacy={handleOpenPrivacy} onOpenTerms={handleOpenTerms}>{card}</AuthShell>
  );

  if (registrationSuccess) {
    return shell(
      <Card className="w-full gap-g21 rounded-xl p-g21 shadow-xl sm:p-g34">
        <Avatar size="lg" className="bg-status-warning-soft text-status-warning" aria-hidden="true"><AvatarFallback className="bg-transparent text-inherit"><Clock className="size-g34" /></AvatarFallback></Avatar>
        <div className="flex flex-col gap-g8">
          <CardTitle asChild className="text-xl font-extrabold"><h1>{t('login.account_created_title')}</h1></CardTitle>
          <CardDescription>
            {invitation
              ? t('tb.invited_registration_done', 'Your account was created and is waiting for manual superuser approval. Once approved, sign in to accept the invitation to {org}.', { org: invitation.organizationName })
              : t('onboarding.registration_done', 'Your account was created and is waiting for manual superuser approval. Once approved, sign in to join or create an organization.')}
          </CardDescription>
        </div>
        <Button variant="outline" className="w-full" onClick={() => { setRegistrationSuccess(false); setIsRegister(false); setError(''); setName(''); setPassword(''); }}>
          {t('login.back_to_login')}
        </Button>
      </Card>
    );
  }

  const title = setupMode ? t('login.setup_title', 'Create your admin account') : isRegister ? t('login.create_account') : t('login.welcome_back', 'Welcome back');
  const subtitle = setupMode ? t('login.setup_subtitle', 'First-time setup: this account will manage the whole workspace.') : isRegister ? t('login.fill_form_reg') : t('login.welcome_subtitle', 'Please sign in with your Legalio account');

  return shell(
    <Card className="w-full gap-g21 rounded-xl p-g21 shadow-xl sm:p-g34">
      <div className="flex flex-col gap-g8">
        <CardTitle asChild className="text-xl font-extrabold sm:text-2xl"><h1>{title}</h1></CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </div>
      {invitation && (
        <Alert status="info">
          <AlertIndicator />
          <AlertContent><AlertDescription className="text-sm">{t('tb.invitation_signin_hint', 'You were invited to join {org} as {role}. Sign in or create an account with the invited email address to accept.', { org: invitation.organizationName, role: invitation.tenantRole })}</AlertDescription></AlertContent>
        </Alert>
      )}
      {error && (
        <Alert status={isPending ? 'warning' : 'error'}>
          <AlertIndicator />
          <AlertContent><AlertDescription className="text-sm">{error}</AlertDescription></AlertContent>
        </Alert>
      )}
      {resetHint && !isRegister && !setupMode && (
        <Alert status="info" role="status">
          <AlertIndicator />
          <AlertContent><AlertDescription className="text-sm">{t('login.forgot_hint', 'Ask your workspace administrator to reset your password.')}</AlertDescription></AlertContent>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-g13" aria-busy={loading}>
        {(isRegister || setupMode) && (
          <Field required>
            <FieldLabel htmlFor="signin-name">{t('login.fullname_label')}</FieldLabel>
            <Input id="signin-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder={t('login.fullname_placeholder')} />
          </Field>
        )}
        <Field required>
          <FieldLabel htmlFor="signin-email">{t('login.email_label')}</FieldLabel>
          <Input id="signin-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('login.email_example', 'name@company.com')} />
        </Field>
        <PasswordInput ids={{ input: 'signin-password' }} autoComplete={setupMode ? 'new-password' : 'current-password'}>
          <PasswordInputLabel>{t('login.password_label')}</PasswordInputLabel>
          <PasswordInputControl>
            <PasswordInputInput required minLength={setupMode ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••••" />
            <PasswordInputVisibilityTrigger><PasswordInputIndicator /></PasswordInputVisibilityTrigger>
          </PasswordInputControl>
        </PasswordInput>
        {!isRegister && !setupMode && (
          <div className="flex flex-wrap items-center justify-between gap-g8">
            <Checkbox checked={rememberMe} onCheckedChange={details => setRememberMe(details.checked === true)}>
              <CheckboxControl /><CheckboxLabel>{t('login.remember_me', 'Remember me')}</CheckboxLabel><CheckboxHiddenInput />
            </Checkbox>
            <Button type="button" variant="link" size="sm" className="px-0 font-semibold text-foreground no-underline hover:underline" onClick={() => setResetHint(true)}>{t('login.forgot_password', 'Forgot password?')}</Button>
          </div>
        )}
        <Button type="submit" loading={loading} disabled={blocked} className="w-full">
          {setupMode ? t('login.setup_submit', 'Create admin account') : isRegister ? t('login.btn_register') : t('login.sign_in_securely', 'Sign in securely')}
        </Button>
      </form>

      {!setupMode && (
        <>
          <div className="flex items-center gap-g13" role="presentation">
            <Separator className="flex-1" />
            <Text as="span" size="xs" tone="muted" className="uppercase tracking-wider">{t('login.or', 'or')}</Text>
            <Separator className="flex-1" />
          </div>
          <Button variant="outline" onClick={handleGoogleSignIn} disabled={blocked} className="w-full">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {t('login.continue_google', 'Continue with Google')}
          </Button>
          {allowRegistration && (
            <Text size="sm" tone="muted" className="flex flex-wrap items-center justify-center gap-x-g5">
              {isRegister ? t('login.have_account', 'Already have an account?') : t('login.new_here', 'New here?')}
              <Button variant="link" size="sm" className="px-0 font-semibold text-foreground no-underline hover:underline" onClick={() => { setIsRegister(!isRegister); setError(''); setResetHint(false); }}>
                {isRegister ? t('login.sign_in_link', 'Sign in') : t('login.request_access', 'Request access')}
              </Button>
            </Text>
          )}
        </>
      )}
    </Card>
  );
};

/** Full-page sign-in scene: dark backdrop, product pitch on the major side, the card on the minor side. */
const AuthShell: React.FC<{ children: React.ReactNode; language: Language; setLanguage: (lang: Language) => void; t: (k: string, d?: string, v?: Record<string, unknown>) => string; onOpenPrivacy: (e: React.MouseEvent) => void; onOpenTerms: (e: React.MouseEvent) => void }> = ({ children, language, setLanguage, t, onOpenPrivacy, onOpenTerms }) => (
  <main className="auth-backdrop relative isolate flex min-h-dvh w-full overflow-x-hidden bg-auth-ink text-auth-foreground">
    <div aria-hidden="true" className="auth-glow-blue pointer-events-none absolute -start-g55 -top-g55 -z-10 size-g233 rounded-full lg:start-g68 lg:top-g89 lg:size-g610" />
    <div aria-hidden="true" className="auth-glow-violet pointer-events-none absolute end-0 top-g377 -z-10 size-g233 rounded-full lg:end-g89 lg:top-g110 lg:size-g377" />
    <div className="absolute end-g21 top-g34 lg:end-g42"><LanguageSwitcher language={language} setLanguage={setLanguage} t={t} /></div>
    <div className="mx-auto flex w-full max-w-g1597 flex-col gap-g21 px-g21 py-g34 lg:flex-row lg:items-center lg:justify-between lg:gap-g55 lg:px-g110 lg:py-g89">
      <section className="flex max-w-g610 flex-col gap-g21 lg:gap-g34">
        <Image src={new URL('../assets/logo-light.png', import.meta.url).href} alt="Legalio" layout="fixed" height={42} width={206} className="h-g34 w-auto self-start object-contain lg:h-g42" />
        <div className="flex flex-col gap-g13 lg:gap-g21">
          <p className="text-2xl font-extrabold leading-snug lg:text-3xl">{t('login.hero_title', 'All in one workspace for partner, contracts, and spending tracker.')}</p>
          <p className="text-sm text-auth-muted lg:text-md lg:leading-relaxed">{t('login.hero_desc', 'Monitor agreements, discuss with AI, upload supporting documents, evaluate vendors, and keep every operational record organized')}</p>
        </div>
      </section>
      <div className="flex w-full flex-col items-center gap-g21 lg:w-g377 lg:shrink-0">
        {children}
        <Text size="xs" className="flex flex-wrap items-center justify-center gap-x-g5 text-auth-muted">
          <span>{new Date().getFullYear()} ACL •</span>
          <Button variant="link" size="sm" className="h-auto px-0 text-auth-muted no-underline hover:text-auth-foreground hover:underline" onClick={onOpenPrivacy}>{t('login.footer_privacy', 'Privacy')}</Button>
          <span>&amp;</span>
          <Button variant="link" size="sm" className="h-auto px-0 text-auth-muted no-underline hover:text-auth-foreground hover:underline" onClick={onOpenTerms}>{t('login.footer_terms', 'Terms')}</Button>
          <span>{t('login.footer_apply', 'apply')}</span>
        </Text>
      </div>
    </div>
  </main>
);

/** Language choice before sign-in; the in-app header offers the same options. */
const LanguageSwitcher: React.FC<{ language: Language; setLanguage: (lang: Language) => void; t: (k: string, d?: string) => string }> = ({ language, setLanguage, t }) => (
  <div role="group" aria-label={t('header.switch_language', 'Pilih bahasa')} className="flex items-center gap-g5 text-xs font-semibold">
    {LANGUAGE_OPTIONS.map((option, index) => (
      <React.Fragment key={option.code}>
        {index > 0 && <span aria-hidden="true" className="text-auth-muted/60">/</span>}
        <Button type="button" variant="link" size="sm" lang={option.htmlLang} aria-pressed={language === option.code} aria-label={option.nativeName} onClick={() => setLanguage(option.code)}
          className={`h-auto px-0 text-xs font-semibold no-underline hover:underline ${language === option.code ? 'text-auth-foreground' : 'text-auth-muted/70'} hover:text-auth-foreground`}>
          {option.label}
        </Button>
      </React.Fragment>
    ))}
  </div>
);
