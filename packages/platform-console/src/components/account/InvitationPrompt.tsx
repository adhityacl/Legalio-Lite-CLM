import { api, errorMessage, isApiError } from '@legalio/shared/apiClient';
import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useIdentity } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { ModalFrame } from '../ui/modal-frame';
import { Button } from '@legalio/ui-components/button';

import { DialogHeader, DialogTitle, DialogCloseIcon } from '@legalio/ui-components/dialog';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Spinner } from '@legalio/ui-components/spinner';
import { Text } from '@legalio/ui-components/text';
const KEY = 'pendingInvitation';

/** Keep invitation links through sign-in, including malformed tokens so preview can explain the error. */
export function capturePendingInvitation(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('accept_invite');
    if (token && token.length <= 512) {
      try { sessionStorage.setItem(KEY, token); } catch { return token; }
      params.delete('accept_invite');
      params.delete('email');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
      return token;
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const clearPendingInvitation = () => {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};

export interface InvitationPreview { organizationName: string; email: string | null; tenantRole: string; expiresAt: string; status: string }

export async function loadInvitationPreview(token: string): Promise<InvitationPreview | null> {
  try {
    return await api.get<InvitationPreview>(`/invitations/${encodeURIComponent(token)}/preview`, { cache: 'no-store', notifyUnauthorized: false });
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 409)) return null;
    throw new Error('Could not load invitation.');
  }
}

/**
 * Inline invitation acceptance after sign-in (PRD §8.3–§8.4): the approved,
 * matching identity or code holder accepts; nothing
 * is accepted automatically.
 */
export const InvitationPrompt: React.FC = () => {
  const { t } = useLanguage();
  const { identity, refreshUser } = useIdentity();
  const { refreshTenants, switchTenant } = useTenant();
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' } | { kind: 'error'; code: string; message: string }>({ kind: 'idle' });

  useEffect(() => {
    const pending = capturePendingInvitation();
    if (!pending) return;
    setToken(pending);
    loadInvitationPreview(pending).then((p) => {
      if (!p) { clearPendingInvitation(); setToken(null); return; }
      setPreview(p);
    }).catch(() => {});
  }, []);

  if (!token || !preview || !identity) return null;
  const close = () => { clearPendingInvitation(); setToken(null); };

  const accept = async () => {
    setState({ kind: 'busy' });
    let data: { organizationId?: string };
    try {
      data = await api.post<{ organizationId?: string }>(`/invitations/${encodeURIComponent(token)}/accept`);
    } catch (error) {
      const rejected = isApiError(error) && error.status > 0 ? error : null;
      setState({ kind: 'error', code: rejected?.error || 'ERROR', message: rejected ? errorMessage(rejected, t('tb.invitation_accept_failed', 'The invitation could not be accepted.')) : t('tb.invitation_accept_failed', 'The invitation could not be accepted.') });
      return;
    }
    clearPendingInvitation();
    setState({ kind: 'done' });
    await refreshUser();
    await refreshTenants();
    if (data?.organizationId) await switchTenant(data.organizationId);
  };

  return (
    <ModalFrame size="md" onClose={close} >
      <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
        <DialogTitle className="flex items-center gap-g8">{t('tb.invitation_title', 'Organization invitation')}</DialogTitle>
        <DialogCloseIcon aria-label={t('common.close', 'Close')} />
      </DialogHeader>
      <div className="flex flex-col gap-g13 p-g21 text-sm">
        <Text size="sm">
          {t('tb.invitation_body', 'You are invited to join {org} as {role}.', { org: preview.organizationName, role: preview.tenantRole })}
        </Text>
        {preview.status !== 'pending' && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{t('tb.invitation_not_pending', 'This invitation can no longer be accepted.')}</AlertDescription></AlertContent></Alert>}
        {state.kind === 'done' && <Text size="sm" className="flex items-center gap-g8 text-status-success" role="status"><CheckCircle2 className="h-g16 w-g16" aria-hidden="true" />{t('tb.invitation_accepted', 'You joined the organization.')}</Text>}
        {state.kind === 'error' && (
          <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{state.code === 'INVITATION_IDENTITY_MISMATCH'
                ? t('tb.invitation_other_account', 'This invitation was sent to a different account. Sign in with the invited email address.')
                : state.message}</AlertDescription></AlertContent></Alert>
        )}
        <div className="flex flex-wrap justify-end gap-g8">
          {state.kind === 'done' ? (
            <Button type="button" onClick={close}>{t('tb.done', 'Done')}</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close}>{t('tb.not_now', 'Not now')}</Button>
              <Button type="button" onClick={() => void accept()} disabled={preview.status !== 'pending' || state.kind === 'busy'}>
                {state.kind === 'busy' && <Spinner size="sm" decorative />}{t('tb.accept_invitation', 'Accept invitation')}
              </Button>
            </>
          )}
        </div>
      </div>
    </ModalFrame>
  );
};
