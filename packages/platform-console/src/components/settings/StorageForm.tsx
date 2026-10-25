import { apiRequest } from '@legalio/shared/apiClient';
import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { PROVIDER_LABELS, STORAGE_PROVIDERS, type StorageProvider } from '@legalio/shared/storageProviders';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { Button } from '@legalio/ui-components/button';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { RelativeTime } from '../documents/RelativeTime';
import { EMPTY_STORAGE, StorageFields, type StorageValues } from './StorageFields';

type ProviderStatus =
  | { configured: false }
  | { configured: true; bucket: string; region: string; prefix: string; accessKeyLast4: string; endpoint?: string; accountIdLast4?: string; updated_at: string };
interface StorageStatus { configured: boolean; active: StorageProvider | null; providers: Record<StorageProvider, ProviderStatus> }
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: StorageStatus };

const API = '/api/integrations/storage';

/**
 * Superuser setup for file storage. Several providers can stay configured; the active one receives new uploads, and every file is read
 * from the provider it was written to. The server tests credentials before saving them; secret keys are never shown again.
 */
export const StorageForm: React.FC = () => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [form, setForm] = useState<StorageValues>(EMPTY_STORAGE);
  const [activate, setActivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setState({ status: 'loading' });
    apiRequest<StorageStatus>(API)
      .then((data) => { setState({ status: 'ready', data }); setForm((prev) => ({ ...prev, provider: data.active ?? prev.provider })); })
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, []);
  useEffect(load, [load]);

  const send = async (path: string, body: unknown, success: string) => {
    setBusy(true);
    setError('');
    try {
      const data = await apiRequest<StorageStatus>(`${API}${path}`, { method: 'PUT', body });
      setState({ status: 'ready', data });
      showAlert({ title: success, variant: 'success' });
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await send(`/providers/${form.provider}`, { ...form, activate }, t('cos_setup.saved', 'File storage saved'))) {
      setForm((prev) => ({ ...EMPTY_STORAGE, provider: prev.provider }));
      setActivate(false);
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
  const selected = data.providers[form.provider];
  const canActivate = data.active !== null && data.active !== form.provider;
  return (
    <Card aria-labelledby="storage-title" aria-busy={busy}>
      <CardHeader>
        <div className="col-span-full flex min-w-0 items-center gap-g8">
          <span className="flex size-g34 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <HardDrive className="size-g16" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 space-y-g3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-g8 gap-y-g3">
              <CardTitle id="storage-title" className="text-base">{t('storage.title', 'Storage')}</CardTitle>
              <Badge className="shrink-0 whitespace-nowrap" tone={data.configured ? 'success' : 'warning'}>
                {data.configured ? t('cos_setup.configured', 'Configured') : t('cos_setup.source_none', 'Belum dikonfigurasi')}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-g21 pt-g13">
        <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label={t('storage.providers', 'Providers')}>
          {STORAGE_PROVIDERS.map((provider) => {
            const status = data.providers[provider];
            return (
              <li key={provider} className="flex flex-wrap items-center justify-between gap-g8 px-g13 py-g8">
                <div className="min-w-0">
                  <div className="font-medium">{PROVIDER_LABELS[provider]}</div>
                  {status.configured && <div className="font-mono text-xs text-muted-foreground wrap-anywhere">{status.bucket}{status.region ? ` · ${status.region}` : ''} · ••••{status.accessKeyLast4} · <RelativeTime iso={status.updated_at} /></div>}
                </div>
                <div className="flex items-center gap-g8">
                  {data.active === provider && <Badge tone="success">{t('storage.active', 'Active')}</Badge>}
                  {status.configured && data.active !== provider && (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void send('/active', { provider }, t('storage.activated', 'New uploads now go to {name}.', { name: PROVIDER_LABELS[provider] }))}>
                      {t('storage.use', 'Use for new uploads')}
                    </Button>
                  )}
                  {!status.configured && <Badge>{t('storage.not_configured', 'Not configured')}</Badge>}
                </div>
              </li>
            );
          })}
        </ul>
        <form className="grid gap-g13 sm:grid-cols-2" onSubmit={(event) => void save(event)} aria-label={`${selected.configured ? t('storage.replace', 'Replace credentials') : t('storage.configure', 'Configure')}: ${PROVIDER_LABELS[form.provider]}`}>
          <p className="text-sm font-semibold sm:col-span-2">{selected.configured ? t('storage.replace', 'Replace credentials') : t('storage.configure', 'Configure')} · {PROVIDER_LABELS[form.provider]}</p>
          <StorageFields idPrefix="storage" values={form} onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))} />
          {canActivate && (
            <Checkbox className="sm:col-span-2" checked={activate} onCheckedChange={(details) => setActivate(details.checked === true)}>
              <CheckboxControl /><CheckboxLabel>{t('storage.activate_on_save', 'Use this provider for new uploads')}</CheckboxLabel><CheckboxHiddenInput />
            </Checkbox>
          )}
          {error && (
            <Alert status="error" role="alert" className="sm:col-span-2"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>
          )}
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" size="sm" className="min-h-11 max-sm:w-full" loading={busy}>
              {busy ? t('cos_setup.testing', 'Testing and saving…') : selected.configured ? t('cos_setup.replace', 'Replace credentials') : t('cos_setup.save', 'Test and save')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
};
