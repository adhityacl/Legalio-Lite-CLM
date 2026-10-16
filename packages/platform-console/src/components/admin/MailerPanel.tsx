import { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, Save, RotateCcw, Monitor, Smartphone, WandSparkles, Code2, Eye, Plus } from 'lucide-react';
import { MAIL_CATALOG, MailTemplateError, renderMailTemplate, validateMailTemplate, type MailTemplate, type MailTemplateId } from '@legalio/shared/mailTemplates';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { MailVisualEditor } from './MailVisualEditor';
import { registerDirtyCheck } from '../../lib/unsavedChanges';

type SavedTemplate = MailTemplate & { id: MailTemplateId; version: number; updatedAt: string | null };
async function api(path = '', body?: unknown) {
  const response = await fetch(`/api/mailer/templates${path}`, {
    method: body ? 'PUT' : 'GET', credentials: 'include', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const key = response.status === 409 ? 'conflict' : response.status === 404 ? 'not_found' : [401, 403].includes(response.status) ? 'access' : response.status === 400 ? 'invalid' : 'request';
    throw new MailTemplateError(`mailer.error.${key}`, data.message || data.error || 'Request failed');
  }
  return data;
}
const fieldClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
export function MailerPanel() {
  const confirm = useConfirm();
  const { t } = useLanguage();
  const errorText = (error: unknown) => error instanceof MailTemplateError ? t(error.key, error.message, error.variables) : t('mailer.error.request');
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [selected, setSelected] = useState<MailTemplateId>('verification');
  const [draft, setDraft] = useState<MailTemplate | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [showPreview, setShowPreview] = useState(false);
  const visualInsert = useRef<((text: string) => void) | null>(null);
  const [mobile, setMobile] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const saved = templates.find(t => t.id === selected);
  const dirty = Boolean(draft && saved && (draft.subject !== saved.subject || draft.html !== saved.html));
  useEffect(() => registerDirtyCheck(() => dirty), [dirty]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  async function load() {
    setLoading(true); setError(null);
    try {
      const data = await api();
      setTemplates(data.templates);
      const current = data.templates.find((t: SavedTemplate) => t.id === selected);
      setDraft({ subject: current.subject, html: current.html });
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const preview = useMemo(() => {
    if (!draft) return { subject: '', html: '', error: '' };
    try {
      validateMailTemplate(selected, draft);
      return { ...renderMailTemplate(draft, MAIL_CATALOG[selected].sample, ['details']), error: '' };
    } catch (e) { return { subject: '', html: '', error: errorText(e) }; }
  }, [selected, draft, t]);
  async function choose(id: MailTemplateId) {
    if (saving || id === selected) return;
    if (dirty && !await confirm({ description: t('mailer.discard_confirm', "Buang perubahan template yang belum disimpan?"), confirmLabel: t('mailer.discard', "Buang perubahan") })) return;
    const next = templates.find(t => t.id === id);
    if (!next) return;
    setSelected(id); setDraft({ subject: next.subject, html: next.html }); setError(null); setMessage('');
  }
  async function save() {
    if (!draft || !saved || preview.error) return;
    setSaving(true); setError(null); setMessage('');
    try {
      const data = await api(`/${selected}`, { ...draft, expectedVersion: saved.version });
      setTemplates(all => all.map(t => t.id === selected ? { id: selected, ...data.template } : t));
      setMessage('mailer.saved');
    } catch (e) { setError(e); }
    finally { setSaving(false); }
  }
  async function reset() {
    if (!await confirm({ description: t('mailer.reset_confirm', "Ganti isi editor dengan template bawaan? Simpan untuk menerapkannya."), confirmLabel: t('mailer.use_default', "Gunakan bawaan") })) return;
    setDraft({ ...MAIL_CATALOG[selected].defaults }); setMessage('');
  }
  function insertVariable(key: string) {
    if (!draft) return;
    if (mode === 'visual') { visualInsert.current?.(`{{${key}}}`); return; }
    if (!editor.current) return;
    const input = editor.current;
    const start = input.selectionStart; const end = input.selectionEnd; const variable = `{{${key}}}`;
    setDraft({ ...draft, html: draft.html.slice(0, start) + variable + draft.html.slice(end) });
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + variable.length, start + variable.length); });
  }
  return <div className="space-y-g21">
    <div className="flex flex-wrap items-start justify-between gap-g13">
      <Heading as="h2" size="md" weight="semibold">{t('mailer.title', "Template email")}</Heading>
      <Button onClick={save} disabled={!dirty || saving || loading || Boolean(preview.error)}><Save aria-hidden="true" />{saving ? t('mailer.saving', "Menyimpan…") : t('mailer.save', "Simpan perubahan")}</Button>
    </div>
    {Boolean(error) && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{errorText(error)} <Button variant="outline" onClick={async () => { if (!dirty || await confirm(t('mailer.reload_confirm', "Muat ulang dan buang perubahan yang belum disimpan?"))) void load(); }} disabled={saving}>{t('mailer.reload', "Muat ulang")}</Button></div>}
    {message && <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm">{t(message)}</p>}
    {loading ? <p role="status">{t('mailer.loading', "Memuat template…")}</p> : draft && <div className="grid min-w-0 gap-g21 lg:grid-cols-[230px_minmax(0,1fr)]">
      <Card className="self-start p-g13"><p className="mb-3 text-sm font-semibold">{t('mailer.types')} · {templates.length}</p><nav aria-label={t('mailer.types_label')} className="flex flex-col gap-2">
        {templates.map(template => <button key={template.id} type="button" aria-current={selected === template.id ? 'page' : undefined} disabled={saving} onClick={() => void choose(template.id)} className={`min-h-11 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === template.id ? 'border-primary bg-primary/10 text-foreground' : 'border-transparent hover:bg-muted'}`}><span className="flex items-center gap-2"><Mail size={16} className="shrink-0" aria-hidden="true" />{t(`mailer.catalog.${template.id}.name`, MAIL_CATALOG[template.id].name)}</span>{template.version > 0 && <span className="mt-1 block text-xs text-muted-foreground">{t('mailer.customized', "Disesuaikan")}</span>}</button>)}
      </nav></Card>
      <div className="min-w-0 space-y-g21">
        <Card className="space-y-g13 p-g21"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-3"><Heading as="h3" size="md">{t(`mailer.catalog.${selected}.name`, MAIL_CATALOG[selected].name)}</Heading><span className="rounded-full border border-border bg-muted px-2 py-1 text-xs">{selected === 'smtp-test' ? t('mailer.manual', "Dikirim manual") : t('mailer.automatic', "Otomatis sistem")}</span></div><p className="sr-only">{t(`mailer.catalog.${selected}.description`, MAIL_CATALOG[selected].description)}</p></div><Button variant="outline" onClick={reset} disabled={saving}><RotateCcw aria-hidden="true" />{t('mailer.reset', "Reset ke bawaan")}</Button></div><div className="flex flex-wrap gap-x-6 gap-y-2 text-xs"><p><span className="text-muted-foreground">{t('mailer.recipient')} </span>{t(`mailer.catalog.${selected}.recipient`, MAIL_CATALOG[selected].recipient)}</p><p><span className="text-muted-foreground">{t('mailer.trigger')} </span>{t(`mailer.catalog.${selected}.trigger`)}</p></div></Card>
        <div className="min-w-0 space-y-g21">
          <Card className="min-w-0 space-y-g13 p-g21">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><Heading as="h3" size="sm">{t('mailer.editor', "Editor email")}</Heading><p className="mt-1 text-xs text-muted-foreground">{t('mailer.editor_help', "Edit secara visual atau buka kode HTML mentah.")}</p></div>
              <div className="flex flex-wrap gap-2"><div role="group" aria-label={t('mailer.mode')} className="flex rounded-lg bg-muted p-1">
                <Button variant="ghost" aria-pressed={mode === 'visual'} className={mode === 'visual' ? 'bg-card text-primary shadow-sm' : ''} onClick={() => setMode('visual')}><WandSparkles size={14} aria-hidden="true" />{t('mailer.visual', "Visual")}</Button>
                <Button variant="ghost" aria-pressed={mode === 'html'} className={mode === 'html' ? 'bg-card text-primary shadow-sm' : ''} onClick={() => setMode('html')}><Code2 size={14} aria-hidden="true" />{t('mailer.html', "HTML")}</Button>
              </div><Button variant="outline" aria-expanded={showPreview} onClick={() => setShowPreview(open => !open)}><Eye size={14} aria-hidden="true" />{t('mailer.preview', "Preview")}</Button></div>
            </div>
            <label className="block space-y-2 text-sm font-medium"><span>{t('mailer.subject', "Subjek email")}</span><input className={fieldClass} value={draft.subject} maxLength={500} disabled={saving} onChange={e => { setDraft({ ...draft, subject: e.target.value }); setMessage(''); }} /></label>
            <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{t('mailer.body', "Isi email")}</span><span className="text-xs text-muted-foreground">{dirty ? t('mailer.unsaved', "Perubahan belum disimpan") : t('mailer.stored', "Template tersimpan")}</span></div>
              {mode === 'visual' ? <MailVisualEditor key={selected} html={draft.html} disabled={saving} insertRef={visualInsert} onChange={html => { setDraft(current => current ? { ...current, html } : current); setMessage(''); }} /> :
                <label className="block"><span className="sr-only">{t('mailer.html_body', "Isi email (HTML)")}</span><textarea ref={editor} className={`${fieldClass} min-h-[390px] resize-y font-mono leading-relaxed`} spellCheck={false} value={draft.html} maxLength={100000} disabled={saving} aria-describedby="mailer-variables" aria-invalid={Boolean(preview.error)} onChange={e => { setDraft({ ...draft, html: e.target.value }); setMessage(''); }} /></label>}
            </div>
            {preview.error && <p role="alert" className="text-sm text-destructive">{preview.error}</p>}
            <p id="mailer-variables" className="text-xs text-muted-foreground">{t('mailer.variables_help', "Sisipkan data personal ke posisi kursor. Variabel juga dapat dipakai pada subjek.")}</p>
            <div className="flex flex-wrap gap-2">{Object.keys(MAIL_CATALOG[selected].sample).map(key => <button type="button" key={key} disabled={saving} onClick={() => insertVariable(key)} className="min-h-11 break-all rounded-md border border-border px-2 font-mono text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus size={12} className="mr-1 inline" aria-hidden="true" />{`{{${key}}}`}</button>)}</div>
          </Card>
          {showPreview && <Card className="min-w-0 space-y-g13 overflow-hidden p-g21"><div className="flex flex-wrap items-center justify-between gap-2"><Heading as="h3" size="sm">{t('mailer.preview_title', "Preview email")}</Heading><div className="flex gap-2"><Button variant="outline" aria-label={t('mailer.desktop')} aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor aria-hidden="true" /></Button><Button variant="outline" aria-label={t('mailer.mobile')} aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone aria-hidden="true" /></Button></div></div>
            <p className="break-words border-b border-border pb-3 text-sm"><strong>{t('mailer.subject_prefix', "Subjek:")}</strong> {preview.subject || '—'}</p>
            <div className="rounded-lg bg-muted p-2"><iframe title={t('mailer.preview_frame')} sandbox="" referrerPolicy="no-referrer" className="mx-auto min-h-[520px] w-full rounded bg-white" style={{ maxWidth: mobile ? 375 : undefined }} srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{margin:0;overflow-wrap:anywhere}a{pointer-events:none}</style></head><body>${preview.html}</body></html>`} /></div>
            <p className="text-xs text-muted-foreground">{t('mailer.preview_help', "Preview memakai data contoh; tidak mengirim email. Tampilan dapat berbeda antar aplikasi email.")}</p>
          </Card>}
        </div>
      </div>
    </div>}
  </div>;
}
