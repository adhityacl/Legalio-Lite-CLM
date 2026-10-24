import { bulkImportApi } from '../api/bulkImport';
import { errorMessage } from '../api/client';
import React, { useState, useCallback, useMemo } from 'react';
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Building2,
  FileText,
  ClipboardCheck,
  CreditCard,
  RotateCcw,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTenantSettings, type TenantPolicyView } from '../context/TenantSettingsContext';
import { downloadCsv, parseCSV } from '../lib/csv';
import { Partner, Contract, InsertionOrder } from '@legalio/types';
import { BULK_DATE_FIELDS, bulkDate, bulkDateAmbiguous } from '@legalio/shared/bulkParse';
import { LEGACY_FIELD_NAMES, renameLegacyKeys } from '@legalio/shared/fieldNames';

import { Button } from '@legalio/ui-components/button';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { FileUpload, FileUploadDropzone, FileUploadHiddenInput, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Text } from '@legalio/ui-components/text';
import { Tag } from '@legalio/ui-components/tag';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Spinner } from '@legalio/ui-components/spinner';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'partners' | 'contracts' | 'ios' | 'evaluations' | 'spendings';

interface ImportResult {
  rowIndex: number;
  identifier: string;
  message: string;
}

interface ImportReport {
  succeeded: ImportResult[];
  skipped: ImportResult[];
  failed: ImportResult[];
}

interface BulkImportViewProps {
  partners: Partner[];
  contracts: Contract[];
  ios: InsertionOrder[];
  onRefreshData: () => void;
}

// ─── CSV Templates ─────────────────────────────────────────────────────────────

interface ImportTemplate { headers: string[]; example: string[] }

// Examples follow the active organization's country and industry. All names are fictional
// (example.com, RFC 2606); dates are ISO 8601 and multi-value cells are separated by ";".
function buildTemplates(policy: TenantPolicyView): Record<ImportType, ImportTemplate> {
  const country = policy.country.code;
  const currency = policy.settings.defaultCurrency;
  const indonesia = country === 'ID';
  const partnerName = indonesia ? 'PT Contoh Layanan Digital' : 'Example Services Ltd.';
  const contactName = indonesia ? 'Budi Santoso' : 'Jane Tan';
  const category = policy.industry.partnerCategories[0] || 'Vendor Services';
  const schemes = policy.country.identifierSchemes
    .filter((scheme) => scheme.appliesTo.includes('organization') && scheme.example)
    .slice(0, 2);
  const identifiers = schemes.map((scheme) => `${scheme.key}:${scheme.example}`).join(';');
  const phone = `+${policy.country.callingCode.replace(/^\+/, '')}2150000000`;
  const legalForm = policy.country.legalForms[0] || '';
  const orderLabel = policy.industry.commercialDocument.label;

  return {
    partners: {
      headers: [
        'partner_name', 'partner_channel', 'internal_pic', 'partner_type', 'pic_name', 'pic_email',
        'pic_phone', 'pic_address', 'country', 'entity_type', 'identifiers', 'notes', 'tags',
      ],
      example: [
        partnerName, category, 'Procurement', 'Vendor', contactName, 'contact@contoh.example.com',
        phone, 'Jl. Contoh No. 1, Jakarta 10110', country, legalForm, identifiers, 'Preferred vendor', category,
      ],
    },
    contracts: {
      headers: [
        'contract_number', 'contract_title', 'partner_name', 'document_type', 'parent_contract_number', 'cooperation_categories',
        'start_date', 'end_date', 'currency', 'contract_value', 'auto_renewal', 'status_approval',
        'notice_period_days', 'notice_type_required', 'internal_pic', 'internal_notes',
      ],
      example: [
        'MSA/2026/001', 'Master Services Agreement', partnerName, 'Master Agreement', '', category,
        '2026-01-01', '2026-12-31', currency, '1200000000', 'Ya', 'Signed', '30', 'Both', 'Legal', 'Annual agreement',
      ],
    },
    ios: {
      headers: [
        'io_number', 'io_title', 'partner_name', 'contract_number', 'media_channel',
        'start_date', 'end_date', 'pricing_model', 'charging_type', 'currency',
        'io_value', 'deliverables', 'notice_period_days', 'notice_type_required', 'internal_notes',
      ],
      example: [
        'BMD/IO/2026/001', `${orderLabel} 2026`, partnerName, 'MSA/2026/001', 'Managed service',
        '2026-01-01', '2026-12-31', 'Fixed', 'Postpaid', currency, '300000000',
        'Monthly service delivery', '14', 'Termination', '',
      ],
    },
    evaluations: {
      headers: [
        'supplier_name', 'review_date', 'type_of_work', 'sla_score',
        'obligation_target', 'incident_frequency', 'communication', 'pricing', 'final_evaluation', 'notes',
      ],
      example: [
        partnerName, '2026-06-30', category, '85',
        'Met', 'Rare', 'Good', 'Moderate', 'Recommended', 'Good overall performance',
      ],
    },
    spendings: {
      headers: [
        'vendor_name', 'invoice_number', 'invoice_date', 'invoice_month', 'invoice_title', 'invoice_description',
        'currency', 'total_amount', 'payment_status', 'bank_name', 'bank_account_number', 'bank_account_holder_name',
      ],
      example: [
        partnerName, 'INV/2026/01/0001', '2026-02-03', '2026-01', 'Layanan Januari 2026',
        'Monthly managed service January 2026 incl. VAT', currency, '333000000', 'Unpaid', 'Bank Contoh', '000-000-0000', partnerName,
      ],
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadTemplate(type: ImportType, template: ImportTemplate) {
  downloadCsv(`template_import_${type}.csv`, template.headers, [template.example]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export const BulkImportView: React.FC<BulkImportViewProps> = ({
  partners,
  contracts,
  ios,
  onRefreshData,
}) => {
  const { t, language } = useLanguage();
  const { policy } = useTenantSettings();
  const templates = useMemo(() => buildTemplates(policy), [policy]);

  const [activeType, setActiveType] = useState<ImportType>('partners');
  const [parsedRows, setParsedRows] = useState<Record<string, string>[] | null>(null);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  // FileUpload owns its accepted files; bumping the key clears it on reset.
  const [uploadKey, setUploadKey] = useState(0);

  const IMPORT_TYPES: { id: ImportType; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'partners',    label: t('import.type_partner',    'Partner'),           icon: Building2 },
    { id: 'contracts',   label: t('import.type_contract',   'Contract'),          icon: FileText },
    { id: 'ios',         label: t('import.type_io',         'IO'),                icon: FileSpreadsheet },
    { id: 'evaluations', label: t('import.type_evaluation', 'Evaluation'),        icon: ClipboardCheck },
    { id: 'spendings',   label: t('import.type_spending',   'Spending'),          icon: CreditCard },
  ];

  const handleTypeChange = (type: ImportType) => {
    setActiveType(type);
    setParsedRows(null);
    setParsedHeaders([]);
    setFileName('');
    setParseError('');
    setReport(null);
    setUploadKey(k => k + 1);
  };

  // Distinct (column, text) pairs: problems first, then readings worth a second look, then the rest.
  const datePreview = useMemo(() => {
    const columns = parsedHeaders.filter(header => BULK_DATE_FIELDS.includes(header));
    if (!parsedRows || !columns.length) return null;
    const entries = new Map<string, { column: string; raw: string; iso: string | null; ambiguous: boolean; count: number }>();
    for (const row of parsedRows) for (const column of columns) {
      const raw = (row[column] || '').trim();
      if (!raw) continue;
      const key = `${column}\u0000${raw}`;
      const entry = entries.get(key) || { column, raw, iso: bulkDate(raw) || null, ambiguous: bulkDateAmbiguous(raw), count: 0 };
      entry.count++;
      entries.set(key, entry);
    }
    if (!entries.size) return null;
    const rank = (entry: { iso: string | null; ambiguous: boolean }) => (!entry.iso ? 0 : entry.ambiguous ? 1 : 2);
    const sorted = [...entries.values()].sort((a, b) => rank(a) - rank(b));
    const shown = sorted.slice(0, 12);
    return { shown, hidden: sorted.length - shown.length, hasAmbiguous: sorted.some(entry => entry.ambiguous) };
  }, [parsedRows, parsedHeaders]);

  const handleFileChange = useCallback((file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setReport(null);
    setParseError('');
    // The picker filters by extension, but drag-and-drop does not: only .csv is read.
    if (!/\.csv$/i.test(file.name)) {
      setParsedRows(null);
      setParseError(t('import.invalid_csv', 'Format CSV tidak valid atau file kosong.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCSV(text);
      if (!result || result.rows.length === 0) {
        setParseError(t('import.invalid_csv', 'Format CSV tidak valid atau file kosong.'));
        setParsedRows(null);
        return;
      }
      // CSV files made from the old Indonesian template still import: their headers are mapped to the English names.
      setParsedHeaders(result.headers.map(header => LEGACY_FIELD_NAMES[header] ?? header));
      setParsedRows(result.rows.map(row => renameLegacyKeys(row)));
    };
    reader.readAsText(file);
  }, [t]);

  const handleImport = async () => {
    if (!parsedRows || parsedRows.length === 0) return;
    setIsImporting(true);
    setReport(null);
    try {
      setReport(await bulkImportApi.run({ type: activeType, rows: parsedRows }));
      onRefreshData();
    } catch (err) {
      setParseError(errorMessage(err, 'Import gagal.'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setParsedRows(null);
    setParsedHeaders([]);
    setFileName('');
    setParseError('');
    setReport(null);
    setUploadKey(k => k + 1);
  };

  const activeTypeInfo = IMPORT_TYPES.find((item) => item.id === activeType)!;

  const RESULT_SECTIONS = [
    {
      key: 'succeeded' as const,
      label: t('import.succeeded', 'Berhasil Dibuat'),
      items: report?.succeeded ?? [],
      count: report?.succeeded.length ?? 0,
      rowClass: 'text-accent-foreground ',
      headerBg: 'bg-accent ',
      pillBg: 'bg-accent border-primary/30',
      icon: <CheckCircle2 className="w-g16 h-g16 text-accent-foreground" />,
      pillIcon: <CheckCircle2 className="w-g26 h-g26 text-accent-foreground mb-g3" />,
    },
    {
      key: 'skipped' as const,
      label: t('import.skipped', 'Dilewati (Duplikat)'),
      items: report?.skipped ?? [],
      count: report?.skipped.length ?? 0,
      rowClass: 'text-status-warning ',
      headerBg: 'bg-status-warning-soft ',
      pillBg: 'bg-status-warning-soft  border-status-warning-border ',
      icon: <AlertTriangle className="w-g16 h-g16 text-status-warning" />,
      pillIcon: <AlertTriangle className="w-g26 h-g26 text-status-warning mb-g3" />,
    },
    {
      key: 'failed' as const,
      label: t('import.failed', 'Gagal Diimpor'),
      items: report?.failed ?? [],
      count: report?.failed.length ?? 0,
      rowClass: 'text-status-danger ',
      headerBg: 'bg-status-danger-soft ',
      pillBg: 'bg-status-danger-soft  border-status-danger-border ',
      icon: <XCircle className="w-g16 h-g16 text-status-danger" />,
      pillIcon: <XCircle className="w-g26 h-g26 text-status-danger mb-g3" />,
    },
  ];

  return (
    <div className="flex flex-col gap-g21 animate-in fade-in-50 duration-200">

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <Heading as="h2" size="md" weight="semibold">
          {t('import.title', 'Import Data Massal (CSV)')}
        </Heading>
      </div>

      {/* ── Type Selector ────────────────────────────────────────────────────── */}
      <Tabs value={activeType} onValueChange={details => handleTypeChange(details.value as ImportType)} className="gap-g21">
      <Card className="flex-row flex-wrap items-center gap-g13 p-g13">
        <TabsList aria-label={t('import.type_label', 'Jenis data')} className="w-full sm:w-auto">
          {IMPORT_TYPES.map(item => {
            const Icon = item.icon;
            return <TabsTrigger key={item.id} value={item.id}><Icon aria-hidden="true" />{item.label}</TabsTrigger>;
          })}
        </TabsList>
      </Card>

      <TabsContent value={activeType} className="mt-0 flex flex-col gap-g21">
      {/* ── Template Download + Upload ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-g13 items-stretch">

        {/* Template Download */}
        <Card className="h-g377 p-g21 flex flex-col justify-between">
          <div className="flex min-h-0 flex-1 flex-col gap-g13">
            <div className="flex items-center gap-g13">
              <Avatar size="md" className="shrink-0 rounded-md border bg-status-info-soft border border-status-info-border"><AvatarFallback className="bg-transparent text-inherit"><Download className="w-g21 h-g21 text-status-info" /></AvatarFallback></Avatar>
              <div>
                <Heading as="h3" size="sm" weight="semibold">
                  {t('import.download_template', 'Unduh Template CSV')}
                </Heading>
              </div>
            </div>

            <Card variant="subtle" size="sm" className="min-h-0 flex-1 gap-g8 overflow-y-auto p-g13">
              <Text size="xs" weight="semibold" tone="muted">{t('bulk_import.kolom_template', 'Kolom Template:')}</Text>
              <div className="flex flex-wrap gap-g5">
                {templates[activeType].headers.map((h) => <Tag key={h} size="sm" variant="outline">{h}</Tag>)}
              </div>
            </Card>

          </div>

          <div className="flex min-h-g55 shrink-0 items-end pt-g13">
            <Button variant="outline"
              type="button"
              onClick={() => downloadTemplate(activeType, templates[activeType])}
              className="w-full whitespace-normal"
            >
              <Download className="w-g16 h-g16" />
              <span>
                {t('bulk_import.download_template', 'Download {label} Template', { label: activeTypeInfo.label })}
              </span>
            </Button>
          </div>
        </Card>

        {/* Upload */}
        <Card className="h-g377 p-g21 flex flex-col justify-between">
          <div className="flex min-h-0 flex-1 flex-col gap-g13 overflow-y-auto">
            <div className="flex items-center gap-g13">
              <Avatar size="md" className="shrink-0 rounded-md border bg-accent border border-primary/30"><AvatarFallback className="bg-transparent text-inherit"><Upload className="w-g21 h-g21 text-accent-foreground" /></AvatarFallback></Avatar>
              <div>
                <Heading as="h3" size="sm" weight="semibold">
                  {t('import.upload_label', 'Unggah File CSV')}
                </Heading>
              </div>
            </div>

            <FileUpload key={uploadKey} accept=".csv,text/csv" maxFiles={1} onFileAccept={details => handleFileChange(details.files[0])} onFileReject={() => { setParsedRows(null); setReport(null); setParseError(t('import.csv_only', 'Hanya file .csv yang dapat diimpor. Simpan file Excel atau Google Sheets sebagai CSV terlebih dahulu.')); }} className="min-h-0 flex-1">
              <FileUploadDropzone aria-label={t('import.choose_file', 'Pilih File CSV')} className="min-h-g144 flex-1">
                <FileSpreadsheet className="size-g34 text-muted-foreground" aria-hidden="true" />
                {fileName
                  ? <Text size="xs" weight="semibold" className="truncate px-g8 text-accent-foreground">{fileName}</Text>
                  : <Text size="xs" tone="muted">{t('import.choose_file', 'Pilih File CSV')} {t('bulk_import.csv', '(.csv)')}</Text>}
                <FileUploadTrigger asChild><Button variant="outline" size="sm">{t('form.contract.choose_file', 'Pilih File')}</Button></FileUploadTrigger>
              </FileUploadDropzone>
              <FileUploadHiddenInput aria-label={t('import.upload_label', 'Unggah File CSV')} />
            </FileUpload>

            {parseError && (
              <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{parseError}</AlertDescription></AlertContent></Alert>
            )}

            {parsedRows && parsedRows.length > 0 && !parseError && (
              <Alert status="success" role="status"><AlertIndicator /><AlertContent><AlertDescription>{parsedRows.length} {t('import.preview_rows', 'baris data ditemukan')}</AlertDescription></AlertContent></Alert>
            )}
          </div>

          <div className="flex min-h-g55 shrink-0 items-end pt-g13">
            <div className="flex w-full items-center gap-g8">
              <Button
                type="button"
                onClick={() => void handleImport()}
                disabled={!parsedRows || parsedRows.length === 0 || isImporting}
                className="flex-1"
              >
                {isImporting
                  ? <><Spinner size="sm" decorative /><span>{t('import.importing', 'Mengimpor...')}</span></>
                  : <><Upload className="w-g16 h-g16" /><span>{t('import.start_import', 'Mulai Import')}</span></>
                }
              </Button>
              {(parsedRows || report) && (
                <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon-md"
                  type="button"
                  onClick={handleReset} aria-label={t('import.reset', 'Reset & Mulai Lagi')}
                >
                  <RotateCcw className="w-g16 h-g16" />
                </Button></TooltipTrigger><TooltipBody>{t('import.reset', 'Reset & Mulai Lagi')}</TooltipBody></Tooltip>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ── Date Preview: how each distinct date in the file will be read ─────── */}
      {datePreview && !report && (
        <Card className="overflow-hidden" id="import-date-preview">
          <div className="p-g13 border-b border-border">
            <Heading as="h3" size="sm" weight="semibold">{t('import.date_preview_title', 'Pratinjau Tanggal')}</Heading>
            <Text size="xs" tone="muted">{t('import.date_preview_hint', 'Beginilah tanggal di file Anda akan dibaca. Periksa urutan hari dan bulan sebelum import.')}</Text>
          </div>
          <TableScrollArea>
            <Table className="w-full text-left">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader>{t('import.date_column', 'Kolom')}</TableColumnHeader>
                  <TableColumnHeader>{t('import.date_in_file', 'Di file')}</TableColumnHeader>
                  <TableColumnHeader>{t('import.date_read_as', 'Dibaca sebagai')}</TableColumnHeader>
                  <TableColumnHeader>{t('import.date_rows', 'Baris')}</TableColumnHeader>
                  <TableColumnHeader>{t('import.date_status', 'Status')}</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datePreview.shown.map((entry) => (
                  <TableRow key={`${entry.column}|${entry.raw}`}>
                    <TableCell className="whitespace-nowrap">{entry.column}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono">{entry.raw}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {entry.iso ? new Date(`${entry.iso}T00:00:00Z`).toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '-'}
                    </TableCell>
                    <TableCell>{entry.count}</TableCell>
                    <TableCell>
                      {!entry.iso
                        ? <span className="text-status-danger">{t('import.date_invalid', 'Tidak valid, baris ditolak')}</span>
                        : entry.ambiguous
                          ? <span className="text-status-warning">{t('import.date_check', 'Hari/bulan/tahun, periksa')}</span>
                          : <span className="text-status-success">{t('import.date_ok', 'Sesuai')}</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {datePreview.hidden > 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center">
                      {t('bulk_import.dan', '... dan')} {datePreview.hidden} {t('import.date_more', 'tanggal lainnya yang sesuai')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableScrollArea>
          {datePreview.hasAmbiguous && (
            <Alert status="warning" role="note" className="m-g13"><AlertIndicator /><AlertContent><AlertDescription>
              {t('import.date_ambiguous_note', 'Tanggal berformat DD/MM/YYYY dibaca sebagai hari/bulan/tahun. Jika file dibuat dengan pengaturan wilayah Amerika (bulan/hari/tahun), simpan ulang dengan tanggal berformat YYYY-MM-DD.')}
            </AlertDescription></AlertContent></Alert>
          )}
        </Card>
      )}

      {/* ── CSV Preview ──────────────────────────────────────────────────────── */}
      {parsedRows && parsedRows.length > 0 && !report && (
        <Card className="overflow-hidden">
          <div className="p-g13 border-b border-border flex items-center gap-g13">
            <Avatar size="md" className="shrink-0 rounded-md border bg-muted"><AvatarFallback className="bg-transparent text-inherit"><FileSpreadsheet className="w-g16 h-g16 text-muted-foreground" /></AvatarFallback></Avatar>
            <div>
              <Heading as="h3" size="sm" weight="semibold">
                {t('import.preview_title', 'Pratinjau Data CSV')}
              </Heading>
              <Text size="xs" tone="muted">
                {parsedRows.length} {t('import.preview_rows', 'baris data ditemukan')} | {fileName}
              </Text>
            </div>
          </div>
          <TableScrollArea>
            <Table className="w-full text-left">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader className="w-g42">#</TableColumnHeader>
                  {parsedHeaders.map((h) => (
                    <TableColumnHeader key={h} className="whitespace-nowrap">{h}</TableColumnHeader>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedRows.slice(0, 20).map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>
                    {parsedHeaders.map((h) => (
                      <Tooltip key={h}><TooltipTrigger asChild><TableCell className="max-w-g233 truncate">
                        {row[h] || <span className="text-muted-foreground">-</span>}
                      </TableCell></TooltipTrigger><TooltipBody>{row[h]}</TooltipBody></Tooltip>
                    ))}
                  </TableRow>
                ))}
                {parsedRows.length > 20 && (
                  <TableRow>
                    <TableCell colSpan={parsedHeaders.length + 1} className="text-center">
                      {t('bulk_import.dan', '... dan')} {parsedRows.length - 20} {t('bulk_import.baris_lainnya_tidak_ditampilkan_di_pratinjau', 'baris lainnya tidak ditampilkan di pratinjau')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableScrollArea>
        </Card>
      )}

      {/* ── Import Result Report ─────────────────────────────────────────────── */}
      {report && (
        <Card className="overflow-hidden">
          <div className="p-g21 border-b border-border flex items-center gap-g13">
            <Avatar size="md" className="shrink-0 rounded-md border bg-accent border border-primary/30"><AvatarFallback className="bg-transparent text-inherit"><FileSpreadsheet className="w-g21 h-g21 text-accent-foreground" /></AvatarFallback></Avatar>
            <div>
              <Heading as="h3" size="sm" weight="semibold">
                {t('import.result_title', 'Laporan Hasil Import')}
              </Heading>
            </div>
          </div>

          {/* Summary Pills */}
          <div className="p-g21 grid grid-cols-3 gap-g13">
            {RESULT_SECTIONS.map((s) => (
              <Card key={s.key} className={`flex flex-col items-center justify-center p-g13 gap-g3 ${s.pillBg}`}>
                {s.pillIcon}
                <span className={`text-2xl font-extrabold ${s.rowClass}`}>{s.count}</span>
                <span className={`text-xs font-bold text-center ${s.rowClass}`}>{s.label}</span>
              </Card>
            ))}
          </div>

          {/* Detail Tables per category */}
          {RESULT_SECTIONS.filter((s) => s.items.length > 0).map((section) => (
            <div key={section.key} className="border-t border-border">
              <div className={`px-g21 py-g13 flex items-center gap-g8 ${section.headerBg}`}>
                {section.icon}
                <span className={`text-xs font-extrabold ${section.rowClass}`}>
                  {section.label} ({section.items.length})
                </span>
              </div>
              <TableScrollArea>
                <Table className="w-full text-left">
                  <TableHeader>
                    <TableRow>
                      <TableColumnHeader className="w-g68">{t('import.col_row', 'Baris')}</TableColumnHeader>
                      <TableColumnHeader>{t('import.col_identifier', 'Identifikasi')}</TableColumnHeader>
                      <TableColumnHeader>{t('import.col_reason', 'Keterangan')}</TableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.items.map((item) => (
                      <TableRow key={item.rowIndex}>
                        <TableCell>{item.rowIndex}</TableCell>
                        <Tooltip><TooltipTrigger asChild><TableCell className={` ${section.rowClass} max-w-g233 truncate`}>{item.identifier}</TableCell></TooltipTrigger><TooltipBody>{item.identifier}</TooltipBody></Tooltip>
                        <TableCell className="max-w-g377">{item.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScrollArea>
            </div>
          ))}

          <div className="p-g21 border-t border-border flex justify-end">
            <Button variant="outline" type="button" onClick={handleReset}>
              <RotateCcw className="w-g16 h-g16" />
              <span>{t('import.reset', 'Reset & Mulai Lagi')}</span>
            </Button>
          </div>
        </Card>
      )}
      </TabsContent>
      </Tabs>
    </div>
  );
};
