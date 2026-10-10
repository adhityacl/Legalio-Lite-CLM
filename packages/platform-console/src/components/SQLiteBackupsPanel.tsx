import React, { useCallback, useEffect, useState } from 'react';
import { Database, Download, Loader2, RefreshCw, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { PageHeader, FormField } from '@legalio/ui-components/blocks';
import { Badge } from '@legalio/ui-components/badge';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Table, TableHeader, TableBody, TableRow, TableColumnHeader, TableCell, TableEmpty, TableScrollArea } from '@legalio/ui-components/table';
import { Input } from '@legalio/ui-components/input';
import { Card, CardBody } from '@legalio/ui-components/card';
import { Spinner } from '@legalio/ui-components/spinner';
import { Text } from '@legalio/ui-components/text';
import { FileUpload, FileUploadHiddenInput, FileUploadItemGroup, FileUploadItems, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { ModalFrame } from './ui/modal-frame';
import { useLanguage } from '../context/LanguageContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { DialogBody, DialogCloseIcon, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
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
  const MAX_BYTES = 512 * 1024 * 1024;
  const invalidFile = (chosen: File | null) => !chosen || !chosen.name.toLowerCase().endsWith('.tar.gz') || chosen.size > MAX_BYTES;
  const closeRestore = () => { if (!busy) { setSelected(null); setFileMode(false); } };
  return <div className="flex flex-col gap-6">
    <PageHeader
      title={<span className="inline-flex items-center gap-2"><Database aria-hidden="true" className="size-5 text-accent-foreground" />{t('backup.title', 'Backup & Restore')}</span>}
      description={t('backup.description', 'Full platform backup: SQLite, all organizations, accounts, settings and uploaded documents.')}
      actions={<>
        <Button variant="outline" disabled={busy || restoring} onClick={() => { setSelected(null); setFile(null); setFileMode(true); setConfirmation(''); setError(''); }}><Upload aria-hidden="true" />{t('backup.fromFile', 'Restore from file')}</Button>
        <Button size="icon-md" variant="outline" disabled={busy || restoring} onClick={() => void refresh()} aria-label={t('backup.refresh', 'Refresh backups')}><RefreshCw aria-hidden="true" /></Button>
        <Button loading={busy} disabled={restoring} onClick={() => void create()}>{busy ? <Spinner size="sm" decorative /> : <Database aria-hidden="true" />}{t('backup.create', 'Back up now')}</Button>
      </>}
    />
    <Card>
      <CardBody className="flex items-start gap-2"><ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-accent-foreground" />{t('backup.storage', 'Backups are stored on this server. Download a copy and keep it securely outside the server. Backups contain sensitive data and are not encrypted.')}</CardBody>
    </Card>
    {error && <Alert status="error"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
    {message && <Alert status="success" role="status"><AlertIndicator /><AlertContent><AlertDescription>{message}{restoring && <Button asChild variant="link" className="ml-2"><a href="/sys?tab=admin-system-backups">{t('backup.reopen', 'Open console again')}</a></Button>}</AlertDescription></AlertContent></Alert>}
    <Card className="overflow-hidden">
      <TableScrollArea>
        <Table>
          <TableHeader><TableRow>{['date', 'type', 'size', 'status', 'actions'].map(key => <TableColumnHeader key={key}>{t(`backup.${key}`)}</TableColumnHeader>)}</TableRow></TableHeader>
          <TableBody>
            {loading ? <TableEmpty colSpan={5}><span role="status" className="inline-flex items-center gap-2"><Spinner size="sm" decorative />{t('sys.loading', 'Loading…')}</span></TableEmpty>
              : !backups.length ? <TableEmpty colSpan={5}>{t('backup.empty', 'No backups yet.')}</TableEmpty>
              : backups.map(backup => <TableRow key={backup.id}>
                <TableCell><div>{new Date(backup.createdAt).toLocaleString(locale)}</div><Text size="xs" tone="muted" className="mt-1 font-mono">{backup.id.slice(0, 8)}</Text></TableCell>
                <TableCell>{t(`backup.${backup.purpose}`)}</TableCell>
                <TableCell numeric>{(backup.sizeBytes / 1024 / 1024).toFixed(2)} MB</TableCell>
                <TableCell><Badge tone={backup.status === 'success' ? 'success' : 'danger'}>{t(`backup.${backup.status}`)}</Badge></TableCell>
                <TableCell>{backup.status === 'success' && <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm" aria-disabled={busy || restoring}>
                    <a href={`/api/auth-console/backups/${backup.id}/download`} onClick={event => { if (busy || restoring) event.preventDefault(); }}><Download aria-hidden="true" />{t('backup.download', 'Download')}</a>
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy || restoring} onClick={() => { setSelected(backup); setFileMode(false); setFile(null); setConfirmation(''); setError(''); }}><RotateCcw aria-hidden="true" />{t('backup.restore', 'Restore')}</Button>
                </div>}</TableCell>
              </TableRow>)}
          </TableBody>
        </Table>
      </TableScrollArea>
    </Card>
    {(selected || fileMode) && <ModalFrame size="sm" role="alertdialog" onClose={closeRestore}>
      <DialogHeader className="border-b border-border px-6 py-4"><DialogTitle>{t('backup.restore', 'Restore')}</DialogTitle><DialogCloseIcon /></DialogHeader>
      <DialogBody className="mt-0 grid gap-4 overflow-y-auto px-6 py-5">
        <DialogDescription>{t('backup.warning', 'This replaces the entire platform database and uploaded documents with the selected backup. A safety backup is created first. The backend stops and must restart; all users must sign in again using the restored accounts.')}</DialogDescription>
        {fileMode && <FormField label={t('backup.file', 'Backup file')} help={t('backup.fileHelp', 'Choose a Legalio .tar.gz backup, up to 512 MB. The archive is validated before restore.')} invalid={!!file && invalidFile(file)}>
          <FileUpload accept=".tar.gz,application/gzip" maxFiles={1} maxFileSize={MAX_BYTES} disabled={busy} onFileChange={details => { const chosen = details.acceptedFiles[0] ?? null; setFile(chosen); setError(chosen && invalidFile(chosen) ? t('backup.fileHelp', 'Choose a Legalio .tar.gz backup, up to 512 MB. The archive is validated before restore.') : ''); }}>
            <FileUploadHiddenInput />
            <FileUploadTrigger>{t('backup.chooseFile', 'Choose file')}</FileUploadTrigger>
            <FileUploadItemGroup><FileUploadItems /></FileUploadItemGroup>
          </FileUpload>
        </FormField>}
        {selected && <Text size="sm" tone="muted">{new Date(selected.createdAt).toLocaleString(locale)}</Text>}
        <FormField label={t('backup.confirm', 'Type RESTORE to confirm')}><Input value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" /></FormField>
        {error && <Alert status="error"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}
      </DialogBody>
      <DialogFooter className="mt-0 border-t border-border px-6 py-4">
        <Button variant="outline" disabled={busy} onClick={closeRestore}>{t('backup.cancel', 'Cancel')}</Button>
        <Button variant="destructive" loading={busy} disabled={confirmation !== 'RESTORE' || (fileMode && invalidFile(file))} onClick={() => void restore()}>{t('backup.restore', 'Restore')}</Button>
      </DialogFooter>
    </ModalFrame>}
  </div>;
}
