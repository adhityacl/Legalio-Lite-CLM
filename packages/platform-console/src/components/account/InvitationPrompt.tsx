import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useIdentity } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTenant } from '../../context/TenantContext';
import { ModalFrame, ModalTitle } from '../ui/modal-frame';
import { Button } from '@legalio/ui-components/button';

const KEY = 'pendingInvitation';

/** Captures `?accept_invite=<token>` once and keeps it through sign-in (sessionStorage, this tab only). */
export function capturePendingInvitation(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('accept_invite');
    if (token && /^[A-Za-z0-9_-]{8,128}$/.test(token)) {
      sessionStorage.setItem(KEY, token);
      params.delete('accept_invite');
      params.delete('email');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const clearPendingInvitation = () => {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};

export interface InvitationPreview { organizationName: string; tenantRole: string; expiresAt: string; status: string }

export async function loadInvitationPreview(token: string): Promise<InvitationPreview | null> {
  const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/preview`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
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
    const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState({ kind: 'error', code: data?.error || 'ERROR', message: data?.message || t('tb.invitation_accept_failed', 'The invitation could not be accepted.') });
      return;
    }
    clearPendingInvitation();
    setState({ kind: 'done' });
    await refreshUser();
    await refreshTenants();
    if (data?.organizationId) await switchTenant(data.organizationId);
  };

  return (
    <ModalFrame onClose={close} className="max-w-md">
      <div className="ds-section-header">
        <ModalTitle className="ds-modal-title flex items-center gap-2">{t('tb.invitation_title', 'Organization invitation')}</ModalTitle>
        <Button type="button" variant="ghost" size="icon" onClick={close} aria-label={t('common.close', 'Close')}><X className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      <div className="flex flex-col gap-4 p-5 text-sm">
        <p className="text-ink">
          {t('tb.invitation_body', 'You are invited to join {org} as {role}.', { org: preview.organizationName, role: preview.tenantRole })}
        </p>
        {preview.status !== 'pending' && <p role="alert" className="ds-alert ds-status-danger border">{t('tb.invitation_not_pending', 'This invitation can no longer be accepted.')}</p>}
        {state.kind === 'done' && <p role="status" className="flex items-center gap-2 text-status-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('tb.invitation_accepted', 'You joined the organization.')}</p>}
        {state.kind === 'error' && (
          <p role="alert" className="flex items-start gap-2 text-status-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {state.code === 'INVITATION_IDENTITY_MISMATCH'
                ? t('tb.invitation_other_account', 'This invitation was sent to a different account. Sign in with the invited email address.')
                : state.message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {state.kind === 'done' ? (
            <Button type="button" size="lg" onClick={close}>{t('tb.done', 'Done')}</Button>
          ) : (
            <>
              <Button type="button" size="lg" variant="outline" onClick={close}>{t('tb.not_now', 'Not now')}</Button>
              <Button type="button" size="lg" onClick={accept} disabled={preview.status !== 'pending' || state.kind === 'busy'}>
                {state.kind === 'busy' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{t('tb.accept_invitation', 'Accept invitation')}
              </Button>
            </>
          )}
        </div>
      </div>
    </ModalFrame>
  );
};
