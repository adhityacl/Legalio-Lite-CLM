import React, { useEffect, useState } from 'react';
import { authClient } from '../lib/auth-client';
import { useAuth } from '../context/AuthContext';
import { LANGUAGE_OPTIONS, useLanguage, type Language } from '../context/LanguageContext';
import { signInWithGoogle } from '../lib/googleAuthService';
import { Mail, User, Clock } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { PasswordInput, PasswordInputControl, PasswordInputIndicator, PasswordInputInput, PasswordInputLabel, PasswordInputVisibilityTrigger } from '@legalio/ui-components/password-input';
import { SegmentGroup, SegmentGroupIndicator, SegmentGroupItems } from '@legalio/ui-components/segment-group';
import { Separator } from '@legalio/ui-components/separator';
import { Text } from '@legalio/ui-components/text';
import { capturePendingInvitation, loadInvitationPreview, type InvitationPreview } from './account/InvitationPrompt';
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
        await login(email, password);
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

  const logo = <img src={new URL('../assets/logo-full.png', import.meta.url).href} alt="Legalio" className="mx-auto h-10 w-auto" />;
  const blocked = loading || (!allowRegistration && !statusReady);

  if (registrationSuccess) {
    return (
      <Card className="my-auto w-full max-w-md shrink-0">
        <CardHeader className="justify-items-center text-center">
          <div className="col-span-2 mb-2 flex justify-center"><LanguageSwitcher language={language} setLanguage={setLanguage} t={t} /></div>
          <span className="col-span-2 mx-auto mb-2 inline-flex size-16 items-center justify-center rounded-full bg-status-warning-soft text-status-warning" aria-hidden="true"><Clock className="size-8" /></span>
          <CardTitle asChild className="col-span-2 text-2xl"><h1>{t('login.account_created_title')}</h1></CardTitle>
          <CardDescription className="col-span-2">
            {invitation
              ? t('tb.invited_registration_done', 'Your account was created and is waiting for manual superuser approval. Once approved, sign in to accept the invitation to {org}.', { org: invitation.organizationName })
              : t('onboarding.registration_done', 'Your account was created and is waiting for manual superuser approval. Once approved, sign in to join or create an organization.')}
          </CardDescription>
        </CardHeader>
        <CardBody className="flex justify-center">
          <Button variant="link" onClick={() => { setRegistrationSuccess(false); setIsRegister(false); setError(''); setName(''); setPassword(''); }}>
            {t('login.back_to_login')}
          </Button>
        </CardBody>
        <CardFooter className="justify-center"><LegalFooter onOpenPrivacy={handleOpenPrivacy} onOpenTerms={handleOpenTerms} t={t} /></CardFooter>
      </Card>
    );
  }

  return (
    <Card className="my-auto w-full max-w-md shrink-0">
      <CardHeader className="justify-items-center gap-4 text-center">
        <div className="col-span-2 flex justify-center"><LanguageSwitcher language={language} setLanguage={setLanguage} t={t} /></div>
        <div className="col-span-2">{logo}</div>
        {(setupMode || isRegister) && (
          <div className="col-span-2">
            <CardTitle asChild className="text-xl sm:text-2xl"><h1>{setupMode ? t('login.setup_title', 'Create your admin account') : t('login.create_account')}</h1></CardTitle>
            <CardDescription className="mt-1">{setupMode ? t('login.setup_subtitle', 'First-time setup: this account will manage the whole workspace.') : t('login.fill_form_reg')}</CardDescription>
          </div>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        {invitation && (
          <Alert status="info">
            <AlertIndicator />
            <AlertContent><AlertDescription>{t('tb.invitation_signin_hint', 'You were invited to join {org} as {role}. Sign in or create an account with the invited email address to accept.', { org: invitation.organizationName, role: invitation.tenantRole })}</AlertDescription></AlertContent>
          </Alert>
        )}
        {error && (
          <Alert status={isPending ? 'warning' : 'error'}>
            <AlertIndicator />
            <AlertContent><AlertDescription>{error}</AlertDescription></AlertContent>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={loading}>
          {(isRegister || setupMode) && (
            <Field required>
              <FieldLabel>{t('login.fullname_label')}</FieldLabel>
              <InputGroup>
                <InputGroupAddon><User aria-hidden="true" /></InputGroupAddon>
                <InputGroupInput id="signin-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder={t('login.fullname_placeholder')} />
              </InputGroup>
            </Field>
          )}
          <Field required>
            <FieldLabel>{t('login.email_label')}</FieldLabel>
            <InputGroup>
              <InputGroupAddon><Mail aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput id="signin-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('login.email_placeholder')} />
            </InputGroup>
          </Field>
          <PasswordInput ids={{ input: 'signin-password' }} autoComplete={setupMode ? 'new-password' : 'current-password'}>
            <PasswordInputLabel>{t('login.password_label')}</PasswordInputLabel>
            <PasswordInputControl>
              <PasswordInputInput required minLength={setupMode ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
              <PasswordInputVisibilityTrigger><PasswordInputIndicator /></PasswordInputVisibilityTrigger>
            </PasswordInputControl>
          </PasswordInput>
          <Button type="submit" loading={loading} disabled={blocked} className="w-full">
            {setupMode ? t('login.setup_submit', 'Create admin account') : isRegister ? t('login.btn_register') : t('login.btn_login')}
          </Button>
        </form>

        {!setupMode && (
          <>
            <div className="flex items-center gap-3" role="presentation">
              <Separator className="flex-1" />
              <Text as="span" size="xs" tone="muted" className="uppercase tracking-wider">{t('login.or_sign_in_with', 'atau masuk dengan')}</Text>
              <Separator className="flex-1" />
            </div>
            <Button variant="outline" onClick={handleGoogleSignIn} disabled={blocked} className="w-full">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              {t('login.google_button', 'Masuk dengan Google')}
            </Button>
            {allowRegistration && (
              <Button variant="link" className="mx-auto max-w-full" onClick={() => { setIsRegister(!isRegister); setError(''); }}>
                {isRegister ? t('login.has_account_prompt') : t('login.no_account_prompt')}
              </Button>
            )}
          </>
        )}
      </CardBody>
      <CardFooter className="justify-center"><LegalFooter onOpenPrivacy={handleOpenPrivacy} onOpenTerms={handleOpenTerms} t={t} /></CardFooter>
    </Card>
  );
};

/** Language choice before sign-in; the in-app header offers the same options. */
const LanguageSwitcher: React.FC<{ language: Language; setLanguage: (lang: Language) => void; t: (k: string, d?: string) => string }> = ({ language, setLanguage, t }) => (
  <SegmentGroup aria-label={t('header.switch_language', 'Pilih bahasa')} value={language} onValueChange={details => details.value && setLanguage(details.value as Language)}>
    <SegmentGroupIndicator />
    <SegmentGroupItems items={LANGUAGE_OPTIONS.map(option => ({ value: option.code, label: option.label }))} />
  </SegmentGroup>
);

const LegalFooter: React.FC<{ onOpenPrivacy: (e: React.MouseEvent) => void; onOpenTerms: (e: React.MouseEvent) => void; t: (k: string, d?: string) => string }> = ({ onOpenPrivacy, onOpenTerms, t }) => (
  <Text size="xs" tone="muted" className="flex flex-wrap items-center justify-center gap-x-1">
    <Button variant="link" size="sm" onClick={onOpenPrivacy}>{t('footer.privacy_policy', 'Privacy Policy')}</Button>
    <span>{t('login.footer_and', 'and')}</span>
    <Button variant="link" size="sm" onClick={onOpenTerms}>{t('footer.terms_of_service', 'Terms of Service')}</Button>
    <span>{t('login.footer_apply', 'apply')}</span>
  </Text>
);
