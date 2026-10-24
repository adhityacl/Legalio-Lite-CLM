import { api } from '@legalio/shared/apiClient';
import React, { useEffect, useId, useState } from 'react';
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
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';

import { RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemHiddenInput, RadioGroupItemText, RadioGroupLabel } from '@legalio/ui-components/radio-group';
import { SegmentGroup, SegmentGroupIndicator, SegmentGroupItems } from '@legalio/ui-components/segment-group';
import { Avatar, AvatarFallback, AvatarImage } from '@legalio/ui-components/avatar';
import { Collapsible, CollapsibleContent, CollapsibleIndicator, CollapsibleTrigger } from '@legalio/ui-components/collapsible';
import { Text } from '@legalio/ui-components/text';
import { FileUpload, FileUploadHiddenInput, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Spinner } from '@legalio/ui-components/spinner';
import { List, ListItem } from '@legalio/ui-components/list';
const Header: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => {
  const { t } = useLanguage();
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-g13 border-b border-border pb-g13">
      <DialogTitle className="flex items-center gap-g8">{title}</DialogTitle>
      <Button type="button" variant="ghost" size="icon-md" onClick={onClose} aria-label={t('common.close', 'Close')}><X className="h-g16 w-g16" aria-hidden="true" /></Button>
    </CardHeader>
  );
};

/** Personal theme and UI language, stored for this identity in this browser only (PRD §6.7). */
export const PreferencesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const themeLabelId = useId();
  return (
    <ModalFrame size="md" onClose={onClose} >
      <Header title={t('tb.preferences', 'Preferences')} onClose={onClose} />
      <div className="flex flex-col gap-g21 overflow-y-auto p-g21">
        <Field>
          <FieldLabel id={themeLabelId}>{t('tb.theme', 'Theme')}</FieldLabel>
          <SegmentGroup aria-labelledby={themeLabelId} value={theme} onValueChange={details => details.value && setTheme(details.value as 'light' | 'dark')} className="w-full">
            <SegmentGroupIndicator />
            <SegmentGroupItems items={([['light', t('tb.theme_light', 'Light'), Sun], ['dark', t('tb.theme_dark', 'Dark'), Moon]] as const).map(([value, label, Icon]) => ({
              value, label: <span className="inline-flex items-center gap-g8"><Icon className="size-g16" aria-hidden="true" />{label}</span>,
            }))} />
          </SegmentGroup>
        </Field>
        <RadioGroup value={language} onValueChange={details => details.value && setLanguage(details.value as typeof language)}>
          <RadioGroupLabel>{t('tb.ui_language', 'Interface language')}</RadioGroupLabel>
          {LANGUAGE_OPTIONS.map((option) => (
            <RadioGroupItem key={option.code} value={option.code} lang={option.htmlLang} className="rounded-lg border border-border p-g13 data-[state=checked]:border-primary data-[state=checked]:bg-accent">
              <RadioGroupItemControl />
              <RadioGroupItemText className="font-semibold">{option.nativeName}</RadioGroupItemText>
              <RadioGroupItemHiddenInput />
            </RadioGroupItem>
          ))}
        </RadioGroup>
        <Text size="xs" tone="muted">{t('tb.preferences_local', 'These preferences apply to your account in this browser only.')}</Text>
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
  // FileUpload keeps accepted files; remount after each pick so the same file can be chosen again.
  const [photoKey, setPhotoKey] = useState(0);
  const ids = { first: useId(), last: useId(), email: useId(), bio: useId(), current: useId(), next: useId(), confirm: useId() };
  const hasPassword = identity?.signInMethods.includes('password');

  const loadSessions = async () => {
    setSessionsError(false);
    try {
      setSessions((await api.get<{ sessions: typeof sessions }>('/me/sessions', { cache: 'no-store' })).sessions);
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
    await api.delete(`/me/sessions/${encodeURIComponent(id)}`).catch(() => undefined);
    void loadSessions();
  };

  return (
    <ModalFrame size="form" onClose={onClose}>
      <Header title={t('tb.account_profile', 'Account Profile')} onClose={onClose} />
      <div className="min-h-0 overflow-y-auto p-g21 sm:p-g21">
        <Tabs value={tab} onValueChange={details => setTab(details.value)} className="gap-g34">
          <TabsList aria-label={t('tb.account_profile', 'Account Profile')} className="w-full">
            <TabsTrigger value="profile" className="flex-1">{t('tb.profile_tab', 'Profile')}</TabsTrigger>
            <TabsTrigger value="security" className="flex-1">{t('tb.security_tab', 'Security')}</TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
        <form onSubmit={(event) => void saveProfile(event)} aria-label={t('tb.profile_details', 'Profile details')} className="flex flex-col gap-g21">
          <div className="flex items-center gap-g21">
              <Avatar className="size-g89 text-lg">
                {image && <AvatarImage src={image} alt={t('tb.profile_photo', 'Profile photo')} />}
                <AvatarFallback>{[firstName, lastName].map(part => part.trim().charAt(0).toUpperCase()).join('') || (identity?.email || '?').charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 space-y-g8">
                <div className="flex flex-wrap gap-g8">
                <FileUpload key={photoKey} accept="image/jpeg,image/gif,image/png" maxFiles={1} disabled={profileState.kind === 'saving'}
                  onFileAccept={details => { selectImage(details.files[0]); setPhotoKey(k => k + 1); }} className="w-auto">
                  <FileUploadTrigger asChild><Button type="button" variant="outline">{t('tb.upload_photo', 'Upload photo')}</Button></FileUploadTrigger>
                  <FileUploadHiddenInput aria-label={t('tb.upload_photo', 'Upload photo')} />
                </FileUpload>
                {image && (
                  <Button type="button" variant="ghost" disabled={profileState.kind === 'saving'} onClick={() => { setImage(''); setProfileState({ kind: 'idle' }); }}>
                    <Trash2 className="h-g16 w-g16" aria-hidden="true" />{t('tb.remove_photo', 'Remove')}
                  </Button>
                )}
                </div>
                <Text size="xs" tone="muted">{t('tb.profile_photo_hint', 'JPG, GIF or PNG. Max 800 KB.')}</Text>
              </div>
          </div>
          <div className="grid gap-g21 sm:grid-cols-2">
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
          <div className="flex flex-wrap items-center gap-g13">
            <Button type="submit" className="w-full" disabled={!firstName.trim() || profileState.kind === 'saving'}>
              {profileState.kind === 'saving' && <Spinner size="sm" decorative />}{t('tb.save_profile', 'Save profile')}
            </Button>
            <span aria-live="polite">{profileState.kind === 'saved' && <span className="flex items-center gap-g8 text-sm text-status-success"><CheckCircle2 className="h-g16 w-g16" aria-hidden="true" />{t('tb.profile_saved', 'Profile updated.')}</span>}</span>
            {profileState.kind === 'error' && <Text as="span" size="sm" tone="destructive" className="flex items-center gap-g8" role="alert"><AlertCircle className="h-g16 w-g16" aria-hidden="true" />{profileState.message}</Text>}
          </div>
        </form>
          </TabsContent>
          <TabsContent value="security" className="space-y-g21">
        {hasPassword ? (
          <form onSubmit={(event) => void changePassword(event)} aria-label={t('tb.change_password', 'Change password')} className="flex flex-col gap-g34">
            <div className="grid gap-g21">
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
                {confirm.length > 0 && confirm !== next && <Text size="xs" tone="destructive" className="mt-g5" id={`${ids.confirm}-error`}>{t('tb.password_mismatch', 'Passwords do not match.')}</Text>}
              </Field>
            </div>
            <div className="mt-g13 flex flex-wrap items-center gap-g13">
              <Button type="submit" className="w-full" disabled={!current || next.length < 8 || next !== confirm || state.kind === 'saving'}>
                {state.kind === 'saving' && <Spinner size="sm" decorative />}{t('tb.update_password', 'Update Password')}
              </Button>
              <span aria-live="polite">{state.kind === 'saved' && <span className="flex items-center gap-g8 text-sm text-status-success"><CheckCircle2 className="h-g16 w-g16" aria-hidden="true" />{t('tb.password_changed', 'Password changed.')}</span>}</span>
              {state.kind === 'error' && <Text as="span" size="sm" tone="destructive" className="flex items-center gap-g8" role="alert"><AlertCircle className="h-g16 w-g16" aria-hidden="true" />{state.message}</Text>}
            </div>
          </form>
        ) : (
          <Text size="sm">{t('tb.no_password', 'This account signs in with an identity provider and has no password to change here.')}</Text>
        )}
        <Collapsible className="rounded-lg border border-border p-g13">
          <CollapsibleTrigger className="w-full justify-between gap-g13 text-sm font-medium">{t('tb.your_sessions', 'Your sessions')}<CollapsibleIndicator /></CollapsibleTrigger>
          <CollapsibleContent>
          <Text size="xs" tone="muted" className="my-g13">
            {t('tb.sign_in_method', 'Sign-in method')}: {(identity?.signInMethods || []).map(m => m === 'password' ? t('tb.method_password', 'Email and password') : m === 'google' ? 'Google' : m).join(', ') || '—'}
          </Text>
          {sessionsError && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('tb.sessions_load_error', 'Sessions could not be loaded.')}</AlertDescription></AlertContent></Alert>}
          <List marker="none" className="divide-y divide-border rounded-xl border border-border">
            {(sessions || []).map((s) => (
              <ListItem key={s.id} className="flex min-h-g42 items-center justify-between gap-g13 px-g13 py-g8 text-sm">
                <span className="flex min-w-0 items-center gap-g8">
                  <Monitor className="h-g16 w-g16 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{s.userAgent || t('tb.unknown_device', 'Unknown device')}</span>
                    <Text as="span" size="xs" tone="muted" className="block">{new Date(s.updatedAt || s.createdAt).toLocaleString()}{s.current ? ` · ${t('tb.this_session', 'This session')}` : ''}</Text>
                  </span>
                </span>
                {!s.current && <Button type="button" variant="ghost" size="sm" onClick={() => void revoke(s.id)}><LogOut className="h-g16 w-g16" aria-hidden="true" />{t('tb.sign_out_session', 'Sign out')}</Button>}
              </ListItem>
            ))}
          </List>
          </CollapsibleContent>
        </Collapsible>
          </TabsContent>
        </Tabs>
      </div>
    </ModalFrame>
  );
};
