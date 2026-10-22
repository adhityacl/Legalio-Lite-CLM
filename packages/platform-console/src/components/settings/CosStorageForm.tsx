import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Input } from '@legalio/ui-components/input';
import { PasswordInput, PasswordInputControl, PasswordInputIndicator, PasswordInputInput, PasswordInputLabel, PasswordInputVisibilityTrigger } from '@legalio/ui-components/password-input';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { RelativeTime } from '../documents/RelativeTime';

type StorageStatus =
  | { configured: false }
  | { configured: true; bucket: string; region: string; prefix: string; secretIdLast4: string; updated_at: string };
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: StorageStatus };

const API = '/api/integrations/storage/cos';
const EMPTY = { secretId: '', secretKey: '', bucket: '', region: '', prefix: '' };

async function request(init?: RequestInit): Promise<StorageStatus> {
  const res = await fetch(API, { ...init, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
  return body as StorageStatus;
}

/** Superuser setup for Tencent COS, where uploads are stored. The server tests the credentials before saving them; the secret key is never shown again. */
export const CosStorageForm: React.FC = () => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setState({ status: 'loading' });
    request()
      .then((data) => setState({ status: 'ready', data }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, []);

  useEffect(load, [load]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setState({ status: 'ready', data: await request({ method: 'PUT', body: JSON.stringify(form) }) });
      setForm(EMPTY);
      showAlert({ title: t('cos_setup.saved', 'File storage saved'), variant: 'success' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') return <div role="status"><span className="sr-only">{t('common.loading', 'Memuat…')}</span><Skeleton height={144} /></div>;
  if (state.status === 'error') {
    return (
      <Alert status="error" role="alert">
        <AlertIndicator />
        <AlertContent><AlertDescription>{state.message}</AlertDescription></AlertContent>
        <AlertActions><Button variant="outline" size="sm" onClick={load}>{t('common.retry', 'Coba lagi')}</Button></AlertActions>
      </Alert>
    );
  }
  const data = state.data;
  return (
    <Card size="sm" aria-labelledby="cos-storage-title" aria-busy={busy}>
      <CardHeader>
        <div className="col-span-full flex min-w-0 items-start gap-g8">
          <span className="flex size-g34 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <HardDrive className="size-g16" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 space-y-g3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-g8 gap-y-g3">
              <CardTitle id="cos-storage-title" className="text-base">{t('cos_setup.title', 'File storage (Tencent COS)')}</CardTitle>
              <Badge className="shrink-0 whitespace-nowrap" tone={data.configured ? 'success' : 'warning'}>
                {data.configured ? t('cos_setup.configured', 'Configured') : t('google_setup.source_none', 'Belum dikonfigurasi')}
              </Badge>
            </div>
            <CardDescription>{t('cos_setup.purpose', 'Uploaded files are stored in this bucket. Saving tests the credentials first.')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-g8 pt-g8">
        {data.configured && (
          <dl className="grid gap-g8 rounded-md border border-border bg-muted/30 p-g8 text-xs sm:grid-cols-2">
            <div className="min-w-0 space-y-g3"><dt>Bucket</dt><dd className="font-mono text-foreground wrap-anywhere">{data.bucket}</dd></div>
            <div className="min-w-0 space-y-g3"><dt>Region</dt><dd className="font-mono text-foreground wrap-anywhere">{data.region}</dd></div>
            <div className="min-w-0 space-y-g3"><dt>{t('cos_setup.prefix', 'Prefix (optional)')}</dt><dd className="font-mono text-foreground wrap-anywhere">{data.prefix || '—'}</dd></div>
            <div className="min-w-0 space-y-g3"><dt>SecretId</dt><dd className="font-mono text-foreground">••••{data.secretIdLast4}</dd></div>
            <div className="space-y-g3"><dt>{t('google_setup.updated_at', 'Terakhir diperbarui')}</dt><dd className="text-foreground"><RelativeTime iso={data.updated_at} /></dd></div>
          </dl>
        )}
        <form className="grid gap-g8 sm:grid-cols-2" onSubmit={save}>
          <Field required>
            <FieldLabel htmlFor="cos-secret-id">SecretId</FieldLabel>
            <Input id="cos-secret-id" required autoComplete="off" spellCheck={false} value={form.secretId} onChange={set('secretId')} />
          </Field>
          <PasswordInput ids={{ input: 'cos-secret-key' }} autoComplete="new-password">
            <PasswordInputLabel>SecretKey</PasswordInputLabel>
            <PasswordInputControl>
              <PasswordInputInput required value={form.secretKey} onChange={set('secretKey')} />
              <PasswordInputVisibilityTrigger><PasswordInputIndicator /></PasswordInputVisibilityTrigger>
            </PasswordInputControl>
          </PasswordInput>
          <Field required>
            <FieldLabel htmlFor="cos-bucket">Bucket</FieldLabel>
            <Input id="cos-bucket" required spellCheck={false} placeholder="legalio-1250000000" value={form.bucket} onChange={set('bucket')} />
          </Field>
          <Field required>
            <FieldLabel htmlFor="cos-region">Region</FieldLabel>
            <Input id="cos-region" required spellCheck={false} placeholder="ap-jakarta" value={form.region} onChange={set('region')} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="cos-prefix">{t('cos_setup.prefix', 'Prefix (optional)')}</FieldLabel>
            <Input id="cos-prefix" spellCheck={false} placeholder="legalio/" value={form.prefix} onChange={set('prefix')} />
          </Field>
          {error && (
            <Alert status="error" role="alert" className="sm:col-span-2"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>
          )}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" size="sm" className="min-h-11 max-sm:w-full" loading={busy}>
              {busy ? t('cos_setup.testing', 'Testing and saving…') : data.configured ? t('cos_setup.replace', 'Replace credentials') : t('cos_setup.save', 'Test and save')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
};
