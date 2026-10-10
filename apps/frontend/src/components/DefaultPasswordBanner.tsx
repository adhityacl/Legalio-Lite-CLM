import React, { useEffect, useId, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { PasswordInput, PasswordInputControl, PasswordInputIndicator, PasswordInputInput, PasswordInputLabel, PasswordInputVisibilityTrigger } from '@legalio/ui-components/password-input';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator, AlertTitle } from '@legalio/ui-components/alert';
import { Collapsible, CollapsibleBody, CollapsibleContent, CollapsibleIndicator, CollapsibleTrigger } from '@legalio/ui-components/collapsible';
import {
  Dialog, DialogBackdrop, DialogBody, DialogCloseIcon, DialogCloseTrigger, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogPositioner, DialogTitle, DialogTrigger,
} from '@legalio/ui-components/dialog';
import { GoogleCredentialsDialog } from './settings/GoogleCredentialsDialog';
interface DefaultPasswordBannerProps {
  /** Opens the user administration screen, for changing other accounts. */
  onOpenSecurity: () => void;
  /**
   * Whether the Google setup reminder belongs on the current page. It is a
   * one-time setup task, so it only shows where it is acted on (dashboard and
   * settings) instead of costing vertical space on every list. The default
   * password warning ignores this and always shows.
   */
  showGoogleSetup?: boolean;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

const MIN_PASSWORD_LENGTH = 8;

/**
 * First-run guidance for a superuser: shown while the Google credential files
 * aren't uploaded yet, or while an install upgraded from an older release still
 * uses the old shipped admin password. Hidden for everyone else.
 */
export const DefaultPasswordBanner: React.FC<DefaultPasswordBannerProps> = ({ onOpenSecurity, showGoogleSetup = true }) => {
  const { t } = useLanguage();
  const [passwordActive, setPasswordActive] = useState(false);
  const [googleIncomplete, setGoogleIncomplete] = useState(false);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const currentId = useId();
  const nextId = useId();
  const confirmId = useId();
  const errorId = useId();

  const refresh = () =>
    fetch('/api/system/status', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setPasswordActive(Boolean(data?.defaultAdminPasswordActive));
        setGoogleIncomplete(Boolean(data?.googleSetupIncomplete));
      })
      .catch(() => undefined);

  useEffect(() => {
    refresh();
  }, []);

  if (!passwordActive && !(googleIncomplete && showGoogleSetup)) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) {
      setState({ kind: 'error', message: t('security.password_too_short', `Use at least ${MIN_PASSWORD_LENGTH} characters.`) });
      return;
    }
    if (next !== confirm) {
      setState({ kind: 'error', message: t('security.password_mismatch', 'The new passwords do not match.') });
      return;
    }
    setState({ kind: 'saving' });
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next, revokeOtherSessions: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || t('security.password_change_failed', 'The password could not be changed. Check the current password.'));
      }
      setState({ kind: 'done' });
      setPasswordActive(false);
      setOpen(false);
    } catch (err: any) {
      setState({ kind: 'error', message: err?.message || String(err) });
    }
  };

  const hasError = state.kind === 'error';

  return (
    <Alert status="warning" role={passwordActive ? 'alert' : 'status'} className="mb-4">
      <AlertIndicator />
      <AlertContent>
        {passwordActive ? (
          <AlertDescription>
            {t('security.default_password_warning', 'You are signed in with the default administrator password. Change it before using this workspace with real data.')}
          </AlertDescription>
        ) : (
          <Collapsible>
            <CollapsibleTrigger className="font-semibold">
              {t('google_setup.summary', 'Penyiapan Google')}
              <CollapsibleIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CollapsibleBody>
                <AlertDescription>
                  {t('google_setup.finish_setup', 'Finish setup: upload your Google Service Account and OAuth Client JSON files to enable Drive, Sheets and Google sign-in.')}
                </AlertDescription>
              </CollapsibleBody>
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertContent>
      <AlertActions>
        {passwordActive && (
          <Dialog open={open} onOpenChange={details => { setOpen(details.open); if (!details.open) setState({ kind: 'idle' }); }}>
            <DialogTrigger asChild>
              <Button size="sm">{t('security.change_password', 'Change password')}</Button>
            </DialogTrigger>
            <DialogBackdrop />
            <DialogPositioner>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('security.change_password', 'Change password')}</DialogTitle>
                  <DialogCloseIcon aria-label={t('common.close', 'Close')} />
                  <DialogDescription>{t('security.change_password_desc', 'Other sessions will be signed out after the change.')}</DialogDescription>
                </DialogHeader>
                <form onSubmit={submit} noValidate aria-busy={state.kind === 'saving'}>
                  <DialogBody className="grid gap-4">
                    {[
                      { id: currentId, label: t('security.current_password', 'Current password'), value: current, set: setCurrent, auto: 'current-password' as const },
                      { id: nextId, label: t('security.new_password', 'New password'), value: next, set: setNext, auto: 'new-password' as const },
                      { id: confirmId, label: t('security.confirm_password', 'Confirm new password'), value: confirm, set: setConfirm, auto: 'new-password' as const },
                    ].map(field => (
                      <PasswordInput key={field.id} ids={{ input: field.id }} autoComplete={field.auto} invalid={hasError}>
                        <PasswordInputLabel>{field.label}</PasswordInputLabel>
                        <PasswordInputControl>
                          <PasswordInputInput required value={field.value} onChange={e => field.set(e.target.value)} aria-describedby={hasError ? errorId : undefined} />
                          <PasswordInputVisibilityTrigger><PasswordInputIndicator /></PasswordInputVisibilityTrigger>
                        </PasswordInputControl>
                      </PasswordInput>
                    ))}
                    {hasError && (
                      <Alert status="error" id={errorId} role="alert">
                        <AlertIndicator />
                        <AlertContent><AlertDescription>{state.message}</AlertDescription></AlertContent>
                      </Alert>
                    )}
                  </DialogBody>
                  <DialogFooter>
                    <DialogCloseTrigger asChild>
                      <Button variant="outline">{t('common.cancel', 'Cancel')}</Button>
                    </DialogCloseTrigger>
                    <Button type="submit" loading={state.kind === 'saving'}>
                      {state.kind === 'saving' ? t('common.saving', 'Saving…') : t('security.save_password', 'Save password')}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </DialogPositioner>
          </Dialog>
        )}
        {passwordActive && <Button size="sm" variant="outline" onClick={onOpenSecurity}>{t('security.manage_users', 'Manage users')}</Button>}
        {googleIncomplete && showGoogleSetup && (
          <GoogleCredentialsDialog onClose={refresh} trigger={<Button size="sm">{t('google_setup.button', 'Hubungkan Google')}</Button>} />
        )}
      </AlertActions>
    </Alert>
  );
};
