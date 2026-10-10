import React, { useCallback, useEffect, useState } from 'react';
import { Database, Download, Loader2, RefreshCw, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { Button, buttonVariants } from '@legalio/ui-components/button';
import { PageHeader, FormField, TableFrame } from '@legalio/ui-components/blocks';
import { Badge } from '@legalio/ui-components/badge';
import { Alert, AlertDescription } from '@legalio/ui-components/alert';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@legalio/ui-components/table';
import { Input } from '@legalio/ui-components/input';
import { Card, CardContent } from '@legalio/ui-components/card';
import { ModalFrame, ModalTitle } from './ui/modal-frame';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';

interface Backup { id: string; createdAt: string; status: 'success' | 'failed'; sizeBytes: number; purpose: 'manual' | 'safety'; }
async function request(path = '', body?: unknown) {
  const res = await fetch(`/api/auth-console/backups${path}`, { credentials: 'include', cache: 'no-store', method: body ? 'POST' : 'GET', headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error);
  return data;
}
export function SQLiteBackupsPanel() {
  const { t, language } = useLanguage();
  const confirm = useConfirm();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Backup | null>(null);
  const [fileMode, setFileMode] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [restoring, setRestoring] = useState(false);
  const refresh = useCallback(async () => {
    try { setBackups((await request()).backups); setError(''); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function create() {
    if (!(await confirm({ title: t('backup.create', 'Back up now'), description: t('backup.pause', 'Application requests will pause briefly while SQLite and uploaded documents are backed up.') }))) return;
    setBusy(true); setError(''); setMessage('');
    try { await request('', {}); await refresh(); setMessage(t('backup.created', 'Backup created successfully.')); }
    catch (err) { await refresh(); setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function restore() {
    if ((!selected && !file) || confirmation !== 'RESTORE') return;
    setBusy(true); setError('');
    try {
      if (fileMode && file) {
        const body = new FormData(); body.append('confirmation', confirmation); body.append('file', file);
        await request('/restore-file', body);
      } else if (selected) await request(`/${selected.id}/restore`, { confirmation });
      setSelected(null); setFileMode(false); setFile(null); setRestoring(true);
      setMessage(t('backup.restart', 'Restore prepared and safety backup created. The backend is restarting. If it is managed manually, start it again. Sign in again after restart.'));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  const locale = language === 'ID' ? 'id-ID' : language === 'ZH' ? 'zh-CN' : 'en-US';
  return <div className="ds-page">
    <PageHeader title={t('backup.title', 'Backup & Restore')} description={t('backup.description', 'Full platform backup: SQLite, all organizations, accounts, settings and uploaded documents.')} icon={<Database aria-hidden="true" className="h-5 w-5 text-accent-text" />} actions={<> <Button variant="outline" disabled={busy || restoring} onClick={() => { setSelected(null); setFile(null); setFileMode(true); setConfirmation(''); setError(''); }}><Upload className="mr-2 h-4 w-4" />{t('backup.fromFile', 'Restore from file')}</Button><Button size="icon" variant="outline" disabled={busy || restoring} onClick={() => void refresh()} aria-label={t('backup.refresh', 'Refresh backups')}><RefreshCw aria-hidden="true" className="h-4 w-4" /></Button><Button disabled={busy || restoring} onClick={() => void create()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}{t('backup.create', 'Back up now')}</Button> </>} />
    <Card>
      <CardContent><p className="flex items-start gap-2 text-sm text-ink-soft"><ShieldCheck className="h-5 w-5 shrink-0 text-accent-text" />{t('backup.storage', 'Backups are stored on this server. Download a copy and keep it securely outside the server. Backups contain sensitive data and are not encrypted.')}</p></CardContent>
    </Card>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {message && <Alert role="status"><AlertDescription>{message}{restoring && <a href="/sys?tab=admin-system-backups" className="ml-2 underline">{t('backup.reopen', 'Open console again')}</a>}</AlertDescription></Alert>}
    <TableFrame>
      <Table className="w-full text-left text-sm"><TableHeader className="border-b border-hairline bg-surface-2 text-ink-soft"><TableRow>{['date', 'type', 'size', 'status', 'actions'].map((key) => <TableHead key={key} className="px-5 py-4 font-semibold">{t(`backup.${key}`)}</TableHead>)}</TableRow></TableHeader><TableBody className="divide-y divide-hairline">
        {loading ? <TableRow><TableCell colSpan={5} className="p-6 text-center" role="status">{t('sys.loading', 'Loading…')}</TableCell></TableRow> : !backups.length ? <TableRow><TableCell colSpan={5} className="p-8 text-center text-ink-soft">{t('backup.empty', 'No backups yet.')}</TableCell></TableRow> : backups.map((backup) => <TableRow key={backup.id}>
          <TableCell className="px-5 py-5"><div>{new Date(backup.createdAt).toLocaleString(locale)}</div><div className="mt-1 font-mono text-xs text-ink-soft">{backup.id.slice(0, 8)}</div></TableCell>
          <TableCell className="px-5 py-5">{t(`backup.${backup.purpose}`)}</TableCell><TableCell className="px-5 py-5">{(backup.sizeBytes / 1024 / 1024).toFixed(2)} MB</TableCell><TableCell className="px-5 py-5"><Badge variant={backup.status === 'success' ? 'success' : 'danger'}>{t(`backup.${backup.status}`)}</Badge></TableCell>
          <TableCell className="px-5 py-5"><div className="flex items-center gap-2">{backup.status === 'success' && <><a className={buttonVariants('outline')} href={`/api/auth-console/backups/${backup.id}/download`} aria-disabled={busy || restoring} onClick={(event) => { if (busy || restoring) event.preventDefault(); }}><Download className="mr-2 h-4 w-4" />{t('backup.download', 'Download')}</a><Button variant="outline" disabled={busy || restoring} onClick={() => { setSelected(backup); setFileMode(false); setFile(null); setConfirmation(''); setError(''); }}><RotateCcw className="mr-2 h-4 w-4" />{t('backup.restore', 'Restore')}</Button></>}</div></TableCell>
        </TableRow>)}
      </TableBody></Table>
    </TableFrame>
    <>{(selected || fileMode) && <ModalFrame onClose={() => { if (!busy) { setSelected(null); setFileMode(false); } }} data-size="sm"><div className="ds-form-body"><ModalTitle className="ds-modal-title flex items-center gap-2">{t('backup.restore', 'Restore')}</ModalTitle><p className="text-sm text-ink-soft">{t('backup.warning', 'This replaces the entire platform database and uploaded documents with the selected backup. A safety backup is created first. The backend stops and must restart; all users must sign in again using the restored accounts.')}</p>
      {fileMode && <FormField id="restore-file" label={t('backup.file', 'Backup file')} help={t('backup.fileHelp', 'Choose a Legalio .tar.gz backup, up to 512 MB. The archive is validated before restore.')}><Input aria-describedby="restore-file-help" aria-invalid={!!file && !!error} id="restore-file" type="file" accept=".tar.gz" disabled={busy} onChange={(event) => { const chosen = event.target.files?.[0] ?? null; setFile(chosen); setError(chosen && (!chosen.name.toLowerCase().endsWith('.tar.gz') || chosen.size > 512 * 1024 * 1024) ? t('backup.fileHelp', 'Choose a Legalio .tar.gz backup, up to 512 MB. The archive is validated before restore.') : ''); }} /></FormField>}
      <p className="text-sm text-ink-soft">{selected && new Date(selected.createdAt).toLocaleString(locale)}</p>
      <FormField id="restore-confirmation" label={t('backup.confirm', 'Type RESTORE to confirm')}><Input id="restore-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" /></FormField>
      <div className="ds-form-actions"><Button variant="outline" disabled={busy} onClick={() => { setSelected(null); setFileMode(false); }}>{t('backup.cancel', 'Cancel')}</Button><Button variant="destructive" disabled={busy || confirmation !== 'RESTORE' || (fileMode && (!file || !file.name.toLowerCase().endsWith('.tar.gz') || file.size > 512 * 1024 * 1024))} onClick={() => void restore()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('backup.restore', 'Restore')}</Button></div>
      {error && <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p>}
    </div></ModalFrame>}</>
  </div>;
}
