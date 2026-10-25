import { api, apiRequest, errorMessage, isApiError } from '@legalio/shared/apiClient';
import React, { useEffect, useState } from 'react';
import { authClient } from '../lib/auth-client';
import { useAuth } from '../context/AuthContext';
import { LANGUAGE_OPTIONS, useLanguage, type Language } from '../context/LanguageContext';
import { Clock, KeyRound, Mail } from 'lucide-react';
import { Spinner } from '@legalio/ui-components/spinner';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Card, CardDescription, CardTitle } from '@legalio/ui-components/card';
import { EMPTY_STORAGE, StorageFields, type StorageValues } from './settings/StorageFields';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Input } from '@legalio/ui-components/input';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { PasswordInput, PasswordInputControl, PasswordInputIndicator, PasswordInputInput, PasswordInputLabel, PasswordInputVisibilityTrigger } from '@legalio/ui-components/password-input';
import { Text } from '@legalio/ui-components/text';
import { capturePendingInvitation, loadInvitationPreview, type InvitationPreview } from './account/InvitationPrompt';
import { Image } from '@legalio/ui-components/image';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
interface SsoOrganizationHint { slug: string; name: string }
/** `/sso/<organization-slug>`: the per-organization sign-in link. */
const ssoSlugFromPath = (): string => /^\/sso\/([a-z0-9-]{1,80})\/?$/i.exec(window.location.pathname)?.[1]?.toLowerCase() ?? '';
const startSso = (slug: string, loginHint?: string) => {
  const query = loginHint ? `?login_hint=${encodeURIComponent(loginHint)}` : '';
  window.location.assign(`/api/sso/${encodeURIComponent(slug)}/start${query}`);
};

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
  // First step of a brand-new install: no DATABASE_URL and no saved connection yet.
  const [needsDatabase, setNeedsDatabase] = useState(false);
  const [database, setDatabase] = useState({ host: '', port: '5432', user: '', password: '', database: '', ssl: false });
  const [storage, setStorage] = useState<StorageValues>(EMPTY_STORAGE);
  const setDb = (key: keyof typeof database) => (e: React.ChangeEvent<HTMLInputElement>) => setDatabase(prev => ({ ...prev, [key]: e.target.value }));

  // Single sign-on: the per-organization link (/sso/<slug>), or organizations found for the typed e-mail domain.
  const [ssoSlug] = useState(ssoSlugFromPath);
  const [ssoOrgs, setSsoOrgs] = useState<SsoOrganizationHint[]>([]);
  const [ssoChecked, setSsoChecked] = useState(!ssoSlug);
  const [ssoError, setSsoError] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('sso_error');
    if (code) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.hash); } catch { /* history unavailable */ }
    }
    return code && /^[A-Z_]{3,60}$/.test(code) ? code : '';
  });
  useEffect(() => {
    if (!ssoSlug) return;
    let active = true;
    api.get<{ organizations: SsoOrganizationHint[] }>(`/sso/lookup?slug=${encodeURIComponent(ssoSlug)}`, { notifyUnauthorized: false })
      .then((result) => { if (active) setSsoOrgs(result.organizations ?? []); })
      .catch(() => undefined)
      .finally(() => { if (active) setSsoChecked(true); });
    return () => { active = false; };
  }, [ssoSlug]);
  useEffect(() => {
    if (ssoSlug || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { if (!ssoSlug) setSsoOrgs([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      api.get<{ organizations: SsoOrganizationHint[] }>(`/sso/lookup?email=${encodeURIComponent(email)}`, { notifyUnauthorized: false })
        .then((result) => { if (active) setSsoOrgs(result.organizations ?? []); })
        .catch(() => { if (active) setSsoOrgs([]); });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [email, ssoSlug]);

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

  const loadStatus = () => apiRequest<any>('/system/public-status', { cache: 'no-store' })
    .catch((err) => {
      if (!allowRegistration) throw new Error(isApiError(err) && err.status > 0 ? t('sys.status_failed', 'Could not load system status. Refresh to retry.') : err.message);
      if (isApiError(err) && err.status > 0) return null;
      throw err;
    })
    .then((status) => { setNeedsDatabase(Boolean(status?.needsDatabase)); setSetupMode(Boolean(status?.needsSetup)); setPublicUrl(status?.publicUrl || window.location.origin); setStatusReady(true); })
    .catch((err) => { if (!allowRegistration) setError(err.message); });
  useEffect(() => { void loadStatus(); }, [allowRegistration]);

  const connectDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      try {
        await api.post('/system/database', { ...database, port: Number(database.port) }, { notifyUnauthorized: false });
      } catch (err) {
        // 409: the database was connected meanwhile (another tab or visitor); the status below shows the next step.
        if (!(isApiError(err) && err.status === 409)) throw err;
      }
      setDatabase(prev => ({ ...prev, password: '' }));
      await loadStatus();
    } catch (err: any) {
      setError(errorMessage(err, t('db_setup.failed', 'Could not connect to the database.')));
    } finally {
      setLoading(false);
    }
  };

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
    setSsoError('');

    try {
      if (allowRegistration && !setupMode) {
        try {
          if (inviteCode.trim()) sessionStorage.setItem('pendingInvitation', inviteCode.trim());
          else sessionStorage.removeItem('pendingInvitation');
        } catch { /* storage unavailable */ }
      }
      if (setupMode) {
        let data: { publicUrl?: string };
        try {
          data = await api.post<{ publicUrl?: string }>('/system/setup', { name, email, password, publicUrl, storage });
        } catch (err) {
          if (!isApiError(err) || err.status === 0) throw err;
          if (err.error === 'ALREADY_SET_UP' || err.code === 'ALREADY_SET_UP') setSetupMode(false);
          setError(errorMessage(err, t('login.setup_failed', 'Could not create the admin account.')));
          return;
        }
        setSetupMode(false);
        setStorage(prev => ({ ...prev, secretKey: '' }));
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
  const ssoMessage = ssoError ? t(`sso.error.${ssoError}`, t('sso.error.generic', 'Single sign-on failed. Please try again or contact your administrator.')) : '';
  const errorAlert = (error || ssoMessage) && (
    <Alert status={isPending ? 'warning' : 'error'} role="alert">
      <AlertIndicator />
      <AlertContent><AlertDescription className="text-sm">{error || ssoMessage}</AlertDescription></AlertContent>
    </Alert>
  );
  const shell = (card: React.ReactNode) => (
    <AuthShell invitationContext={Boolean(linkToken)} language={language} setLanguage={setLanguage} t={t} onOpenPrivacy={handleOpenPrivacy} onOpenTerms={handleOpenTerms}>{card}</AuthShell>
  );

  if (needsDatabase) {
    return shell(
      <Card className="auth-card auth-setup-card w-full gap-g21 rounded-xl p-g21 shadow-xl sm:p-g34">
        <div className="flex flex-col gap-g8">
          <CardTitle asChild className="break-words text-xl font-extrabold leading-tight sm:text-2xl"><h1>{t('db_setup.title', 'Connect PostgreSQL')}</h1></CardTitle>
          <CardDescription>{t('db_setup.subtitle', 'Enter the database this installation will use. The connection is tested and the tables are created before it is saved.')}</CardDescription>
        </div>
        {errorAlert}
        <form onSubmit={(event) => void connectDatabase(event)} className="grid grid-cols-[1fr_6rem] gap-g13" aria-busy={loading}>
          <Field required>
            <FieldLabel htmlFor="db-host">{t('db_setup.host', 'Host')}</FieldLabel>
            <Input id="db-host" required autoComplete="off" spellCheck={false} placeholder="127.0.0.1" value={database.host} onChange={setDb('host')} />
          </Field>
          <Field required>
            <FieldLabel htmlFor="db-port">{t('db_setup.port', 'Port')}</FieldLabel>
            <Input id="db-port" type="number" required min={1} max={65535} step={1} inputMode="numeric" value={database.port} onChange={setDb('port')} />
          </Field>
          <Field required className="col-span-2">
            <FieldLabel htmlFor="db-user">{t('db_setup.user', 'Username')}</FieldLabel>
            <Input id="db-user" required autoComplete="off" spellCheck={false} value={database.user} onChange={setDb('user')} />
          </Field>
          <PasswordInput className="col-span-2" ids={{ input: 'db-password' }} autoComplete="new-password">
            <PasswordInputLabel>{t('login.password_label')}</PasswordInputLabel>
            <PasswordInputControl>
              <PasswordInputInput value={database.password} onChange={setDb('password')} />
              <PasswordInputVisibilityTrigger><PasswordInputIndicator /></PasswordInputVisibilityTrigger>
            </PasswordInputControl>
          </PasswordInput>
          <Field required className="col-span-2">
            <FieldLabel htmlFor="db-name">{t('db_setup.database', 'Database name')}</FieldLabel>
            <Input id="db-name" required autoComplete="off" spellCheck={false} placeholder="legalio" value={database.database} onChange={setDb('database')} />
          </Field>
          <Checkbox className="col-span-2" checked={database.ssl} onCheckedChange={details => setDatabase(prev => ({ ...prev, ssl: details.checked === true }))}>
            <CheckboxControl /><CheckboxLabel>{t('db_setup.ssl', 'Use SSL (verified certificate)')}</CheckboxLabel><CheckboxHiddenInput />
          </Checkbox>
          <Button type="submit" loading={loading} disabled={loading} className="col-span-2 w-full">{t('db_setup.submit', 'Connect database')}</Button>
        </form>
      </Card>
    );
  }

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

  const ssoOrg = ssoSlug ? ssoOrgs[0] : undefined;
  const showSso = !setupMode && !isRegister && !invited && (ssoOrgs.length > 0 || (Boolean(ssoSlug) && ssoChecked));
  const title = ssoOrg && !invited && !setupMode && !isRegister ? t('sso.signin.org_title', 'Sign in to {org}', { org: ssoOrg.name }) : invited ? t('invite.title', 'You’ve been invited to join {org}', { org: invitation.organizationName }) : setupMode ? t('login.setup_title', 'Setup Legalio Website') : isRegister ? t('login.create_account') : t('login.welcome_back', 'Welcome back');
  const subtitle = ssoOrg && !invited && !setupMode && !isRegister ? t('sso.signin.org_hint', 'Your organization uses single sign-on. You will be sent to your identity provider and brought back here.') : invited ? (isRegister
    ? t('invite.register_hint', 'Create your account to accept your invitation and get started with your team.')
    : t('invite.signin_hint', 'Sign in with your existing account to accept your invitation.')) : setupMode ? t('login.setup_subtitle', 'Set your website URL, create the first superuser and connect file storage.') : isRegister ? t('login.fill_form_reg') : t('login.welcome_subtitle', 'Please sign in with your Legalio account');

  return shell(
    <Card className={`auth-card ${setupMode ? 'auth-setup-card' : ''} w-full gap-g21 rounded-xl p-g21 shadow-xl sm:p-g34`}>
      {invited && <Text size="sm" className="flex items-center gap-g8 font-semibold text-primary"><Mail className="size-g16 shrink-0" aria-hidden="true" />{t('tb.invitation_title', 'Organization invitation')}</Text>}
      <div className="flex flex-col gap-g8">
        <CardTitle asChild className="break-words text-xl font-extrabold leading-tight sm:text-2xl"><h1>{title}</h1></CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </div>
      {errorAlert}
      {resetHint && !isRegister && !setupMode && (
        <Alert status="info" role="status">
          <AlertIndicator />
          <AlertContent><AlertDescription className="text-sm">{t('login.forgot_hint', 'Ask your workspace administrator to reset your password.')}</AlertDescription></AlertContent>
        </Alert>
      )}

      {showSso && (
        <div className="flex flex-col gap-g13">
          {ssoOrgs.length > 0 ? (
            <div className="flex flex-col gap-g8">
              {ssoOrgs.map((org) => (
                <Button key={org.slug} type="button" variant={ssoSlug ? 'default' : 'outline'} className="w-full" onClick={() => startSso(org.slug, email)}>
                  <KeyRound aria-hidden="true" />{ssoOrgs.length > 1 ? t('sso.signin.continue_org', 'Continue with SSO ({org})', { org: org.name }) : t('sso.signin.continue', 'Continue with SSO')}
                </Button>
              ))}
            </div>
          ) : (
            <Alert status="info" role="status">
              <AlertIndicator />
              <AlertContent><AlertDescription className="text-sm">{t('sso.signin.not_available', 'Single sign-on is not available for this address. Sign in with your password.')}</AlertDescription></AlertContent>
            </Alert>
          )}
          <div className="flex items-center gap-g8 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />{t('sso.signin.divider', 'or')}<span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}

      <form onSubmit={(event) => void handleSubmit(event)} className={`flex flex-col ${setupMode ? 'gap-[11px]' : 'gap-g13'}`} aria-busy={loading}>
        {setupMode && (
          <Field required>
            <FieldLabel htmlFor="setup-public-url">{t('login.public_url_label', 'Website URL')}</FieldLabel>
            <Input id="setup-public-url" type="url" required autoComplete="url" value={publicUrl} onChange={e => setPublicUrl(e.target.value)} />
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
        {setupMode && (
          <fieldset aria-labelledby="setup-cos-title" className="mt-g8 flex min-w-0 flex-col gap-[11px] border-t border-border pt-g21">
            <div className="flex flex-col gap-g5">
              <p id="setup-cos-title" className="text-sm font-semibold">{t('storage.setup_title', 'File storage')}</p>
              <Text size="xs" tone="muted">{t('cos_setup.purpose', 'Uploaded files are stored in this bucket. Saving tests the credentials first.')}</Text>
            </div>
            <StorageFields idPrefix="setup-storage" values={storage} onChange={patch => setStorage(prev => ({ ...prev, ...patch }))} />
          </fieldset>
        )}
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
        <Button type="submit" loading={loading} disabled={blocked} className={`w-full ${setupMode ? 'mt-[5px]' : ''}`}>
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
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
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
        <Button type="button" variant="link" size="sm" lang={option.htmlLang} aria-pressed={language === option.code} aria-label={`${option.label} ${option.nativeName}`} onClick={() => setLanguage(option.code)}
          className={`h-auto px-0 text-xs font-semibold no-underline hover:underline ${language === option.code ? 'text-auth-foreground' : 'text-auth-muted/70'} hover:text-auth-foreground`}>
          {option.label}
        </Button>
      </React.Fragment>
    ))}
  </div>
);
