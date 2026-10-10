import React, { useState, useRef, useCallback, useMemo } from 'react';
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
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTenantSettings, type TenantPolicyView } from '../context/TenantSettingsContext';
import { downloadCsv, parseCSV } from '../lib/csv';
import { PRICING_MODELS } from '@legalio/types';
import { Partner, Contract, InsertionOrder } from '@legalio/types';

import { Button } from '@legalio/ui-components/button';
import { Table, TableHeader, TableRow, TableColumnHeader, TableBody, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
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
  userEmail: string;
  userName: string;
  userRole: string;
}

// ─── CSV Templates ─────────────────────────────────────────────────────────────

interface ImportTemplate { headers: string[]; example: string[]; notes: string[] }

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
        'nama_partner', 'partner_channel', 'internal_pic', 'jenis_partner', 'pic_partner', 'nama_pic', 'email_pic',
        'telepon_pic', 'alamat_pic', 'country', 'entity_type', 'identifiers', 'catatan', 'tags',
      ],
      example: [
        partnerName, category, 'Procurement', 'Vendor', contactName, contactName, 'contact@contoh.example.com',
        phone, 'Jl. Contoh No. 1, Jakarta 10110', country, legalForm, identifiers, 'Preferred vendor', category,
      ],
      notes: [
        'identifiers: "scheme:value" pairs separated by ";", e.g. ' + (identifiers || 'id_npwp:01.234.567.8-012.000') + '.',
        'tags: separated by ";". country: ISO 3166-1 alpha-2 code.',
        'Partners with the same name that already exist are skipped.',
      ],
    },
    contracts: {
      headers: [
        'nomor_kontrak', 'judul_kontrak', 'partner_nama', 'jenis_dokumen', 'parent_contract_nomor', 'kategori_kerjasama',
        'tanggal_mulai', 'tanggal_berakhir', 'currency', 'nilai_kontrak', 'auto_renewal', 'status_approval',
        'notice_period_hari', 'notice_type_required', 'pic_internal', 'internal_notes',
      ],
      example: [
        'MSA/2026/001', 'Master Services Agreement', partnerName, 'Master Agreement', '', category,
        '2026-01-01', '2026-12-31', currency, '1200000000', 'Ya', 'Signed', '30', 'Both', 'Legal', 'Annual agreement',
      ],
      notes: [
        'jenis_dokumen: Master Agreement or Agreement Addendum. An addendum needs parent_contract_nomor of an existing contract.',
        'status_approval: Draft, Review, Signed or Active. notice_type_required: Termination, Extension, Both or None.',
        'auto_renewal: Ya/Yes/True or Tidak/No. kategori_kerjasama: separated by ";". partner_nama must match an existing partner.',
      ],
    },
    ios: {
      headers: [
        'nomor_io', 'judul_io', 'partner_nama', 'contract_nomor', 'kanal_media',
        'tanggal_mulai', 'tanggal_berakhir', 'pricing_model', 'charging_type', 'currency',
        'nilai_io', 'deliverables', 'notice_period_hari', 'notice_type_required', 'internal_notes',
      ],
      example: [
        'BMD/IO/2026/001', `${orderLabel} 2026`, partnerName, 'MSA/2026/001', 'Managed service',
        '2026-01-01', '2026-12-31', 'Fixed', 'Postpaid', currency, '300000000',
        'Monthly service delivery', '14', 'Termination', '',
      ],
      notes: [
        `pricing_model: ${PRICING_MODELS.join(', ')} (other values are kept as a custom model).`,
        'charging_type: Prepaid, Postpaid or Milestone-based. contract_nomor must match an existing contract.',
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
      notes: [
        'All five rating columns are required. obligation_target: Met, Not met, Sangat baik, Baik, Kurang baik.',
        'incident_frequency: Never, Rare, Frequent. communication: Good, Poor/Needs Improvement, Sangat baik, Baik, Kurang baik.',
        'pricing: Cheap, Moderate, Expensive. final_evaluation: Recommended, Recommended with notes, Not recommended, Not reviewed.',
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
      notes: [
        'invoice_month: YYYY-MM, several months separated by ";". The USD amount is calculated from currency.',
        'vendor_name must match an existing partner to be linked to it.',
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
  userEmail,
  userName,
  userRole,
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const IMPORT_TYPES: { id: ImportType; label: string; icon: React.FC<{ className?: string }>; color: string }[] = [
    { id: 'partners',    label: t('import.type_partner',    'Partner'),           icon: Building2,     color: 'text-accent-foreground' },
    { id: 'contracts',   label: t('import.type_contract',   'Contract'),          icon: FileText,      color: 'text-status-info'  },
    { id: 'ios',         label: t('import.type_io',         'IO'),                icon: FileSpreadsheet, color: 'text-status-special' },
    { id: 'evaluations', label: t('import.type_evaluation', 'Evaluation'),        icon: ClipboardCheck, color: 'text-status-warning ' },
    { id: 'spendings',   label: t('import.type_spending',   'Spending'),          icon: CreditCard,    color: 'text-status-danger'  },
  ];

  const handleTypeChange = (type: ImportType) => {
    setActiveType(type);
    setParsedRows(null);
    setParsedHeaders([]);
    setFileName('');
    setParseError('');
    setReport(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setReport(null);
    setParseError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCSV(text);
      if (!result || result.rows.length === 0) {
        setParseError(t('import.invalid_csv', 'Format CSV tidak valid atau file kosong.'));
        setParsedRows(null);
        return;
      }
      setParsedHeaders(result.headers);
      setParsedRows(result.rows);
    };
    reader.readAsText(file);
  }, [t]);

  const handleImport = async () => {
    if (!parsedRows || parsedRows.length === 0) return;
    setIsImporting(true);
    setReport(null);
    try {
      const res = await fetch('/api/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activeType,
          rows: parsedRows,
          userEmail,
          userName,
          userRole,
        }),
      });
      const data = await res.json();
      if (res.ok) { setReport(data); onRefreshData(); }
      else { setParseError(data.error || 'Import gagal.'); }
    } catch (err: any) {
      setParseError(err.message || 'Import gagal.');
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const activeTypeInfo = IMPORT_TYPES.find((item) => item.id === activeType)!;

  const RESULT_SECTIONS = [
    {
      key: 'succeeded' as const,
      label: t('import.succeeded', 'Berhasil Dibuat'),
      items: report?.succeeded ?? [],
      count: report?.succeeded.length ?? 0,
      rowClass: 'text-accent-foreground ',
      headerBg: 'bg-primary ',
      pillBg: 'bg-primary border-primary/30',
      icon: <CheckCircle2 className="w-4 h-4 text-accent-foreground" />,
      pillIcon: <CheckCircle2 className="w-6 h-6 text-accent-foreground mb-1" />,
    },
    {
      key: 'skipped' as const,
      label: t('import.skipped', 'Dilewati (Duplikat)'),
      items: report?.skipped ?? [],
      count: report?.skipped.length ?? 0,
      rowClass: 'text-status-warning ',
      headerBg: 'bg-status-warning-soft ',
      pillBg: 'bg-status-warning-soft  border-status-warning-border ',
      icon: <AlertTriangle className="w-4 h-4 text-status-warning" />,
      pillIcon: <AlertTriangle className="w-6 h-6 text-status-warning mb-1" />,
    },
    {
      key: 'failed' as const,
      label: t('import.failed', 'Gagal Diimpor'),
      items: report?.failed ?? [],
      count: report?.failed.length ?? 0,
      rowClass: 'text-status-danger ',
      headerBg: 'bg-status-danger-soft ',
      pillBg: 'bg-status-danger-soft  border-status-danger-border ',
      icon: <XCircle className="w-4 h-4 text-status-danger" />,
      pillIcon: <XCircle className="w-6 h-6 text-status-danger mb-1" />,
    },
  ];

  return (
    <div className="flex flex-col gap-6 animate-in fade-in-50 duration-200">

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <Card className="flex-row flex-wrap items-center justify-between gap-4 p-6">
        <Heading as="h2" size="lg" weight="semibold">
          {t('import.title', 'Import Data Massal (Excel / CSV)')}
        </Heading>
      </Card>

      {/* ── Type Selector ────────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="mobile-page-actions flex flex-wrap gap-2">
          {IMPORT_TYPES.map((item) => {
            const Icon = item.icon;
            const isActive = activeType === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTypeChange(item.id)}
                aria-pressed={isActive}
                className={` cursor-pointer ${
 isActive
 ? ''
 : ''
 }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.color}`} />
                <span>{item.label}</span>
                {isActive && <ChevronRight className="w-3.5 h-3.5 text-white" />}
              </button>
            );
          })}
        </div>
      </Card>

      {/* ── Template Download + Upload ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">

        {/* Template Download */}
        <Card className="p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent bg-status-info-soft border border-status-info-border">
                <Download className="w-5 h-5 text-status-info" />
              </div>
              <div>
                <Heading as="h3" size="sm" weight="semibold">
                  {t('import.download_template', 'Unduh Template CSV')}
                </Heading>
              </div>
            </div>

            <Card className="p-3">
              <p className="text-xs font-bold uppercase text-muted-foreground mb-2">{t('bulk_import.kolom_template', 'Kolom Template:')}</p>
              <div className="flex flex-wrap gap-1.5">
                {templates[activeType].headers.map((h) => (
                  <span
                    key={h}
                    className="text-xs font-semibold bg-card text-muted-foreground border border-border px-2 py-0.5 rounded-md"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </Card>

            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {templates[activeType].notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>

          <div className="pt-4 mt-auto">
            <Button variant="outline"
              type="button"
              onClick={() => downloadTemplate(activeType, templates[activeType])}
              className="w-full"
            >
              <Download className="w-4 h-4" />
              <span>
                {t('bulk_import.download_template', 'Download {label} Template', { label: activeTypeInfo.label })}
              </span>
            </Button>
          </div>
        </Card>

        {/* Upload */}
        <Card className="p-6 flex flex-col justify-between">
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent bg-primary border border-primary/30">
                <Upload className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <Heading as="h3" size="sm" weight="semibold">
                  {t('import.upload_label', 'Unggah File CSV')}
                </Heading>
              </div>
            </div>

            <label className="ds-upload flex w-full min-h-32 flex-1 flex-col items-center justify-center text-center cursor-pointer group">
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
              <FileSpreadsheet className="w-8 h-8 text-muted-foreground mx-auto mb-2 group-hover:text-accent-foreground/60 transition-colors" />
              {fileName
                ? <p className="text-xs font-bold text-accent-foreground truncate px-2">{fileName}</p>
                : <p className="text-xs font-semibold text-muted-foreground">{t('import.choose_file', 'Pilih File CSV')} {t('bulk_import.csv', '(.csv)')}</p>
              }
            </label>

            {parseError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-status-danger-soft border border-status-danger-border text-xs text-status-danger font-medium">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}

            {parsedRows && parsedRows.length > 0 && !parseError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-primary border border-primary/30 text-xs text-accent-foreground font-bold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{parsedRows.length} {t('import.preview_rows', 'baris data ditemukan')}</span>
              </div>
            )}
          </div>

          <div className="pt-4 mt-auto">
            <div className="mobile-page-actions flex items-center gap-2">
              <Button
                type="button"
                onClick={handleImport}
                disabled={!parsedRows || parsedRows.length === 0 || isImporting}
                className="flex-1"
              >
                {isImporting
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /><span>{t('import.importing', 'Mengimpor...')}</span></>
                  : <><Upload className="w-4 h-4" /><span>{t('import.start_import', 'Mulai Import')}</span></>
                }
              </Button>
              {(parsedRows || report) && (
                <Button variant="outline" size="icon-md"
                  type="button"
                  onClick={handleReset}
                  title={t('import.reset', 'Reset & Mulai Lagi')}
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ── CSV Preview ──────────────────────────────────────────────────────── */}
      {parsedRows && parsedRows.length > 0 && !report && (
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent size-8 bg-muted">
              <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <Heading as="h3" size="sm" weight="semibold">
                {t('import.preview_title', 'Pratinjau Data CSV')}
              </Heading>
              <p className="text-xs text-muted-foreground">
                {parsedRows.length} {t('import.preview_rows', 'baris data ditemukan')} | {fileName}
              </p>
            </div>
          </div>
          <TableScrollArea className="rounded-none border-0">
            <Table className="w-full text-left">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader className="w-12">#</TableColumnHeader>
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
                      <TableCell key={h} className="max-w-[200px] truncate" title={row[h]}>
                        {row[h] || <span className="text-muted-foreground">-</span>}
                      </TableCell>
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
          <div className="p-6 border-b border-border flex items-center gap-3">
            <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent bg-primary border border-primary/30">
              <FileSpreadsheet className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <Heading as="h3" size="sm" weight="semibold">
                {t('import.result_title', 'Laporan Hasil Import')}
              </Heading>
            </div>
          </div>

          {/* Summary Pills */}
          <div className="p-6 grid grid-cols-3 gap-4">
            {RESULT_SECTIONS.map((s) => (
              <div key={s.key} className={`flex flex-col items-center justify-center p-4 rounded-2xl border gap-1 ${s.pillBg}`}>
                {s.pillIcon}
                <span className={`text-2xl font-extrabold ${s.rowClass}`}>{s.count}</span>
                <span className={`text-xs font-bold text-center ${s.rowClass}`}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Detail Tables per category */}
          {RESULT_SECTIONS.filter((s) => s.items.length > 0).map((section) => (
            <div key={section.key} className="border-t border-border">
              <div className={`px-6 py-3 flex items-center gap-2 ${section.headerBg}`}>
                {section.icon}
                <span className={`text-xs font-extrabold ${section.rowClass}`}>
                  {section.label} ({section.items.length})
                </span>
              </div>
              <TableScrollArea className="rounded-none border-0">
                <Table className="w-full text-left">
                  <TableHeader>
                    <TableRow>
                      <TableColumnHeader className="w-16">{t('import.col_row', 'Baris')}</TableColumnHeader>
                      <TableColumnHeader>{t('import.col_identifier', 'Identifikasi')}</TableColumnHeader>
                      <TableColumnHeader>{t('import.col_reason', 'Keterangan')}</TableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.items.map((item) => (
                      <TableRow key={item.rowIndex}>
                        <TableCell>{item.rowIndex}</TableCell>
                        <TableCell className={` ${section.rowClass} max-w-[250px] truncate`} title={item.identifier}>{item.identifier}</TableCell>
                        <TableCell className="max-w-[400px]">{item.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScrollArea>
            </div>
          ))}

          <div className="p-6 border-t border-border flex justify-end">
            <Button variant="outline" type="button" onClick={handleReset}>
              <RotateCcw className="w-4 h-4" />
              <span>{t('import.reset', 'Reset & Mulai Lagi')}</span>
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};
