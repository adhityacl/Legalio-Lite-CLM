import React, { useEffect, useState } from 'react';
import { authClient } from '../lib/auth-client';
import { useAuth } from '../context/AuthContext';
import { LANGUAGE_OPTIONS, useLanguage, type Language } from '../context/LanguageContext';
import { Clock, Mail } from 'lucide-react';
import { Spinner } from '@legalio/ui-components/spinner';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Card, CardDescription, CardTitle } from '@legalio/ui-components/card';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Input } from '@legalio/ui-components/input';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { PasswordInput, PasswordInputControl, PasswordInputIndicator, PasswordInputInput, PasswordInputLabel, PasswordInputVisibilityTrigger } from '@legalio/ui-components/password-input';
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
 * Invitation links carry their context through registration and sign-in.
 */
export const SignInForm: React.FC<SignInFormProps> = ({ onOpenPrivacyPolicy, onOpenTermsOfService, allowRegistration = true }) => {
  const { t, language, setLanguage } = useLanguage();
  const { login } = useAuth();
  const [inviteCode, setInviteCode] = useState(() => allowRegistration ? capturePendingInvitation() || '' : '');
  const [linkToken, setLinkToken] = useState(inviteCode);
  const [isRegister, setIsRegister] = useState(Boolean(inviteCode));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [publicUrl, setPublicUrl] = useState(() => window.location.origin);
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
  const [invitationState, setInvitationState] = useState<'idle' | 'loading' | 'ready' | 'invalid' | 'error'>(inviteCode ? 'loading' : 'idle');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => {
    if (!allowRegistration || !linkToken) {
      setInvitation(null);
      setInvitationState('idle');
      return;
    }
    let active = true;
    setInvitationState('loading');
    loadInvitationPreview(linkToken).then(preview => {
      if (!active) return;
      setInvitation(preview);
      if (preview?.status === 'pending' && preview.email) setEmail(preview.email);
      setInvitationState(preview?.status === 'pending' ? 'ready' : 'invalid');
    }).catch(() => { if (active) setInvitationState('error'); });
    return () => { active = false; };
  }, [allowRegistration, linkToken, previewAttempt]);

  useEffect(() => {
    fetch('/api/system/public-status', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok && !allowRegistration) throw new Error(t('sys.status_failed', 'Could not load system status. Refresh to retry.'));
        return res.ok ? res.json() : null;
      })
      .then((status) => { setSetupMode(Boolean(status?.needsSetup)); setPublicUrl(status?.publicUrl || window.location.origin); setStatusReady(true); })
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
      if (allowRegistration && !setupMode) {
        try {
          if (inviteCode.trim()) sessionStorage.setItem('pendingInvitation', inviteCode.trim());
          else sessionStorage.removeItem('pendingInvitation');
        } catch { /* storage unavailable */ }
      }
      if (setupMode) {
        const res = await fetch('/api/system/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, publicUrl }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.error === 'ALREADY_SET_UP') setSetupMode(false);
          setError(data.message || t('login.setup_failed', 'Could not create the admin account.'));
          return;
        }
        setSetupMode(false);
        if (data.publicUrl && data.publicUrl !== window.location.origin) {
          window.location.assign(data.publicUrl);
          return;
        }
        await login(email, password);
      } else if (allowRegistration && isRegister) {
        const token = inviteCode.trim();
        const { data, error } = await authClient.signUp.email({ name, email, password }, {
          headers: token ? { 'x-invitation-token': token } : {},
        });
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
        } else if ((data?.user as { banned?: boolean } | undefined)?.banned === false) {
          await login(email, password, rememberMe, token);
        } else {
          try { await (authClient.signOut as any)(); } catch (_) {}
          setRegistrationSuccess(true);
        }
      } else {
        await login(email, password, rememberMe, inviteCode.trim() || undefined);
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

  const isPending = /menunggu|pending/i.test(error);
  const blocked = loading || (!allowRegistration && !statusReady) || (Boolean(linkToken) && invitationState !== 'ready');
  const invited = invitationState === 'ready' && invitation !== null && !setupMode;
  const shell = (card: React.ReactNode) => (
    <AuthShell invitationContext={Boolean(linkToken)} language={language} setLanguage={setLanguage} t={t} onOpenPrivacy={handleOpenPrivacy} onOpenTerms={handleOpenTerms}>{card}</AuthShell>
  );

  if (linkToken && !setupMode && invitationState !== 'ready' && invitationState !== 'idle') {
    const checking = invitationState === 'loading';
    const unavailable = invitationState === 'error';
    return shell(
      <Card className="auth-card w-full gap-g21 rounded-xl p-g21 shadow-xl sm:p-g34" aria-busy={checking}>
        <div className="flex size-g42 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
          {checking ? <Spinner size="sm" decorative /> : <Mail className="size-g21" />}
        </div>
        <div className="flex flex-col gap-g8" role={checking ? 'status' : 'alert'}>
          <CardTitle asChild className="text-xl font-extrabold"><h1>{checking
            ? t('invite.checking', 'Checking your invitation')
            : unavailable ? t('invite.load_failed', 'We couldn’t load your invitation') : t('invite.invalid_title', 'This invitation is no longer available')}</h1></CardTitle>
          <CardDescription>{checking
            ? t('invite.checking_hint', 'Getting your workspace details…')
            : unavailable ? t('invite.retry_hint', 'Check your connection and try again.')
            : t('invite.invalid_hint', 'The link may have expired, been canceled, or already been used. Ask your organization administrator for a new invitation.')}</CardDescription>
        </div>
        {!checking && <div className="flex flex-col gap-g8">
          {unavailable && <Button onClick={() => setPreviewAttempt(value => value + 1)}>{t('invite.retry', 'Try again')}</Button>}
          <Button variant="outline" onClick={() => {
            setInviteCode(''); setLinkToken(''); setInvitation(null); setInvitationState('idle'); setIsRegister(false);
            try { sessionStorage.removeItem('pendingInvitation'); } catch { /* storage unavailable */ }
          }}>{t('invite.continue_without', 'Continue without an invitation')}</Button>
        </div>}
      </Card>
    );
  }

  if (registrationSuccess) {
    return shell(
      <Card className="auth-card w-full gap-g21 rounded-xl p-g21 shadow-xl sm:p-g34">
        <Avatar size="lg" className="bg-status-warning-soft text-status-warning" aria-hidden="true"><AvatarFallback className="bg-transparent text-inherit"><Clock className="size-g34" /></AvatarFallback></Avatar>
        <div className="flex flex-col gap-g8">
          <CardTitle asChild className="text-xl font-extrabold"><h1>{t('login.account_created_title')}</h1></CardTitle>
          <CardDescription>
            {t('onboarding.registration_done', 'Your account was created and is waiting for manual superuser approval. Once approved, sign in to join or create an organization.')}
          </CardDescription>
        </div>
        <Button variant="outline" className="w-full" onClick={() => { setRegistrationSuccess(false); setIsRegister(false); setError(''); setName(''); setPassword(''); }}>
          {t('login.back_to_login')}
        </Button>
      </Card>
    );
  }

  const title = invited ? t('invite.title', 'You’ve been invited to join {org}', { org: invitation.organizationName }) : setupMode ? t('login.setup_title', 'Create your admin account') : isRegister ? t('login.create_account') : t('login.welcome_back', 'Welcome back');
  const subtitle = invited ? (isRegister
    ? t('invite.register_hint', 'Create your account to accept your invitation and get started with your team.')
    : t('invite.signin_hint', 'Sign in with your existing account to accept your invitation.')) : setupMode ? t('login.setup_subtitle', 'Set your website URL and create the first superuser.') : isRegister ? t('login.fill_form_reg') : t('login.welcome_subtitle', 'Please sign in with your Legalio account');

  return shell(
    <Card className={`auth-card ${setupMode ? 'auth-setup-card' : ''} w-full gap-g21 rounded-xl p-g21 shadow-xl sm:p-g34`}>
      {invited && <Text size="sm" className="flex items-center gap-g8 font-semibold text-primary"><Mail className="size-g16 shrink-0" aria-hidden="true" />{t('tb.invitation_title', 'Organization invitation')}</Text>}
      <div className="flex flex-col gap-g8">
        <CardTitle asChild className="break-words text-xl font-extrabold leading-tight sm:text-2xl"><h1>{title}</h1></CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </div>
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
        {setupMode && (
          <Field required>
            <FieldLabel htmlFor="setup-public-url">{t('login.public_url_label', 'Website URL')}</FieldLabel>
            <Input id="setup-public-url" type="url" required autoComplete="url" value={publicUrl} onChange={e => setPublicUrl(e.target.value)} aria-describedby="setup-public-url-help" />
            <Text id="setup-public-url-help" size="xs" tone="muted">{t('login.public_url_help', 'Include http:// or https:// and the public port if needed.')}</Text>
          </Field>
        )}
        {(isRegister || setupMode) && (
          <Field required>
            <FieldLabel htmlFor="signin-name">{t('login.fullname_label')}</FieldLabel>
            <Input id="signin-name" type="text" required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder={t('login.fullname_placeholder')} />
          </Field>
        )}
        <Field required>
          <FieldLabel htmlFor="signin-email">{t('login.email_label')}</FieldLabel>
          <Input id="signin-email" type="email" required autoComplete="email" readOnly={Boolean(invited && invitation.email)} value={email} onChange={e => setEmail(e.target.value)} placeholder={t('login.email_example', 'name@company.com')} />
        </Field>
        <PasswordInput ids={{ input: 'signin-password' }} autoComplete={setupMode || isRegister ? 'new-password' : 'current-password'}>
          <PasswordInputLabel>{t('login.password_label')}</PasswordInputLabel>
          <PasswordInputControl>
            <PasswordInputInput required minLength={setupMode || isRegister ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••••" />
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
        {allowRegistration && isRegister && !setupMode && !invited && (
          <Field>
            <FieldLabel htmlFor="signin-invite-code">{t('onboarding.invite_code_optional', 'Invite code (optional)')}</FieldLabel>
            <Input id="signin-invite-code" value={inviteCode} onChange={e => setInviteCode(e.target.value)} maxLength={128} autoComplete="off" spellCheck={false} />
          </Field>
        )}
        <Button type="submit" loading={loading} disabled={blocked} className="w-full">
          {invited ? (isRegister ? t('invite.create_account', 'Create account & continue') : t('invite.sign_in', 'Sign in & continue')) : setupMode ? t('login.setup_submit', 'Create admin account') : isRegister ? t('login.btn_register') : t('login.sign_in_securely', 'Sign in securely')}
        </Button>
      </form>

      {!setupMode && allowRegistration && (
        <Text size="sm" tone="muted" className="flex flex-wrap items-center justify-center gap-x-g5">
          {isRegister ? t('login.have_account', 'Already have an account?') : t('login.new_here', 'New here?')}
          <Button variant="link" size="sm" className="px-0 font-semibold text-foreground no-underline hover:underline" onClick={() => { setIsRegister(!isRegister); setError(''); setResetHint(false); }}>
            {isRegister ? t('login.sign_in_link', 'Sign in') : invited ? t('login.create_account', 'Create account') : t('login.request_access', 'Request access')}
          </Button>
        </Text>
      )}
    </Card>
  );
};

/** Full-page sign-in scene: dark backdrop, product pitch on the major side, the card on the minor side. */
const AuthShell: React.FC<{ children: React.ReactNode; invitationContext?: boolean; language: Language; setLanguage: (lang: Language) => void; t: (k: string, d?: string, v?: Record<string, unknown>) => string; onOpenPrivacy: (e: React.MouseEvent) => void; onOpenTerms: (e: React.MouseEvent) => void }> = ({ children, invitationContext = false, language, setLanguage, t, onOpenPrivacy, onOpenTerms }) => (
  <main className="auth-backdrop relative isolate flex h-dvh w-full flex-col overflow-x-hidden overflow-y-auto bg-auth-ink text-auth-foreground">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="auth-glow-blue absolute -start-g55 -top-g55 size-g233 rounded-full lg:start-g68 lg:top-g89 lg:size-g610" />
      <div className="auth-glow-violet absolute end-0 top-g377 size-g233 rounded-full lg:end-g89 lg:top-g110 lg:size-g377" />
    </div>
    <div className="auth-language flex shrink-0 justify-end px-g21 pt-g21 lg:px-g42"><LanguageSwitcher language={language} setLanguage={setLanguage} t={t} /></div>
    <div className="auth-layout mx-auto flex w-full max-w-g1597 flex-1 shrink-0 flex-col gap-g21 px-g21 py-g21 lg:flex-row lg:items-center lg:justify-between lg:gap-g34 lg:px-g42 lg:py-g34 xl:gap-g55 xl:px-g110 xl:py-g55">
      <section className="auth-hero flex min-w-0 max-w-g610 flex-col gap-g21 lg:flex-1 lg:gap-g34">
        <Image src={new URL('../assets/logo-light.png', import.meta.url).href} alt="Legalio" layout="fixed" height={42} width={206} className="h-g34 w-auto self-start object-contain lg:h-g42" />
        <div className={`${invitationContext ? 'hidden lg:flex' : 'flex'} flex-col gap-g13 lg:gap-g21`}>
          <p className="text-2xl font-extrabold leading-snug lg:text-3xl">{t('login.hero_title', 'All in one workspace for partner, contracts, and spending tracker.')}</p>
          <p className="text-sm text-auth-muted lg:text-md lg:leading-relaxed">{t('login.hero_desc', 'Monitor agreements, discuss with AI, upload supporting documents, evaluate vendors, and keep every operational record organized')}</p>
        </div>
      </section>
      <div className="auth-form flex w-full max-w-g377 flex-col items-center gap-g21 self-center lg:shrink-0">
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
