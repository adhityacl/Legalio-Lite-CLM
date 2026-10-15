import React, { useCallback, useEffect, useId, useState } from 'react';
import { ChevronDown, FileJson, RotateCcw, Upload } from 'lucide-react';
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

import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { Dialog, DialogBackdrop, DialogBody, DialogCloseIcon, DialogCloseTrigger, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogPositioner, DialogTitle, DialogTrigger } from '@legalio/ui-components/dialog';
import { FileUpload, FileUploadDropzone, FileUploadHiddenInput, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
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
export const GoogleCredentialsForm: React.FC = () => {
  const { t } = useLanguage();
  const confirmDialog = useConfirm();
  const showAlert = useAlertToast();
  const idPrefix = useId();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [busy, setBusy] = useState<GoogleCredentialKind | null>(null);
  const [errors, setErrors] = useState<Partial<Record<GoogleCredentialKind, string>>>({});
  // Remounting the upload clears zag's accepted files so the same file can be picked again.
  const [uploadKey, setUploadKey] = useState(0);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    requestStatus('')
      .then((data) => setState({ status: 'ready', data }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, []);

  useEffect(load, [load]);

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
    setUploadKey((key) => key + 1);
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
      setUploadKey((key) => key + 1);
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
      <Card size="sm" key={kind} aria-labelledby={`${inputId}-title`} aria-busy={busy === kind}>
        <CardHeader>
          <div className="col-span-full flex min-w-0 items-start gap-g8">
            <span className="flex size-g34 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileJson className="size-g16" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 space-y-g3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-g8 gap-y-g3">
                <CardTitle id={`${inputId}-title`} className="text-base">
                  {isSa ? t('google_setup.sa_title', '1. Service Account (JSON)') : t('google_setup.oauth_title', '2. OAuth Client (JSON)')}
                </CardTitle>
                <Badge className="shrink-0 whitespace-nowrap" tone={info.source ? 'success' : 'warning'}>
                  {info.source === 'upload'
                    ? t('google_setup.source_upload', 'File terunggah')
                    : info.source === 'env'
                      ? t('google_setup.source_env', 'Dari environment')
                      : t('google_setup.source_none', 'Belum dikonfigurasi')}
                </Badge>
              </div>
              <CardDescription>
                {isSa
                  ? t('google_setup.sa_purpose', 'Akses Google Drive dan Sheets untuk aplikasi.')
                  : t('google_setup.oauth_purpose', 'Hubungkan akun Google pengguna melalui OAuth.')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-g8 pt-g8">
          <details className="group/help text-sm">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-g8 rounded-md text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              {t('google_setup.download_help', 'Cara mendapatkan file JSON')}
              <ChevronDown className="size-g16 shrink-0 transition-transform group-open/help:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </summary>
            <p className="pb-g5 leading-relaxed">
              {isSa
                ? t('google_setup.sa_help', 'Google Cloud Console → IAM & Admin → Service Accounts → pilih akun → Keys → Add key → JSON. Dipakai untuk Google Drive & Sheets.')
                : t('google_setup.oauth_help', 'Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Download JSON. Dipakai untuk menghubungkan akun Google pengguna.')}
            </p>
          </details>
          {(info.source || info.updated_at) && (
            <dl className="grid gap-g8 rounded-md border border-border bg-muted/30 p-g8 text-xs sm:grid-cols-2">
              {info.source && (
                <div className="min-w-0 space-y-g3 sm:col-span-2">
                  <dt>{isSa ? t('google_setup.account_email', 'Email akun') : t('google_setup.client_id', 'Client ID')}</dt>
                  <dd className="font-mono leading-relaxed text-foreground wrap-anywhere">{isSa ? data.serviceAccount.client_email : data.oauthClient.client_id}</dd>
                </div>
              )}
              {info.project_id && (
                <div className="min-w-0 space-y-g3">
                  <dt>{t('google_setup.project_id', 'Project ID')}</dt>
                  <dd className="font-mono text-foreground wrap-anywhere">{info.project_id}</dd>
                </div>
              )}
              {info.updated_at && (
                <div className="space-y-g3">
                  <dt>{t('google_setup.updated_at', 'Terakhir diperbarui')}</dt>
                  <dd className="text-foreground"><RelativeTime iso={info.updated_at} /></dd>
                </div>
              )}
            </dl>
          )}
          {isSa && info.source && (
            <Text size="xs" tone="muted" className="leading-relaxed">{t('google_setup.sa_share_hint', 'Bagikan folder Drive dan spreadsheet ke email service account di atas sebagai Editor.')}</Text>
          )}
          {originMissing && (
            <Alert status="warning" role="status">
              <AlertIndicator />
              <AlertContent><AlertDescription>{t(
                'google_setup.origin_missing',
                'Origin aplikasi ini ({origin}) belum ada di "Authorized JavaScript origins" OAuth client (terdaftar: {list}). Tambahkan di Google Cloud Console, lalu unduh & unggah ulang file ini.',
                { origin, list: data.oauthClient.javascript_origins.join(', ') || '—' },
              )}</AlertDescription></AlertContent>
            </Alert>
          )}

          <div className="space-y-g5">
            <FileUpload className="gap-g5" key={uploadKey} ids={{ hiddenInput: inputId }} accept=".json,application/json" maxFiles={1} maxFileSize={MAX_FILE_BYTES} disabled={busy !== null}
              onFileAccept={details => upload(kind, details.files[0])}
              onFileReject={details => upload(kind, details.files[0]?.file)}>
              <FileUploadDropzone aria-label={t('google_setup.drop_hint', 'atau seret file ke kotak ini')} className="min-h-g68 gap-g8 bg-muted/30 p-g8 sm:grid-cols-[auto_minmax(0,1fr)] sm:text-start">
                <FileUploadTrigger asChild>
                  <Button size="sm" className="min-h-11 max-sm:w-full" loading={busy === kind}>
                    <Upload className="size-g16" aria-hidden="true" />
                    {busy === kind
                      ? t('common.saving', 'Menyimpan…')
                      : info.source === 'upload'
                        ? t('google_setup.replace', 'Ganti file')
                        : t('google_setup.choose', 'Pilih file JSON')}
                  </Button>
                </FileUploadTrigger>
                <span className="min-w-0">
                  <Text as="span" size="xs" tone="muted" className="block">{t('google_setup.drop_hint', 'atau seret file ke kotak ini')}</Text>
                  <Text as="span" size="xs" tone="muted" className="block">{t('google_setup.file_hint', 'File JSON · Maks. 100 KB')}</Text>
                </span>
              </FileUploadDropzone>
              <FileUploadHiddenInput aria-labelledby={`${inputId}-title`} aria-describedby={errors[kind] ? errorId : undefined} />
            </FileUpload>
            {info.source === 'upload' && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => remove(kind)} disabled={busy !== null} className="min-h-11 text-destructive"
                  aria-label={t('google_setup.reset', 'Reset file yang diunggah')}>
                  <RotateCcw className="size-g16" aria-hidden="true" />
                  {t('common.reset', 'Reset')}
                </Button>
              </div>
            )}
          </div>
          {errors[kind] && (
            <Alert status="error" id={errorId} role="alert"><AlertIndicator /><AlertContent><AlertDescription>{errors[kind]}</AlertDescription></AlertContent></Alert>
          )}
        </CardBody>
      </Card>
    );
  };

  return (
    <div className="@container">
      <div className="grid items-start gap-g13 @4xl:grid-cols-2">
        {state.status === 'loading' && (
          <div role="status" className="col-span-full grid gap-g13 @4xl:grid-cols-2">
            <span className="sr-only">{t('common.loading', 'Memuat…')}</span>
            <Skeleton height={144} /><Skeleton height={144} />
          </div>
        )}
        {state.status === 'error' && (
          <Alert status="error" role="alert" className="col-span-full">
            <AlertIndicator />
            <AlertContent><AlertDescription>{state.message}</AlertDescription></AlertContent>
            <AlertActions><Button variant="outline" size="sm" onClick={load}>{t('common.retry', 'Coba lagi')}</Button></AlertActions>
          </Alert>
        )}
        {state.status === 'ready' && (
          <>
            {renderSlot('service-account', state.data)}
            {renderSlot('oauth-client', state.data)}
          </>
        )}
      </div>
    </div>
  );
};

export const GoogleCredentialsDialog: React.FC<GoogleCredentialsDialogProps> = ({ trigger, onClose }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(details) => {
        setOpen(details.open);
        if (!details.open) onClose?.();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogBackdrop />
      <DialogPositioner>
        <DialogContent className="flex w-full max-w-g610 flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-g13 py-g13 sm:px-g21">
            <DialogTitle className="pe-g42">{t('google_setup.title', 'Hubungkan Google')}</DialogTitle>
            <DialogCloseIcon className="max-sm:top-g8 max-sm:end-g8 max-sm:size-11" aria-label={t('common.close', 'Tutup')} />
            <DialogDescription className="text-sm leading-relaxed">
              {t('google_setup.description', 'Unggah dua file JSON yang diekspor dari Google Cloud Console. File disimpan di server, menggantikan variabel GOOGLE_* di .env, dan isinya yang rahasia tidak pernah ditampilkan lagi.')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-0 grid min-h-0 gap-g13 overflow-y-auto overscroll-contain p-g13 sm:p-g21">
            {open && <GoogleCredentialsForm />}
          </DialogBody>
          <DialogFooter className="mt-0 shrink-0 border-t border-border px-g13 py-g13 sm:px-g21">
            <DialogCloseTrigger asChild><Button className="max-sm:min-h-11 max-sm:w-full">{t('google_setup.done', 'Selesai')}</Button></DialogCloseTrigger>
          </DialogFooter>
        </DialogContent>
      </DialogPositioner>
    </Dialog>
  );
};
