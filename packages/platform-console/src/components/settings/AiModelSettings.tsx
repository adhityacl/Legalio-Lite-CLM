import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, Sparkles } from 'lucide-react';
import { apiRequest } from '@legalio/shared/apiClient';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { PasswordInput, PasswordInputControl, PasswordInputIndicator, PasswordInputInput, PasswordInputVisibilityTrigger } from '@legalio/ui-components/password-input';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';

type Provider = 'gemini' | 'openai' | 'anthropic' | 'custom';
const PROVIDERS: Array<{ id: Provider; label: string; keyLabel: string; keyUrl?: string }> = [
  { id: 'gemini', label: 'Google Gemini', keyLabel: 'Gemini API key (AI Studio)', keyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'openai', label: 'OpenAI', keyLabel: 'OpenAI API key', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic', keyLabel: 'Anthropic API key', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', keyLabel: 'API key (optional for local servers)' },
];
const KEY_FIELD: Record<Provider, string> = { gemini: 'geminiApiKey', openai: 'openaiApiKey', anthropic: 'anthropicApiKey', custom: 'customApiKey' };
const HAS_KEY: Record<Provider, 'hasGeminiApiKey' | 'hasOpenaiApiKey' | 'hasAnthropicApiKey' | 'hasCustomApiKey'> = { gemini: 'hasGeminiApiKey', openai: 'hasOpenaiApiKey', anthropic: 'hasAnthropicApiKey', custom: 'hasCustomApiKey' };
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash'];

interface PlatformAi { aiProvider: Provider; aiModel: string; aiBaseUrl: string; hasGeminiApiKey: boolean; hasOpenaiApiKey: boolean; hasAnthropicApiKey: boolean; hasCustomApiKey: boolean }
interface Discovered { id: string; name: string }
interface OrgLimit { id: string; name: string; slug: string; usedMonth: number; usedToday: number; monthlyTokens: number; isDefault: boolean }
interface Limits { month: string; options: number[]; defaultMonthlyTokens: number; organizations: OrgLimit[] }

const message = (err: unknown) => (err as Error)?.message || 'Request failed.';

/** Connection to the AI provider (bring your own key) and the monthly token limit of each organization. */
export const AiModelSettings: React.FC = () => (
  <div className="flex flex-col gap-g21">
    <ProviderCard />
    <OrganizationLimitsCard />
  </div>
);

const ProviderCard: React.FC = () => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const [saved, setSaved] = useState<PlatformAi | null>(null);
  const [loadError, setLoadError] = useState('');
  const [provider, setProvider] = useState<Provider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [manual, setManual] = useState(false);
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  const [busy, setBusy] = useState<'' | 'models' | 'test' | 'save'>('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    apiRequest<PlatformAi>('/platform-settings', { cache: 'no-store' })
      .then((data) => { setSaved(data); setProvider(data.aiProvider); setModel(data.aiModel); setBaseUrl(data.aiBaseUrl); })
      .catch((err) => setLoadError(message(err)));
  }, []);
  useEffect(load, [load]);

  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const hasSavedKey = Boolean(saved?.[HAS_KEY[provider]]);
  const isSavedProvider = saved?.aiProvider === provider;
  const options = useMemo(() => {
    const ids = new Map<string, string>();
    if (provider === 'gemini') for (const id of GEMINI_MODELS) ids.set(id, id);
    for (const m of discovered) ids.set(m.id, m.name === m.id ? m.id : `${m.name} (${m.id})`);
    if (model && !manual && !ids.has(model)) ids.set(model, model);
    return [...ids].map(([id, label]) => ({ id, label }));
  }, [provider, discovered, model, manual]);

  const choose = (next: Provider) => {
    if (next === provider) return;
    setProvider(next);
    setApiKey('');
    setDiscovered([]);
    setStatus(null);
    setManual(false);
    // Keep the saved model only for the saved provider; another provider starts from its own pick.
    setModel(saved?.aiProvider === next ? saved.aiModel : next === 'gemini' ? GEMINI_MODELS[0] : '');
    if (next !== 'custom') setBaseUrl(saved?.aiBaseUrl ?? '');
  };

  const body = () => ({ provider, apiKey: apiKey.trim() || undefined, baseUrl: provider === 'custom' ? baseUrl.trim() : undefined, model: model.trim() || undefined });

  const fetchModels = async () => {
    setBusy('models');
    setStatus(null);
    try {
      const data = await apiRequest<{ models: Discovered[] }>('/ai/models', { method: 'POST', body: body() });
      setDiscovered(data.models);
      if (data.models.length && !data.models.some((m) => m.id === model)) setModel(data.models[0].id);
      setStatus({ ok: true, text: t('ai_setup.models_found', 'Connected. {count} models found.', { count: String(data.models.length) }) });
    } catch (err) {
      setDiscovered([]);
      setStatus({ ok: false, text: message(err) });
    } finally {
      setBusy('');
    }
  };

  const testModel = async () => {
    setBusy('test');
    setStatus(null);
    try {
      const data = await apiRequest<{ message: string }>('/ai/test-key', { method: 'POST', body: body() });
      setStatus({ ok: true, text: data.message });
    } catch (err) {
      setStatus({ ok: false, text: message(err) });
    } finally {
      setBusy('');
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!model.trim()) { setStatus({ ok: false, text: t('ai_setup.model_required', 'Choose or enter a model ID first.') }); return; }
    setBusy('save');
    setStatus(null);
    try {
      await apiRequest('/platform-settings', {
        method: 'POST',
        body: { aiProvider: provider, aiModel: model.trim(), aiBaseUrl: provider === 'custom' ? baseUrl.trim() : undefined, ...(apiKey.trim() ? { [KEY_FIELD[provider]]: apiKey.trim() } : {}) },
      });
      setApiKey('');
      showAlert({ title: t('ai_setup.saved', 'AI settings saved'), variant: 'success' });
      load();
    } catch (err) {
      setStatus({ ok: false, text: message(err) });
    } finally {
      setBusy('');
    }
  };

  if (loadError) return <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{loadError}</AlertDescription></AlertContent></Alert>;
  if (!saved) return <div role="status"><span className="sr-only">{t('common.loading', 'Memuat…')}</span><Skeleton height={233} /></div>;

  const ready = hasSavedKey || provider === 'custom';
  const canTest = Boolean(apiKey.trim() || hasSavedKey || provider === 'custom');
  const labelClass = 'text-xs font-semibold tracking-wide text-muted-foreground';
  return (
    <Card aria-labelledby="ai-provider-title" aria-busy={busy !== ''} className="gap-0 overflow-hidden p-0">
      <div className="flex min-w-0 items-center gap-g13 px-g21 py-g13">
        <span className="flex size-g34 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-g16" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 space-y-g5">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-g13 gap-y-g3">
            <h3 id="ai-provider-title" className="text-[15px] font-semibold">{t('ai_setup.title', 'AI provider')}</h3>
            <Badge className="shrink-0 whitespace-nowrap" tone={isSavedProvider && ready ? 'success' : 'warning'}>
              {isSavedProvider ? (ready ? t('ai_setup.active', 'Active') : t('ai_setup.no_key', 'Not configured')) : t('ai_setup.not_active', 'Not active yet')}
            </Badge>
          </div>
        </div>
      </div>
      <form onSubmit={(event) => void save(event)}>
        <div className="flex flex-col gap-g13 border-t border-border px-g21 py-g13">
          <div className="flex flex-col gap-g8" role="group" aria-label={t('ai_setup.provider', 'Provider')}>
            <span className={labelClass}>{t('ai_setup.provider', 'Provider')}</span>
            <div className="grid grid-cols-2 gap-g8 lg:grid-cols-4">
              {PROVIDERS.map((p) => (
                <Button key={p.id} type="button" variant={provider === p.id ? 'default' : 'outline'} aria-pressed={provider === p.id} onClick={() => choose(p.id)}>{p.label}</Button>
              ))}
            </div>
          </div>
          {provider === 'custom' && (
            <div className="flex flex-col gap-g8">
              <label htmlFor="ai-base-url" className={labelClass}>{t('ai_setup.base_url', 'Base URL')}</label>
              <Input id="ai-base-url" required type="url" spellCheck={false} placeholder="https://api.groq.com/openai/v1  ·  http://localhost:11434/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
          )}
          <div className="grid gap-g13 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-g8">
              <div className="flex items-center justify-between gap-g8">
                <label htmlFor="ai-api-key" className={labelClass}>{meta.keyLabel}</label>
                {meta.keyUrl && <a className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline" href={meta.keyUrl} target="_blank" rel="noreferrer">{t('ai_setup.get_key', 'Get an API key')}</a>}
              </div>
              <PasswordInput ids={{ input: 'ai-api-key' }} autoComplete="new-password">
                <PasswordInputControl>
                  <PasswordInputInput className="text-sm" aria-label={meta.keyLabel} placeholder={hasSavedKey ? t('ai_setup.key_saved', 'A key is saved. Type a new one to replace it.') : t('ai_setup.key_ph', 'Paste your API key')} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                  <PasswordInputVisibilityTrigger><PasswordInputIndicator /></PasswordInputVisibilityTrigger>
                </PasswordInputControl>
              </PasswordInput>
            </div>
            <div className="flex min-w-0 flex-col gap-g8">
              <label htmlFor="ai-model" className={labelClass}>{t('ai_setup.model', 'Model')}</label>
              {manual ? (
                <Input id="ai-model" required spellCheck={false} placeholder="gpt-4.1, claude-sonnet-4-5, llama-3.3-70b-instruct…" value={model} onChange={(e) => setModel(e.target.value)} />
              ) : (
                <NativeSelect id="ai-model" required value={model} onChange={(e) => setModel(e.target.value)}>
                  {options.length === 0 && <option value="">{t('ai_setup.pick_model', 'Select a model')}</option>}
                  {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </NativeSelect>
              )}
              {!manual && discovered.length === 0 && <p className="text-[11.5px] text-muted-foreground">{t('ai_setup.models_hint', 'Available models load after a successful connection test.')}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-g8">
            <Button type="button" variant="outline" loading={busy === 'models'} disabled={busy !== '' || !canTest} onClick={() => void fetchModels()}>
              {t('ai_setup.fetch', 'Test & fetch models')}
            </Button>
            <Button type="button" variant="outline" loading={busy === 'test'} disabled={busy !== '' || !model.trim() || !canTest} onClick={() => void testModel()}>
              {t('ai_setup.test', 'Test selected model')}
            </Button>
            {status
              ? <span role="status" className={`text-[11.5px] ${status.ok ? 'text-status-success' : 'text-status-danger'}`}>{status.text}</span>
              : !canTest && <span className="text-[11.5px] text-muted-foreground">{t('ai_setup.need_key', 'Add an API key to enable testing.')}</span>}
          </div>
          <Checkbox checked={manual} onCheckedChange={(details) => setManual(details.checked === true)}>
            <CheckboxControl /><CheckboxLabel>{t('ai_setup.manual', 'Enter the model ID')}</CheckboxLabel><CheckboxHiddenInput />
          </Checkbox>
          {provider !== 'gemini' && (
            <Alert status="info" role="note"><AlertIndicator /><AlertContent><AlertDescription>
              {provider === 'custom'
                ? t('ai_setup.note_custom', 'Servers outside OpenAI, Anthropic and Gemini may not read PDFs or scanned images. Those documents are refused with a clear message; text-based documents work. The news ticker has no web search outside Gemini.')
                : t('ai_setup.note_other', 'The news ticker has no web search outside Gemini and falls back to the model’s own knowledge.')}
            </AlertDescription></AlertContent></Alert>
          )}
        </div>
        <div className="flex items-center justify-end border-t border-border px-g21 py-g13">
          <Button type="submit" className="max-sm:w-full" loading={busy === 'save'} disabled={busy !== ''}>{t('ai_setup.save', 'Save and use this provider')}</Button>
        </div>
      </form>
    </Card>
  );
};

const OrganizationLimitsCard: React.FC = () => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const [data, setData] = useState<Limits | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');

  const load = useCallback(() => {
    apiRequest<Limits>('/auth-console/ai-limits', { cache: 'no-store' }).then(setData).catch((err) => setError(message(err)));
  }, []);
  useEffect(load, [load]);

  const change = async (org: OrgLimit, value: string) => {
    setSaving(org.id);
    try {
      await apiRequest(`/auth-console/ai-limits/${encodeURIComponent(org.id)}`, { method: 'PUT', body: { monthlyTokens: value === 'default' ? null : Number(value) } });
      showAlert({ title: t('ai_limits.saved', 'Limit saved for {name}', { name: org.name }), variant: 'success' });
      load();
    } catch (err) {
      showAlert({ title: message(err), variant: 'destructive' });
    } finally {
      setSaving('');
    }
  };

  const label = (value: number) => (value === 0 ? t('ai_limits.unlimited', 'Unlimited') : `${value.toLocaleString('en-US')} ${t('ai_limits.per_month', 'tokens / month')}`);
  return (
    <Card aria-labelledby="ai-limits-title" className="gap-0 overflow-hidden p-0">
      <div className="flex min-w-0 items-center gap-g13 px-g21 py-g13">
        <span className="flex size-g34 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Gauge className="size-g16" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 space-y-g5">
          <h3 id="ai-limits-title" className="text-[15px] font-semibold">{t('ai_limits.title', 'Token limit per organization')}</h3>
        </div>
      </div>
      <div className="border-t border-border">
        {error && <div className="p-g13"><Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert></div>}
        {!data && !error && <div role="status" className="p-g13"><span className="sr-only">{t('common.loading', 'Memuat…')}</span><Skeleton height={89} /></div>}
        {data && (
          <TableScrollArea>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableColumnHeader>{t('ai_limits.organization', 'Organization')}</TableColumnHeader>
                  <TableColumnHeader className="lg:w-80">{t('ai_limits.used', 'Used in {month}', { month: data.month })}</TableColumnHeader>
                  <TableColumnHeader className="lg:w-96">{t('ai_limits.limit', 'Monthly limit')}</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.organizations.map((org) => {
                  const ratio = org.monthlyTokens > 0 ? org.usedMonth / org.monthlyTokens : 0;
                  const tone = ratio >= 1 ? 'text-status-danger' : ratio >= 0.8 ? 'text-status-warning' : 'text-foreground';
                  return (
                    <TableRow key={org.id}>
                      <TableCell><div className="text-[13px] font-semibold">{org.name}</div><div className="text-xs text-muted-foreground">{org.slug}</div></TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-g5">
                          <span className={`text-[13px] font-semibold tabular-nums ${tone}`}>{org.usedMonth.toLocaleString('en-US')} {t('ai_limits.tokens', 'tokens')}</span>
                          <span className="text-[11.5px] text-muted-foreground">{t('ai_limits.today', 'Today')}: {org.usedToday.toLocaleString('en-US')} {t('ai_limits.tokens', 'tokens')}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <NativeSelect className="w-full" aria-label={`${t('ai_limits.limit', 'Monthly limit')}: ${org.name}`} disabled={saving === org.id}
                          value={org.isDefault ? 'default' : String(org.monthlyTokens)} onChange={(e) => void change(org, e.target.value)}>
                          <option value="default">{t('ai_limits.default', 'Platform default')} ({label(data.defaultMonthlyTokens)})</option>
                          {data.options.map((value) => <option key={value} value={String(value)}>{label(value)}</option>)}
                        </NativeSelect>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScrollArea>
        )}
      </div>
    </Card>
  );
};
