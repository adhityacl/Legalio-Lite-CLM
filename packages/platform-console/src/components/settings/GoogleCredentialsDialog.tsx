import React, { useId, useState } from 'react';
import { Dialog } from 'radix-ui';
import { AlertTriangle, CheckCircle2, FileJson, RotateCcw, Upload, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { Button } from '@legalio/ui-components/button';
import { RelativeTime } from '../documents/RelativeTime';
import {
  parseOAuthClientFile,
  parseServiceAccountFile,
  type GoogleCredentialKind,
  type GoogleCredentialStatus,
  type ParseErrorCode,
} from '@legalio/shared/googleCredentialFiles';

import { Alert, AlertContent } from '@legalio/ui-components/alert';
interface GoogleCredentialsDialogProps {
  /** Element that opens the dialog (rendered through Dialog.Trigger asChild). */
  trigger: React.ReactElement;
  /** Called after the dialog closes, e.g. to re-check whether setup is complete. */
  onClose?: () => void;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: GoogleCredentialStatus };

const API = '/api/integrations/google/credentials';
const MAX_FILE_BYTES = 100 * 1024;

async function requestStatus(path: string, init?: RequestInit): Promise<GoogleCredentialStatus> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || body.error || `HTTP ${res.status}`), { code: body.error });
  return body as GoogleCredentialStatus;
}

/**
 * Superuser setup for the two JSON files exported from Google Cloud Console. Uploaded files are
 * stored server-side and replace the GOOGLE_* variables in .env.
 */
export const GoogleCredentialsDialog: React.FC<GoogleCredentialsDialogProps> = ({ trigger, onClose }) => {
  const { t } = useLanguage();
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [busy, setBusy] = useState<GoogleCredentialKind | null>(null);
  const [errors, setErrors] = useState<Partial<Record<GoogleCredentialKind, string>>>({});
  const [dragOver, setDragOver] = useState<GoogleCredentialKind | null>(null);

  const load = () => {
    setState({ status: 'loading' });
    requestStatus('')
      .then((data) => setState({ status: 'ready', data }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  };

  const errorText = (code: ParseErrorCode | 'invalid_private_key' | 'too_large') =>
    ({
      invalid_json: t('google_setup.error.invalid_json', 'File ini bukan JSON yang valid.'),
      looks_like_oauth_client: t('google_setup.error.looks_like_oauth_client', 'Ini file OAuth client — unggah di slot nomor 2.'),
      looks_like_service_account: t('google_setup.error.looks_like_service_account', 'Ini file service account — unggah di slot nomor 1.'),
      not_service_account: t('google_setup.error.not_service_account', 'Bukan key service account (harus berisi "type": "service_account").'),
      not_oauth_client: t('google_setup.error.not_oauth_client', 'Bukan file OAuth client (harus berisi bagian "web" atau "installed").'),
      missing_fields: t('google_setup.error.missing_fields', 'File tidak lengkap — unduh ulang dari Google Cloud Console.'),
      invalid_client_id: t('google_setup.error.invalid_client_id', 'client_id tidak berformat OAuth client Google.'),
      invalid_private_key: t('google_setup.error.invalid_private_key', 'private_key di file ini tidak bisa dibaca.'),
      too_large: t('google_setup.error.too_large', 'File terlalu besar untuk file kredensial Google.'),
    })[code];

  const setError = (kind: GoogleCredentialKind, message?: string) => setErrors((prev) => ({ ...prev, [kind]: message }));

  const upload = async (kind: GoogleCredentialKind, file: File | undefined) => {
    if (!file) return;
    setError(kind, undefined);
    if (file.size > MAX_FILE_BYTES) return setError(kind, errorText('too_large'));
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return setError(kind, errorText('invalid_json'));
    }
    const parsed = kind === 'service-account' ? parseServiceAccountFile(json) : parseOAuthClientFile(json);
    if (parsed.ok === false) return setError(kind, errorText(parsed.code));
    setBusy(kind);
    try {
      const data = await requestStatus(`/${kind}`, { method: 'PUT', body: JSON.stringify({ file: json }) });
      setState({ status: 'ready', data });
      showAlert({ title: t('google_setup.saved', 'Kredensial Google tersimpan'), variant: 'success' });
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(kind, code === 'invalid_private_key' ? errorText(code) : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: GoogleCredentialKind) => {
    const ok = await confirmDialog({
      description: t('google_setup.remove_confirm', 'Hapus file yang diunggah? Aplikasi kembali memakai nilai di .env (jika ada).'),
      tone: 'danger',
      confirmLabel: t('documents.action.delete', 'Hapus'),
    });
    if (!ok) return;
    setBusy(kind);
    try {
      setState({ status: 'ready', data: await requestStatus(`/${kind}`, { method: 'DELETE' }) });
    } catch (err) {
      setError(kind, (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const renderSlot = (kind: GoogleCredentialKind, data: GoogleCredentialStatus) => {
    const isSa = kind === 'service-account';
    const info = isSa ? data.serviceAccount : data.oauthClient;
    const inputId = `${idPrefix}-${kind}`;
    const errorId = `${inputId}-error`;
    const origin = window.location.origin;
    const originMissing =
      !isSa && data.oauthClient.source === 'upload' && !data.oauthClient.javascript_origins.includes(origin);

    return (
      <section
        key={kind}
        aria-labelledby={`${inputId}-title`}
        aria-busy={busy === kind}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(kind);
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(null);
          upload(kind, e.dataTransfer.files[0]);
        }}
        className={`ds-upload space-y-2 ${
 dragOver === kind ? 'border-status-success-border bg-status-success-soft ' : 'border-border '
 }`}
      >
        <h3 id={`${inputId}-title`} className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileJson className="w-4 h-4 text-muted-foreground" aria-hidden />
          {isSa ? t('google_setup.sa_title', '1. Service Account (JSON)') : t('google_setup.oauth_title', '2. OAuth Client (JSON)')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {isSa
            ? t('google_setup.sa_help', 'Google Cloud Console → IAM & Admin → Service Accounts → pilih akun → Keys → Add key → JSON. Dipakai untuk Google Drive & Sheets.')
            : t('google_setup.oauth_help', 'Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Download JSON. Dipakai untuk menghubungkan akun Google pengguna.')}
        </p>

        <p className="text-xs flex items-start gap-1.5 text-foreground">
          {info.source ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-status-success" aria-hidden />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-status-warning" aria-hidden />
          )}
          <span>
            {info.source === 'upload'
              ? t('google_setup.source_upload', 'Terpasang dari file unggahan')
              : info.source === 'env'
                ? t('google_setup.source_env', 'Memakai nilai dari .env')
                : t('google_setup.source_none', 'Belum dikonfigurasi')}
            {info.source && (
              <>
                {' · '}
                <span className="font-mono break-all">{isSa ? data.serviceAccount.client_email : data.oauthClient.client_id}</span>
                {info.project_id && ` · ${info.project_id}`}
              </>
            )}
            {info.updated_at && (
              <>
                {' · '}
                <RelativeTime iso={info.updated_at} />
              </>
            )}
          </span>
        </p>

        {isSa && info.source && (
          <p className="text-xs text-muted-foreground">
            {t('google_setup.sa_share_hint', 'Bagikan folder Drive dan spreadsheet ke email service account di atas sebagai Editor.')}
          </p>
        )}
        {originMissing && (
          <Alert status="warning" role="status">
            <AlertContent>{t(
              'google_setup.origin_missing',
              'Origin aplikasi ini ({origin}) belum ada di "Authorized JavaScript origins" OAuth client (terdaftar: {list}). Tambahkan di Google Cloud Console, lalu unduh & unggah ulang file ini.',
              { origin, list: data.oauthClient.javascript_origins.join(', ') || '—' },
            )}</AlertContent>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            id={inputId}
            type="file"
            accept=".json,application/json"
            className="peer sr-only"
            disabled={busy !== null}
            aria-describedby={errors[kind] ? errorId : undefined}
            onChange={(e) => {
              upload(kind, e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <label
            htmlFor={inputId}
            className="inline-flex items-center gap-1.5 px-3 min-h-10 rounded-md bg-primary hover:bg-[#05a847] text-white text-xs font-bold cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden />
            {busy === kind
              ? t('common.saving', 'Menyimpan…')
              : info.source === 'upload'
                ? t('google_setup.replace', 'Ganti file')
                : t('google_setup.choose', 'Pilih file JSON')}
          </label>
          <span className="text-xs text-muted-foreground">{t('google_setup.drop_hint', 'atau seret file ke kotak ini')}</span>
          {info.source === 'upload' && (
            <Button variant="ghost" size="icon-md"
              type="button"
              onClick={() => remove(kind)}
              disabled={busy !== null}
              aria-label={t('google_setup.reset', 'Reset file yang diunggah')}
              title={t('google_setup.reset', 'Reset file yang diunggah')}
              className="ml-auto text-destructive"
            >
              <RotateCcw className="w-4 h-4" aria-hidden />
            </Button>
          )}
        </div>
        {errors[kind] && (
          <Alert status="error" id={errorId} role="alert">
            <AlertContent>{errors[kind]}</AlertContent>
          </Alert>
        )}
      </section>
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setErrors({});
        if (value) load();
        else onClose?.();
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-1000 bg-foreground/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-1000 w-[calc(100%-2rem)] max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-6 shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-4">
            <Dialog.Title className="flex items-center gap-2">
              {t('google_setup.title', 'Hubungkan Google')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="secondary" size="icon-md"
                type="button"
                aria-label={t('common.close', 'Tutup')}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mb-4 text-sm text-muted-foreground">
            {t(
              'google_setup.description',
              'Unggah dua file JSON yang diekspor dari Google Cloud Console. File disimpan di server, menggantikan variabel GOOGLE_* di .env, dan isinya yang rahasia tidak pernah ditampilkan lagi.',
            )}
          </Dialog.Description>

          {state.status === 'loading' && (
            <div role="status" className="space-y-3">
              <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
              {[0, 1].map((i) => (
                <div key={i} className="h-36 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" />
              ))}
            </div>
          )}
          {state.status === 'error' && (
            <Alert status="error" role="alert">
              <AlertContent><p>{state.message}</p>
              <Button type="button" variant="outline" onClick={load}>
                {t('common.retry', 'Coba lagi')}
              </Button></AlertContent>
            </Alert>
          )}
          {state.status === 'ready' && (
            <div className="space-y-3">
              {renderSlot('service-account', state.data)}
              {renderSlot('oauth-client', state.data)}
            </div>
          )}

          <div className="flex justify-end pt-4">
            <Dialog.Close asChild>
              <Button type="button">
                {t('google_setup.done', 'Selesai')}
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
