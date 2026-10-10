import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, LogOut, Monitor, Moon, Sun, Trash2, X } from 'lucide-react';
import { authClient } from '../../lib/auth-client';
import { useIdentity } from '../../context/AuthContext';
import { LANGUAGE_OPTIONS, useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { ModalFrame } from '../ui/modal-frame';
import { Button } from '@legalio/ui-components/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';

import { Input } from '@legalio/ui-components/input';
import { Textarea } from '@legalio/ui-components/textarea';
import { CardHeader } from '@legalio/ui-components/card';
import { DialogTitle } from '@legalio/ui-components/dialog';
import { Field, FieldLabel, FieldHelperText } from '@legalio/ui-components/field';
import { Alert, AlertContent } from '@legalio/ui-components/alert';

const Header: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => {
  const { t } = useLanguage();
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border pb-4">
      <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
      <Button type="button" variant="ghost" size="icon-md" onClick={onClose} aria-label={t('common.close', 'Close')}><X className="h-4 w-4" aria-hidden="true" /></Button>
    </CardHeader>
  );
};

/** Personal theme and UI language, stored for this identity in this browser only (PRD §6.7). */
export const PreferencesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  return (
    <ModalFrame onClose={onClose} className="max-w-lg">
      <Header title={t('tb.preferences', 'Preferences')} onClose={onClose} />
      <div className="flex flex-col gap-5 overflow-y-auto p-5">
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-foreground ">{t('tb.theme', 'Theme')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {([['light', t('tb.theme_light', 'Light'), Sun], ['dark', t('tb.theme_dark', 'Dark'), Moon]] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}
                className={`flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--moduix-color-ring)/40 ${theme === value ? 'border-primary bg-primary/10 text-accent-foreground ' : 'border-border text-foreground '}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-foreground ">{t('tb.ui_language', 'Interface language')}</legend>
          <div className="grid gap-2">
            {LANGUAGE_OPTIONS.map((option) => (
              <button key={option.code} type="button" lang={option.htmlLang} aria-pressed={language === option.code} onClick={() => setLanguage(option.code)}
                className={`flex min-h-10 cursor-pointer items-center justify-between rounded-md border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--moduix-color-ring)/40 ${language === option.code ? 'border-primary bg-primary/10 text-accent-foreground ' : 'border-border text-foreground '}`}>
                {option.nativeName}{language === option.code && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">{t('tb.preferences_local', 'These preferences apply to your account in this browser only.')}</p>
      </div>
    </ModalFrame>
  );
};

interface OwnSession { id: string; createdAt: string; updatedAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; current: boolean }

/**
 * Account Profile (PRD §6.7): update your own profile, change your own
 * password through Better Auth self-service, and review/revoke your own
 * sessions. Never the admin set-password path; OAuth-only accounts see their
 * sign-in method instead.
 */
export const AccountProfileDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const { identity, refreshUser } = useIdentity();
  const [tab, setTab] = useState('profile');
  const [sessions, setSessions] = useState<OwnSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState(false);
  const [firstName, setFirstName] = useState(identity?.name.trim().split(/\s+/)[0] || '');
  const [lastName, setLastName] = useState(identity?.name.trim().split(/\s+/).slice(1).join(' ') || '');
  const [bio, setBio] = useState(identity?.bio || '');
  const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
  const [image, setImage] = useState(identity?.image || '');
  const [profileState, setProfileState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ids = { first: useId(), last: useId(), email: useId(), bio: useId(), image: useId(), current: useId(), next: useId(), confirm: useId() };
  const hasPassword = identity?.signInMethods.includes('password');

  const loadSessions = async () => {
    setSessionsError(false);
    try {
      const res = await fetch('/api/me/sessions', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setSessions((await res.json()).sessions);
    } catch {
      setSessionsError(true);
    }
  };
  useEffect(() => { void loadSessions(); }, []);

  const selectImage = (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(file.type)) {
      setProfileState({ kind: 'error', message: t('tb.profile_photo_type', 'Choose a JPG, GIF, or PNG image.') });
      return;
    }
    if (file.size > 800 * 1024) {
      setProfileState({ kind: 'error', message: t('tb.profile_photo_size', 'The image must be 800 KB or smaller.') });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImage(reader.result);
        setProfileState({ kind: 'idle' });
      }
    };
    reader.onerror = () => setProfileState({ kind: 'error', message: t('tb.profile_photo_read_failed', 'The image could not be read.') });
    reader.readAsDataURL(file);
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    setProfileState({ kind: 'saving' });
    try {
      const { error } = await (authClient as any).updateUser({ name: nextName, image: image || null, bio: bio.trim() });
      if (error) {
        setProfileState({ kind: 'error', message: error.message || t('tb.profile_update_failed', 'The profile could not be updated.') });
        return;
      }
      setFirstName(firstName.trim());
      setLastName(lastName.trim());
      setBio(bio.trim());
      await refreshUser();
      setProfileState({ kind: 'saved' });
    } catch {
      setProfileState({ kind: 'error', message: t('tb.profile_update_failed', 'The profile could not be updated.') });
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!current || next.length < 8 || next !== confirm || state.kind === 'saving') return;
    setState({ kind: 'saving' });
    try {
      const { error } = await (authClient as any).changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: false });
      if (error) setState({ kind: 'error', message: error.message || t('tb.password_change_failed', 'The password could not be changed.') });
      else {
        setState({ kind: 'saved' });
        setCurrent('');
        setNext('');
        setConfirm('');
        void loadSessions();
      }
    } catch {
      setState({ kind: 'error', message: t('tb.password_change_failed', 'The password could not be changed.') });
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    void loadSessions();
  };

  return (
    <ModalFrame onClose={onClose} className="max-w-3xl">
      <Header title={t('tb.account_profile', 'Account Profile')} onClose={onClose} />
      <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
        <Tabs value={tab} onValueChange={details => setTab(details.value)} className="gap-8">
          <TabsList aria-label={t('tb.account_profile', 'Account Profile')} className="h-auto w-full rounded-2xl bg-muted p-1">
            <TabsTrigger value="profile" className="min-h-10 flex-1 rounded-md">{t('tb.profile_tab', 'Profile')}</TabsTrigger>
            <TabsTrigger value="security" className="min-h-10 flex-1 rounded-md">{t('tb.security_tab', 'Security')}</TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
        <form onSubmit={saveProfile} aria-label={t('tb.profile_details', 'Profile details')} className="flex flex-col gap-6">
          <div className="flex items-center gap-5">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card text-lg font-medium text-foreground">
                {image ? <img src={image} alt={t('tb.profile_photo', 'Profile photo')} className="h-full w-full object-cover" /> : [firstName, lastName].map(part => part.trim().charAt(0).toUpperCase()).join('') || (identity?.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  id={ids.image}
                  type="file"
                  accept="image/jpeg,image/gif,image/png"
                  aria-label={t('tb.upload_photo', 'Upload photo')}
                  className="hidden"
                  onChange={(event) => { selectImage(event.target.files?.[0]); event.target.value = ''; }}
                />
                <Button type="button" variant="outline" disabled={profileState.kind === 'saving'} onClick={() => fileInputRef.current?.click()}>
                  {t('tb.upload_photo', 'Upload photo')}
                </Button>
                {image && (
                  <Button type="button" variant="ghost" disabled={profileState.kind === 'saving'} onClick={() => { setImage(''); setProfileState({ kind: 'idle' }); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />{t('tb.remove_photo', 'Remove')}
                  </Button>
                )}
                </div>
                <p className="text-xs text-muted-foreground">{t('tb.profile_photo_hint', 'JPG, GIF or PNG. Max 800 KB.')}</p>
              </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={ids.first}>{t('tb.first_name', 'First Name')}</FieldLabel>
              <Input id={ids.first} type="text" autoComplete="given-name" maxLength={100} required disabled={profileState.kind === 'saving'} value={firstName} onChange={event => { setFirstName(event.target.value); setProfileState({ kind: 'idle' }); }} />
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.last}>{t('tb.last_name', 'Last Name')}</FieldLabel>
              <Input id={ids.last} type="text" autoComplete="family-name" maxLength={100} disabled={profileState.kind === 'saving'} value={lastName} onChange={event => { setLastName(event.target.value); setProfileState({ kind: 'idle' }); }} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={ids.email}>{t('tb.profile_email', 'Email')}</FieldLabel>
            <Input id={ids.email} type="email" autoComplete="email" readOnly className={``} value={identity?.email || ''} />
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.bio}>{t('tb.profile_bio', 'Bio')}</FieldLabel>
            <Textarea id={ids.bio} rows={3} maxLength={500} disabled={profileState.kind === 'saving'} className={`resize-y`} value={bio} placeholder={t('tb.profile_bio_placeholder', 'Tell us about yourself')} onChange={event => { setBio(event.target.value); setProfileState({ kind: 'idle' }); }} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="w-full" disabled={!firstName.trim() || profileState.kind === 'saving'}>
              {profileState.kind === 'saving' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{t('tb.save_profile', 'Save profile')}
            </Button>
            <span aria-live="polite">{profileState.kind === 'saved' && <span className="flex items-center gap-2 text-sm text-status-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('tb.profile_saved', 'Profile updated.')}</span>}</span>
            {profileState.kind === 'error' && <span role="alert" className="flex items-center gap-2 text-sm text-status-danger"><AlertCircle className="h-4 w-4" aria-hidden="true" />{profileState.message}</span>}
          </div>
        </form>
          </TabsContent>
          <TabsContent value="security" className="space-y-6">
        {hasPassword ? (
          <form onSubmit={changePassword} aria-label={t('tb.change_password', 'Change password')} className="flex flex-col gap-8">
            <div className="grid gap-6">
              <Field>
                <FieldLabel htmlFor={ids.current}>{t('tb.current_password', 'Current password')}</FieldLabel>
                <Input id={ids.current} type="password" autoComplete="current-password" required disabled={state.kind === 'saving'} placeholder={t('tb.current_password_placeholder', 'Enter current password')} value={current} onChange={(e) => { setCurrent(e.target.value); setState({ kind: 'idle' }); }} />
              </Field>
              <Field>
                <FieldLabel htmlFor={ids.next}>{t('tb.new_password', 'New password')}</FieldLabel>
                <Input id={ids.next} type="password" autoComplete="new-password" required minLength={8} disabled={state.kind === 'saving'} placeholder={t('tb.new_password_placeholder', 'Enter new password')} value={next} aria-invalid={next.length > 0 && next.length < 8} aria-describedby={`${ids.next}-hint`} onChange={(e) => { setNext(e.target.value); setState({ kind: 'idle' }); }} />
                <FieldHelperText id={`${ids.next}-hint`}>{t('tb.password_hint', 'At least 8 characters.')}</FieldHelperText>
              </Field>
              <Field>
                <FieldLabel htmlFor={ids.confirm}>{t('tb.confirm_password', 'Confirm Password')}</FieldLabel>
                <Input id={ids.confirm} type="password" autoComplete="new-password" required disabled={state.kind === 'saving'} placeholder={t('tb.confirm_password_placeholder', 'Confirm new password')} value={confirm} aria-invalid={confirm.length > 0 && confirm !== next} aria-describedby={confirm.length > 0 && confirm !== next ? `${ids.confirm}-error` : undefined} onChange={event => { setConfirm(event.target.value); setState({ kind: 'idle' }); }} />
                {confirm.length > 0 && confirm !== next && <p id={`${ids.confirm}-error`} className="mt-1.5 text-xs text-status-danger">{t('tb.password_mismatch', 'Passwords do not match.')}</p>}
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button type="submit" className="w-full" disabled={!current || next.length < 8 || next !== confirm || state.kind === 'saving'}>
                {state.kind === 'saving' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{t('tb.update_password', 'Update Password')}
              </Button>
              <span aria-live="polite">{state.kind === 'saved' && <span className="flex items-center gap-2 text-sm text-status-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('tb.password_changed', 'Password changed.')}</span>}</span>
              {state.kind === 'error' && <span role="alert" className="flex items-center gap-2 text-sm text-status-danger"><AlertCircle className="h-4 w-4" aria-hidden="true" />{state.message}</span>}
            </div>
          </form>
        ) : (
          <p className="text-sm text-foreground">{t('tb.no_password', 'This account signs in with an identity provider and has no password to change here.')}</p>
        )}
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">{t('tb.your_sessions', 'Your sessions')}</summary>
          <p className="my-3 text-xs text-muted-foreground">
            {t('tb.sign_in_method', 'Sign-in method')}: {(identity?.signInMethods || []).map(m => m === 'password' ? t('tb.method_password', 'Email and password') : m === 'google' ? 'Google' : m).join(', ') || '—'}
          </p>
          {sessionsError && <Alert status="error" role="alert"><AlertContent>{t('tb.sessions_load_error', 'Sessions could not be loaded.')}</AlertContent></Alert>}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {(sessions || []).map((s) => (
              <li key={s.id} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{s.userAgent || t('tb.unknown_device', 'Unknown device')}</span>
                    <span className="block text-xs text-muted-foreground">{new Date(s.updatedAt || s.createdAt).toLocaleString()}{s.current ? ` · ${t('tb.this_session', 'This session')}` : ''}</span>
                  </span>
                </span>
                {!s.current && <Button type="button" variant="ghost" size="sm" onClick={() => revoke(s.id)}><LogOut className="h-4 w-4" aria-hidden="true" />{t('tb.sign_out_session', 'Sign out')}</Button>}
              </li>
            ))}
          </ul>
        </details>
          </TabsContent>
        </Tabs>
      </div>
    </ModalFrame>
  );
};
