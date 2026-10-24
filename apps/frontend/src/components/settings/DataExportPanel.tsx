import React, { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, PackageOpen, RefreshCw } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useIdentity } from '../../context/AuthContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { Heading } from '@legalio/ui-components/heading';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { OrgApiError, orgApi, orgPath } from './orgApi';

export interface ExportJobDto {
  id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired'; includeFiles: boolean; createdAt: string;
  expiresAt: string | null; sizeBytes: number | null; error: string | null; downloadUrl: string | null;
}

const TONE: Record<ExportJobDto['status'], StatusTone> = { queued: 'neutral', running: 'info', succeeded: 'success', failed: 'danger', expired: 'warning' };
const formatBytes = (bytes: number | null) => (bytes === null ? '—' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** Tenant data export: request a ZIP (optionally with the uploaded files), follow its progress, download it until the link expires. */
export const DataExportPanel: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t } = useLanguage();
  const { identity } = useIdentity();
  const showAlert = useAlertToast();
  const queryClient = useQueryClient();
  const [includeFiles, setIncludeFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  const queryKey = ['org-exports', identity?.id, organizationId];
  const exportsQuery = useQuery<{ exports: ExportJobDto[] }>({
    queryKey,
    queryFn: ({ signal }) => orgApi(orgPath(organizationId, '/exports'), { signal }),
    staleTime: 0,
    // Poll while a job is queued or running.
    refetchInterval: (query) => (query.state.data?.exports.some((job) => job.status === 'queued' || job.status === 'running') ? 2000 : false),
  });
  const jobs = exportsQuery.data?.exports ?? [];
  const active = jobs.some((job) => job.status === 'queued' || job.status === 'running');

  const request = async () => {
    setBusy(true);
    try {
      await orgApi(orgPath(organizationId, '/exports'), { method: 'POST', body: { includeFiles } });
      showAlert({ title: t('data.export.requested', 'Export requested. It runs in the background.'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      const conflict = err instanceof OrgApiError && err.code === 'EXPORT_IN_PROGRESS';
      showAlert({ title: conflict ? t('data.export.in_progress', 'An export is already queued or running.') : err instanceof Error ? err.message : String(err), variant: 'destructive' });
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-g13 rounded-lg border border-border bg-card p-g21">
      <div className="flex flex-wrap items-start justify-between gap-g13">
        <div className="min-w-0">
          <Heading as="h3" size="sm" weight="semibold" id={headingId} className="flex items-center gap-g8"><PackageOpen className="size-g16" aria-hidden="true" />{t('data.export.title', 'Export organization data')}</Heading>
          <Text size="sm" className="mt-g5 max-w-prose text-muted-foreground">{t('data.export.desc', 'Download all of this organization\'s records as a ZIP of JSON and CSV files. Secrets are never included.')}</Text>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void exportsQuery.refetch()}><RefreshCw aria-hidden="true" />{t('data.export.refresh', 'Refresh')}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-g13">
        <Checkbox checked={includeFiles} onCheckedChange={(details) => setIncludeFiles(details.checked === true)}>
          <CheckboxControl /><CheckboxLabel>{t('data.export.include_files', 'Include the uploaded files')}</CheckboxLabel><CheckboxHiddenInput />
        </Checkbox>
        <Button type="button" disabled={busy || active} onClick={() => void request()}>
          {busy ? t('data.export.requesting', 'Requesting…') : t('data.export.request', 'Request export')}
        </Button>
      </div>
      <Text size="xs" className="text-muted-foreground">{t('data.export.include_files_hint', 'Adds every stored file to the ZIP. This can make the export much larger and slower.')}</Text>

      <Heading as="h4" size="xs" weight="semibold">{t('data.export.history', 'Recent exports')}</Heading>
      {exportsQuery.isError ? (
        <Alert status="error" role="alert">
          <AlertIndicator />
          <AlertContent><AlertDescription>{t('data.export.load_failed', 'Exports could not be loaded.')}</AlertDescription></AlertContent>
          <AlertActions><Button variant="outline" size="sm" onClick={() => void exportsQuery.refetch()}>{t('tb.retry', 'Retry')}</Button></AlertActions>
        </Alert>
      ) : exportsQuery.isLoading ? (
        <Skeleton height={64} />
      ) : jobs.length === 0 ? (
        <Text size="sm" className="text-muted-foreground">{t('data.export.none', 'No exports yet.')}</Text>
      ) : (
        <TableScrollArea>
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader>{t('data.export.col_requested', 'Requested')}</TableColumnHeader>
                <TableColumnHeader>{t('data.export.col_status', 'Status')}</TableColumnHeader>
                <TableColumnHeader>{t('data.export.col_size', 'Size')}</TableColumnHeader>
                <TableColumnHeader>{t('data.export.col_expires', 'Link expires')}</TableColumnHeader>
                <TableColumnHeader>{t('data.export.col_action', 'Download')}</TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>{formatTime(job.createdAt)}{job.includeFiles && <Text as="span" size="xs" className="ml-g8 text-muted-foreground">({t('data.export.with_files', 'with files')})</Text>}</TableCell>
                  <TableCell>
                    <Badge tone={TONE[job.status]}>{t(`data.export.status.${job.status}`, job.status)}</Badge>
                    {job.status === 'failed' && job.error && <Text size="xs" tone="destructive" className="mt-g3">{job.error}</Text>}
                  </TableCell>
                  <TableCell>{formatBytes(job.sizeBytes)}</TableCell>
                  <TableCell>{job.status === 'succeeded' ? formatTime(job.expiresAt) : '—'}</TableCell>
                  <TableCell>
                    {job.downloadUrl && (
                      <Button asChild size="sm" variant="outline"><a href={job.downloadUrl} download><Download aria-hidden="true" />{t('data.export.download', 'Download ZIP')}</a></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScrollArea>
      )}
    </section>
  );
};
