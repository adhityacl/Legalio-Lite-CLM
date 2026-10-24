import { HierarchyTreeView } from './HierarchyTreeView';
import React, { useState } from 'react';
import { downloadCsv } from '../lib/csv';

import { usePermissions } from '../lib/permissions';
import { WorkspaceDocumentCalendar } from '../features/calendar/WorkspaceDocumentCalendar';
import { TableEmptyState } from './ui/table-empty-state';


export const INITIAL_COLUMNS = [
  { id: 'vendorName', label: 'Nama Vendor', group: 'Vendor' },
  { id: 'vendorType', label: 'Jenis Partner', group: 'Vendor' },
  { id: 'vendorChannelName', label: 'Vendor Category', group: 'Vendor' },
  { id: 'vendorCodename', label: 'Channel Name', group: 'Vendor' },
  { id: 'vendorStatus', label: 'Status Vendor', group: 'Vendor' },
  { id: 'vendorStartDate', label: 'Start Date Vendor', group: 'Vendor' },
  { id: 'vendorEndDate', label: 'End Date Vendor', group: 'Vendor' },
  { id: 'vendorDuration', label: 'Durasi Aktif Vendor', group: 'Vendor' },
  { id: 'vendorPicName', label: 'PIC Name', group: 'Vendor' },
  { id: 'vendorPicEmail', label: 'PIC Email', group: 'Vendor' },
  { id: 'vendorPicPhone', label: 'PIC Phone', group: 'Vendor' },
  { id: 'vendorPicAlamat', label: 'PIC Alamat', group: 'Vendor' },
  { id: 'vendorPicInternal', label: 'PIC Internal', group: 'Vendor' },
  { id: 'vendorBadanHukum', label: 'Country', group: 'Vendor' },
  { id: 'vendorStatusDD', label: 'Status Due Diligence', group: 'Vendor' },
  { id: 'vendorLinkNDA', label: 'Link NDA', group: 'Vendor' },
  { id: 'vendorLinkCOR', label: 'Link Tax Residence Certificate', group: 'Vendor' },
  { id: 'vendorLinkDGT', label: 'Link Treaty Relief Form', group: 'Vendor' },
  { id: 'vendorLinkTermination', label: 'Link Termination Notice', group: 'Vendor' },
  { id: 'vendorLinkAssessment', label: 'Link Vendor Assessment', group: 'Vendor' },
  { id: 'vendorLinkPlacement', label: 'Link Placement Doc', group: 'Vendor' },
  { id: 'vendorLinkInvoice', label: 'Link Invoice & Billing', group: 'Vendor' },
  { id: 'vendorLinkNIB', label: 'Link Business Registration', group: 'Vendor' },
  { id: 'vendorLinkLicense', label: 'Link Business License', group: 'Vendor' },
  { id: 'vendorLinkNPWP', label: 'Link Tax Registration', group: 'Vendor' },
  { id: 'vendorLinkAkta', label: 'Link Incorporation Deed / Certificate', group: 'Vendor' },

  { id: 'evalReviewDate', label: 'Tanggal Review Evaluasi', group: 'Evaluation' },
  { id: 'evalTypeOfWork', label: 'Jenis Pekerjaan (Eval)', group: 'Evaluation' },
  { id: 'evalSlaScore', label: 'Skor SLA', group: 'Evaluation' },
  { id: 'evalObligation', label: 'Target Kewajiban', group: 'Evaluation' },
  { id: 'evalIncident', label: 'Frekuensi Insiden', group: 'Evaluation' },
  { id: 'evalCommunication', label: 'Komunikasi', group: 'Evaluation' },
  { id: 'evalPricing', label: 'Kesesuaian Harga', group: 'Evaluation' },
  { id: 'evalFinal', label: 'Evaluasi Final', group: 'Evaluation' },
  { id: 'evalNotes', label: 'Catatan Evaluasi', group: 'Evaluation' },

  { id: 'spendInvoiceNo', label: 'Nomor Invoice', group: 'Spending' },
  { id: 'spendInvDate', label: 'Tanggal Invoice', group: 'Spending' },
  { id: 'spendAmount', label: 'Nominal Spending', group: 'Spending' },
  { id: 'spendInvoiceDesc', label: 'Invoice Description', group: 'Spending' },
  { id: 'spendInvoiceLink', label: 'Link Invoice', group: 'Spending' },
  { id: 'spendBillingLink', label: 'Link Billing', group: 'Spending' },

  { id: 'contractNo', label: 'Nomor Kontrak', group: 'Contract' },
  { id: 'contractTitle', label: 'Judul Kontrak', group: 'Contract' },
  { id: 'contractStatus', label: 'Status Kontrak', group: 'Contract' },
  { id: 'contractStartDate', label: 'Start Date Kontrak', group: 'Contract' },
  { id: 'contractEndDate', label: 'End Date Kontrak', group: 'Contract' },
  { id: 'contractDuration', label: 'Durasi Kontrak', group: 'Contract' },
  { id: 'contractValue', label: 'Nilai Kontrak', group: 'Contract' },
  { id: 'contractKategori', label: 'Kategori Kerjasama', group: 'Contract' },
  { id: 'contractAutoRenewal', label: 'Auto Renewal', group: 'Contract' },
  { id: 'contractNoticePeriod', label: 'Notice Period (Hari)', group: 'Contract' },
  { id: 'contractStatusApproval', label: 'Status Approval Kontrak', group: 'Contract' },
  { id: 'contractInternalNotes', label: 'Internal Notes', group: 'Contract' },
  { id: 'contractLink', label: 'Link Dok. Kontrak', group: 'Contract' },

  { id: 'ioNo', label: 'Nomor IO', group: 'IO' },
  { id: 'ioTitle', label: 'Judul IO', group: 'IO' },
  { id: 'ioStatus', label: 'Status IO', group: 'IO' },
  { id: 'ioChannel', label: 'Kanal Media', group: 'IO' },
  { id: 'ioStartDate', label: 'Start Date IO', group: 'IO' },
  { id: 'ioEndDate', label: 'End Date IO', group: 'IO' },
  { id: 'ioDuration', label: 'Durasi IO', group: 'IO' },
  { id: 'ioPricingModel', label: 'Pricing Model IO', group: 'IO' },
  { id: 'ioChargingType', label: 'Charging Type IO', group: 'IO' },
  { id: 'ioDeliverables', label: 'Deliverables', group: 'IO' },
  { id: 'ioValue', label: 'Nilai IO', group: 'IO' },
  { id: 'ioLink', label: 'Link Dok. IO', group: 'IO' },
];

import { Partner, Contract, InsertionOrder, PartnerEvaluation, PartnerSpending } from '@legalio/types';
import { convertToUsdWithFallback, getActiveFormattingLocale } from '@legalio/shared/currencyUtils';

/** Requirement keys (all country packs) grouped for the generic Explore columns. */
const BUSINESS_REGISTRATION_KEYS = ['id_nib', 'sg_bizfile', 'my_ssm_profile', 'th_dbd_affidavit', 'vn_erc', 'ph_sec_certificate', 'ph_business_permit', 'in_incorporation', 'jp_registry_certificate', 'kr_business_registration', 'kr_corporate_registry', 'cn_business_licence', 'hk_br_certificate', 'ae_trade_licence', 'certificate_of_incorporation'];
const TAX_REGISTRATION_KEYS = ['id_npwp', 'sg_gst_certificate', 'my_sst_certificate', 'th_vat_certificate', 'ph_bir_2303', 'in_gst_certificate', 'in_pan_card', 'jp_invoice_registration', 'ae_vat_certificate', 'tax_registration'];
const INCORPORATION_KEYS = ['id_akta', 'hk_incorporation', 'in_incorporation', 'certificate_of_incorporation'];
import { useLanguage } from '../context/LanguageContext';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { FileSpreadsheet, Search, GitFork, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, FileDown, CalendarDays } from 'lucide-react';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Button } from '@legalio/ui-components/button';
import { Table, TableBody, TableCell, TableColumnHeader, TableHeader, TableRow, TableScrollArea } from '@legalio/ui-components/table';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';

import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuItemGroup, MenuItemGroupLabel, MenuItemIndicator, MenuItemText, MenuPositioner, MenuSeparator, MenuTrigger, MenuViewport } from '@legalio/ui-components/menu';
import { Toggle } from '@legalio/ui-components/toggle';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';

interface HierarchyTreemapViewProps {
  partners: Partner[];
  contracts: Contract[];
  ios: InsertionOrder[];
  evaluations?: PartnerEvaluation[];
  spendings?: PartnerSpending[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onOpenCalendarDocument: (kind: 'contract' | 'io', id: string) => void;
  /** Opens an obligation shown on the calendar. */
  onOpenCalendarObligation?: (id: string) => void;
  onOpenAddPartner: () => void;
  onOpenAddContract: (partnerId?: string) => void;
  onOpenAddIO: (contractId?: string, partnerId?: string) => void;
  onSelectPartner: (partner: Partner) => void;
  onSelectContract: (contract: Contract) => void;
  onSelectIO: (io: InsertionOrder) => void;
}

const INITIAL_AUDIT_COLS: Record<string, boolean> = {
  vendorName: true, vendorType: true, vendorChannelName: true, vendorCodename: false, vendorStatus: true, vendorStartDate: true, vendorEndDate: true, vendorDuration: true, vendorPicName: false, vendorPicEmail: false, vendorPicPhone: false, vendorPicAlamat: false, vendorPicInternal: false, vendorBadanHukum: false, vendorStatusDD: false, vendorLinkNDA: false, vendorLinkCOR: false, vendorLinkDGT: false, vendorLinkTermination: false, vendorLinkAssessment: false, vendorLinkPlacement: false, vendorLinkInvoice: false, vendorLinkNIB: false, vendorLinkLicense: false, vendorLinkNPWP: false, vendorLinkAkta: false,
  evalReviewDate: false, evalTypeOfWork: false, evalSlaScore: false, evalObligation: false, evalIncident: false, evalCommunication: false, evalPricing: false, evalFinal: false, evalNotes: false,
  spendInvoiceNo: false, spendInvDate: false, spendAmount: false, spendInvoiceDesc: false,
  contractNo: true, contractTitle: true, contractStatus: true, contractStartDate: true, contractEndDate: true, contractDuration: true, contractValue: true, contractKategori: false, contractAutoRenewal: false, contractNoticePeriod: false, contractStatusApproval: false, contractInternalNotes: false,
  ioNo: true, ioTitle: true, ioStatus: true, ioChannel: true, ioStartDate: true, ioEndDate: true, ioDuration: true, ioPricingModel: false, ioChargingType: false, ioDeliverables: false, ioValue: true
};

const isVendorActive = (endStr?: string | null) => {
  if (!endStr) return false;
  const end = new Date(endStr);
  if (isNaN(end.getTime())) return false;
  return end.getTime() >= new Date().getTime();
};

export const HierarchyTreemapView: React.FC<HierarchyTreemapViewProps> = ({
  partners,
  contracts,
  ios,
  evaluations = [],
  spendings = [],
  loading,
  error,
  onRetry,
  onOpenCalendarDocument,
  onOpenCalendarObligation,
  onOpenAddPartner,
  onOpenAddContract,
  onOpenAddIO,
  onSelectPartner,
  onSelectContract,
  onSelectIO,
}) => {
  const { t } = useLanguage();
  const { hasPermission } = usePermissions();

  // State
  const [viewMode, setViewMode] = useState<'treemap' | 'audit' | 'calendar'>('treemap');

  // Audit Table State
  const [auditFlatMode, setAuditFlatMode] = useState<boolean>(false);
  const [auditSortConfig, setAuditSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [auditVisibleCols, setAuditVisibleCols] = useState<Record<string, boolean>>(INITIAL_AUDIT_COLS);
  const [columns, setColumns] = useState(INITIAL_COLUMNS);
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [draggedColIdx, setDraggedColIdx] = useState<number | null>(null);
  const [showColPicker, setShowColPicker] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState('');
  return (
    <div className="min-w-0 space-y-g21">
      {/* Top Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <div>
          <Heading as="h2" size="md" weight="semibold">
            <span>{t('hierarchy.title', 'Explore')}</span>
          </Heading>
        </div>
      </div>

      {/* Control toolbar and view switcher */}
      <Tabs value={viewMode} onValueChange={details => setViewMode(details.value as typeof viewMode)} className="flex flex-col gap-g21">
      <Card className="flex-row flex-wrap items-center justify-between gap-g13 p-g13">
        <TabsList aria-label={t('hierarchy.title')} className="w-full sm:w-auto max-sm:grid max-sm:grid-cols-3 [&>[data-slot=tabs-trigger]]:max-sm:min-h-11 [&>[data-slot=tabs-trigger]]:max-sm:h-auto [&>[data-slot=tabs-trigger]]:max-sm:flex-col [&>[data-slot=tabs-trigger]]:max-sm:gap-g3 [&>[data-slot=tabs-trigger]]:max-sm:whitespace-normal [&>[data-slot=tabs-trigger]]:max-sm:px-g3 [&>[data-slot=tabs-trigger]]:max-sm:py-g5">
          <TabsTrigger value="treemap"><GitFork aria-hidden="true" />{t('hierarchy.tree_view', 'Tampilan Pohon')}</TabsTrigger>
          <TabsTrigger value="audit"><FileSpreadsheet aria-hidden="true" />{t('hierarchy.audit_view', 'Tampilan Tabel')}</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarDays aria-hidden="true" />{t('hierarchy.calendar_view')}</TabsTrigger>
        </TabsList>

        {/* Search Input */}
        {viewMode !== 'calendar' && <InputGroup className="relative w-full sm:w-g233 max-sm:min-h-11">
          <InputGroupAddon><Search className="size-g16" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput aria-label={t('hierarchy.search_placeholder', 'Cari partner, nomor kontrak, atau IO...')}
            type="text"
            placeholder={t('hierarchy.search_placeholder', 'Cari partner, nomor kontrak, atau IO...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>}
      </Card>

      <TabsContent value={viewMode} className="mt-0">
      {viewMode === 'calendar' && <WorkspaceDocumentCalendar contracts={contracts} ios={ios} partners={partners}
        loading={loading} error={error} onRetry={onRetry} onOpenDocument={onOpenCalendarDocument} onOpenObligation={onOpenCalendarObligation} />}

      {viewMode === 'treemap' && <HierarchyTreeView partners={partners} contracts={contracts} ios={ios} searchQuery={searchQuery}
        loading={loading} error={error} onRetry={onRetry} onSelectPartner={onSelectPartner} onSelectContract={onSelectContract} onSelectIO={onSelectIO}
        onOpenAddPartner={onOpenAddPartner} onOpenAddContract={onOpenAddContract} onOpenAddIO={onOpenAddIO} />}

      {/* VIEW MODE: AUDIT TABLE */}
      {viewMode === 'audit' && (() => {
        const calculateDuration = (start?: string, end?: string) => {
          if (!start || !end) return '-';
          const d1 = new Date(start);
          const d2 = new Date(end);
          if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return '-';
          const diffTime = Math.abs(d2.getTime() - d1.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays >= 30) {
            return `${Math.round(diffDays / 30)} ${t('hierarchy.months', 'Bulan')}`;
          }
          return `${diffDays} ${t('hierarchy.days', 'Hari')}`;
        };
        const formatDate = (dateStr?: string) => {
          if (!dateStr) return '-';
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) return '-';
          return d.toLocaleDateString(getActiveFormattingLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
        };



        const renderStatusBadge = (status?: string, fallbackLabel?: string) => {
          if (!status && !fallbackLabel) return '-';
          const raw = (status || fallbackLabel || '').trim();
          const s = raw.toLowerCase();

          const translationKey = `status.${s.replace(/\s+/g, '_')}`;
          const label = t(translationKey, raw);

          return (
            <Badge tone={statusTone(raw)}>
              {label}
            </Badge>
          );
        };

        const renderCell = (colId: string, row: any) => {
           // Vendor Group (Grouped)
           if (['vendorName', 'vendorType', 'vendorChannelName', 'vendorCodename', 'vendorStatus', 'vendorStartDate', 'vendorEndDate', 'vendorDuration', 'vendorPicName', 'vendorPicEmail', 'vendorPicPhone', 'vendorPicAlamat', 'vendorPicInternal', 'vendorBadanHukum', 'vendorStatusDD', 'vendorLinkNDA', 'vendorLinkCOR', 'vendorLinkDGT', 'vendorLinkTermination', 'vendorLinkAssessment', 'vendorLinkPlacement', 'vendorLinkInvoice', 'vendorLinkNIB', 'vendorLinkLicense', 'vendorLinkNPWP', 'vendorLinkAkta'].includes(colId)) {
              if (!row.isFirstForPartner) return null; // Skip rendering, covered by rowSpan
              const rowSpan = row.partnerRowSpan || 1;
              const className = "border border-border  p-g8 align-top";

              if (colId === 'vendorName') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorName}</TableCell>;
              if (colId === 'vendorType') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorType || '-'}</TableCell>;
              if (colId === 'vendorChannelName') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorChannelName || '-'}</TableCell>;
              if (colId === 'vendorCodename') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorCodename || '-'}</TableCell>;
              if (colId === 'vendorStatus') {
                 if (!row.vendorStart || !row.vendorEnd) return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>-</TableCell>;
                 const vendorStatusStr = row.vendorTerminated ? 'Terminated' : row.vendorActive ? 'Active' : 'Expired';
                 return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>{renderStatusBadge(vendorStatusStr)}</TableCell>;
              }
              if (colId === 'vendorStartDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.vendorStart)}</TableCell>;
              if (colId === 'vendorEndDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.vendorEnd)}</TableCell>;
              if (colId === 'vendorDuration') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorDuration || '-'}</TableCell>;
              if (colId === 'vendorPicName') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorPicName || '-'}</TableCell>;
              if (colId === 'vendorPicEmail') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorPicEmail || '-'}</TableCell>;
              if (colId === 'vendorPicPhone') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorPicPhone || '-'}</TableCell>;
              if (colId === 'vendorPicAlamat') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorPicAlamat || '-'}</TableCell>;
              if (colId === 'vendorPicInternal') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorPicInternal || '-'}</TableCell>;
              if (colId === 'vendorBadanHukum') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorBadanHukum || '-'}</TableCell>;
              if (colId === 'vendorStatusDD') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.vendorStatusDD || '-'}</TableCell>;

              if (colId === 'vendorLinkNDA') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkNDA ? <Button asChild variant="link"><a href={row.vendorLinkNDA} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkCOR') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkCOR ? <Button asChild variant="link"><a href={row.vendorLinkCOR} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkDGT') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkDGT ? <Button asChild variant="link"><a href={row.vendorLinkDGT} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkTermination') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkTermination ? <Button asChild variant="link"><a href={row.vendorLinkTermination} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkAssessment') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkAssessment ? <Button asChild variant="link"><a href={row.vendorLinkAssessment} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkPlacement') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkPlacement ? <Button asChild variant="link"><a href={row.vendorLinkPlacement} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkInvoice') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkInvoice ? <Button asChild variant="link"><a href={row.vendorLinkInvoice} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkNIB') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkNIB ? <Button asChild variant="link"><a href={row.vendorLinkNIB} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkLicense') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkLicense ? <Button asChild variant="link"><a href={row.vendorLinkLicense} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkNPWP') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkNPWP ? <Button asChild variant="link"><a href={row.vendorLinkNPWP} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'vendorLinkAkta') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkAkta ? <Button asChild variant="link"><a href={row.vendorLinkAkta} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
           }

           const className = "border border-border  p-g8 align-top";

           // Evaluation Group (Not grouped)
           if (colId.startsWith('eval')) {
              if (!row.evaluation) return <TableCell key={colId} className={`${className} `}>-</TableCell>;
              if (colId === 'evalReviewDate') return <TableCell key={colId} className={`${className} `}>{formatDate(row.evaluation.review_date)}</TableCell>;
              if (colId === 'evalTypeOfWork') return <TableCell key={colId} className={`${className} `}>{row.evaluation.type_of_work || '-'}</TableCell>;
              if (colId === 'evalSlaScore') return <TableCell key={colId} className={`${className} `}>{row.evaluation.sla_score ?? '-'}</TableCell>;
              if (colId === 'evalObligation') return <TableCell key={colId} className={`${className} `}>{row.evaluation.obligation_target || '-'}</TableCell>;
              if (colId === 'evalIncident') return <TableCell key={colId} className={`${className} `}>{row.evaluation.incident_frequency || '-'}</TableCell>;
              if (colId === 'evalCommunication') return <TableCell key={colId} className={`${className} `}>{row.evaluation.communication || '-'}</TableCell>;
              if (colId === 'evalPricing') return <TableCell key={colId} className={`${className} `}>{row.evaluation.pricing || '-'}</TableCell>;
              if (colId === 'evalFinal') return <TableCell key={colId} className={`${className} `}>{row.evaluation.final_evaluation || '-'}</TableCell>;
              if (colId === 'evalNotes') return <TableCell key={colId} className={`${className} `}>{row.evaluation.notes || '-'}</TableCell>;
           }

           // Spending Group (Not grouped)
           if (colId.startsWith('spend')) {
              if (!row.spending) return <TableCell key={colId} className={`${className} `}>-</TableCell>;
              if (colId === 'spendInvoiceNo') return <TableCell key={colId} className={`${className} `}>{row.spending.invoice_number || '-'}</TableCell>;
              if (colId === 'spendInvDate') return <TableCell key={colId} className={`${className} `}>{formatDate(row.spending.invoice_date)}</TableCell>;
              if (colId === 'spendInvoiceDesc') return <TableCell key={colId} className={`${className} `}>{row.spending.invoice_description || '-'}</TableCell>;
              if (colId === 'spendAmount') {
                  const amtUsd = row.spending.total_amount_usd !== undefined && row.spending.total_amount_usd !== null && !isNaN(Number(row.spending.total_amount_usd))
                     ? Number(row.spending.total_amount_usd)
                     : convertToUsdWithFallback(Number(row.spending.total_amount) || 0, row.spending.currency || 'USD');
                  return <TableCell key={colId} className={`${className} whitespace-nowrap text-right`}>{amtUsd ? t('hierarchy.us', 'US$ {value}', { value: amtUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }) : '-'}</TableCell>;
               }
              if (colId === 'spendInvoiceLink') return <TableCell key={colId} className={`${className} text-center`}>{row.spending.invoice_file_url ? <Button asChild variant="link"><a href={row.spending.invoice_file_url} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
              if (colId === 'spendBillingLink') return <TableCell key={colId} className={`${className} text-center`}>{row.spending.billing_file_url ? <Button asChild variant="link"><a href={row.spending.billing_file_url} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
           }

           // Contract Group (Grouped)
           if (colId.startsWith('contract')) {
              if (!auditFlatMode && !auditSortConfig && !row.isFirstForContract) return null; // Skip rendering, covered by rowSpan
              const rowSpan = auditFlatMode || auditSortConfig ? 1 : (row.contractRowSpan || 1);

              if (!row.contract) return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>-</TableCell>;
              if (colId === 'contractNo') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.contract_number}</TableCell>;
              if (colId === 'contractTitle') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.contract_title}</TableCell>;
              if (colId === 'contractStatus') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>{renderStatusBadge(row.contract.status)}</TableCell>;
              if (colId === 'contractStartDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.contract.start_date)}</TableCell>;
              if (colId === 'contractEndDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.contract.end_date)}</TableCell>;
              if (colId === 'contractDuration') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contractDuration || '-'}</TableCell>;
              if (colId === 'contractValue') {
                  const cUsd = row.contract.contract_value_usd !== undefined && row.contract.contract_value_usd !== null && !isNaN(Number(row.contract.contract_value_usd))
                     ? Number(row.contract.contract_value_usd)
                     : convertToUsdWithFallback(Number(row.contract.contract_value) || 0, row.contract.currency || 'USD');
                  return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap text-right`}>{cUsd ? t('hierarchy.us', 'US$ {value}', { value: cUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }) : '-'}</TableCell>;
               }
              if (colId === 'contractKategori') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.cooperation_categories?.join(', ') || '-'}</TableCell>;
              if (colId === 'contractAutoRenewal') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.auto_renewal ? t('common.yes', 'Ya') : t('common.no', 'Tidak')}</TableCell>;
              if (colId === 'contractNoticePeriod') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.notice_period_days || '-'}</TableCell>;
              if (colId === 'contractStatusApproval') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.status_approval || '-'}</TableCell>;
              if (colId === 'contractInternalNotes') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.internal_notes || '-'}</TableCell>;
              if (colId === 'contractLink') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.contract.contract_file_link ? <Button asChild variant="link"><a href={row.contract.contract_file_link} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
           }

           // IO Group (Grouped)
           if (colId.startsWith('io')) {
              if (!auditFlatMode && !auditSortConfig && !row.isFirstForIO) return null; // Skip rendering, covered by rowSpan
              const rowSpan = auditFlatMode || auditSortConfig ? 1 : (row.ioRowSpan || 1);

              if (!row.io) return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>-</TableCell>;
              if (colId === 'ioNo') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.io_number}</TableCell>;
              if (colId === 'ioTitle') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.io_title}</TableCell>;
              if (colId === 'ioStatus') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>{renderStatusBadge(row.io.status)}</TableCell>;
              if (colId === 'ioChannel') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.media_channel || '-'}</TableCell>;
              if (colId === 'ioStartDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.io.start_date)}</TableCell>;
              if (colId === 'ioEndDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.io.end_date)}</TableCell>;
              if (colId === 'ioDuration') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.ioDuration || '-'}</TableCell>;
              if (colId === 'ioPricingModel') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.pricing_model || '-'}</TableCell>;
              if (colId === 'ioChargingType') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.charging_type || '-'}</TableCell>;
              if (colId === 'ioDeliverables') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.deliverables || '-'}</TableCell>;
              if (colId === 'ioValue') {
                  const ioUsd = row.io.io_value_usd !== undefined && row.io.io_value_usd !== null && !isNaN(Number(row.io.io_value_usd))
                     ? Number(row.io.io_value_usd)
                     : convertToUsdWithFallback(Number(row.io.io_value) || 0, row.io.currency || 'USD');
                  return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap text-right`}>{ioUsd ? t('hierarchy.us', 'US$ {value}', { value: ioUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }) : '-'}</TableCell>;
               }
              if (colId === 'ioLink') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.io.io_file_link ? <Button asChild variant="link"><a href={row.io.io_file_link} target="_blank" rel="noreferrer" >{t('hierarchy.link', 'Link')}</a></Button> : '-'}</TableCell>;
           }

           return <TableCell key={colId} className={className}>-</TableCell>;
        };

        let auditRows: any[] = [];
        let baseRows: any[] = [];

        // Generate flat data with max-rows padding
        partners.forEach(p => {
           const pContracts = contracts.filter(c => c.partner_id === p.partner_id);
           const pIos = ios.filter(io => io.partner_id === p.partner_id);
           const pEvals = evaluations.filter(e => e.partner_id === p.partner_id || e.supplier_name.toLowerCase() === p.partner_name.toLowerCase());
           const pSpends = spendings.filter(s => s.vendor_id === p.partner_id || s.vendor_name.toLowerCase() === p.partner_name.toLowerCase());

           const allStartDates = [...pContracts.map(c => c.start_date), ...pIos.map(i => i.start_date)].filter(Boolean);
           const allEndDates = [...pContracts.map(c => c.end_date), ...pIos.map(i => i.end_date)].filter(Boolean);
           allStartDates.sort();
           allEndDates.sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime());

           const vendorStart = allStartDates[0] || null;
           const vendorEnd = allEndDates[0] || null;
           const vendorDuration = calculateDuration(vendorStart || undefined, vendorEnd || undefined);
           let vendorActive = vendorEnd ? isVendorActive(vendorEnd) : false;
           let vendorTerminated = false;

           if (pContracts.length > 0) {
              const hasActiveContracts = pContracts.some(c => c.status && c.status.toLowerCase() === 'aktif');
              const sortedContracts = [...pContracts].sort((a, b) => new Date(b.end_date || '').getTime() - new Date(a.end_date || '').getTime());
              const lastContract = sortedContracts[0];
              const isLastTerminated = lastContract && lastContract.status && lastContract.status.toLowerCase() === 'terminated';
              if (!hasActiveContracts && isLastTerminated) {
                 vendorActive = false;
                 vendorTerminated = true;
              }
           }

           // Match by policy-pack requirement key first, then by legacy name.
           const getDDLink = (name: string, keys: string[] = []) => {
              const docs = p.dd_documents || [];
              const doc = docs.find(d => d.key && keys.includes(d.key) && (d.linkDrive || d.files?.length))
                || docs.find(d => d.name.toLowerCase() === name.toLowerCase() || d.name.includes(name));
              return doc?.linkDrive || doc?.files?.[0]?.linkDrive || '';
           };

           const cioRows: any[] = [];
           if (pContracts.length === 0 && pIos.length === 0) {
              // no contracts, no IOs
           } else {
              pContracts.forEach(c => {
                 const cIos = pIos.filter(io => io.contract_id === c.contract_id);
                 const contractDuration = calculateDuration(c.start_date, c.end_date);
                 if (cIos.length === 0) {
                    cioRows.push({ contract: c, contractDuration, io: null, ioDuration: null });
                 } else {
                    cIos.forEach(io => {
                       const ioDuration = calculateDuration(io.start_date, io.end_date);
                       cioRows.push({ contract: c, contractDuration, io: io, ioDuration });
                    });
                 }
              });
              // orphan IOs
              const orphanIos = pIos.filter(io => !io.contract_id || !pContracts.find(c => c.contract_id === io.contract_id));
              orphanIos.forEach(io => {
                 const ioDuration = calculateDuration(io.start_date, io.end_date);
                 cioRows.push({ contract: null, contractDuration: null, io: io, ioDuration });
              });
           }

           const maxRows = Math.max(cioRows.length, pEvals.length, pSpends.length, 1);

           for (let i = 0; i < maxRows; i++) {
              let cio = cioRows[i];
              if (!cio && cioRows.length > 0) {
                 cio = cioRows[cioRows.length - 1];
              }
              if (!cio) {
                 cio = { contract: null, contractDuration: null, io: null, ioDuration: null };
              }
              const ev = pEvals[i] || null;
              const sp = pSpends[i] || null;

              baseRows.push({
                 vendorName: p.partner_name, vendorType: p.partner_type, vendorChannelName: (p.tags && p.tags.length > 0) ? p.tags.join(', ') : '-', vendorCodename: p.codename || '-', vendorStart, vendorEnd, vendorDuration, vendorActive, vendorTerminated,
                 vendorPicName: p.pic_name, vendorPicEmail: p.pic_email, vendorPicPhone: p.pic_phone, vendorPicAlamat: p.pic_address, vendorPicInternal: p.internal_pic, vendorBadanHukum: p.country ?? (p.legal_status_flag === 'BHI' ? 'ID' : ''), vendorStatusDD: p.status_dd,
                 vendorLinkNDA: getDDLink('NDA', ['nda']),
                 vendorLinkCOR: getDDLink('COR', ['id_cor']),
                 vendorLinkDGT: getDDLink('DGT', ['id_dgt']),
                 vendorLinkTermination: getDDLink('Termination notice', ['termination_notice']),
                 vendorLinkAssessment: getDDLink('Vendor assessment form', ['vendor_assessment']),
                 vendorLinkPlacement: getDDLink('Placement Documentation', ['media_placement_docs']),
                 vendorLinkInvoice: getDDLink('Invoice and Billing'),
                 vendorLinkNIB: getDDLink('NIB', BUSINESS_REGISTRATION_KEYS),
                 vendorLinkLicense: getDDLink('Business license'),
                 vendorLinkNPWP: getDDLink('NPWP', TAX_REGISTRATION_KEYS),
                 vendorLinkAkta: getDDLink('Akta', INCORPORATION_KEYS),
                 contract: cio.contract, contractDuration: cio.contractDuration,
                 io: cio.io, ioDuration: cio.ioDuration,
                 evaluation: ev, spending: sp
              });
           }
        });

        // Search Filter
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          baseRows = baseRows.filter(r =>
            (r.vendorName || '').toLowerCase().includes(q) ||
            (r.contract?.contract_title || '').toLowerCase().includes(q) ||
            (r.io?.io_title || '').toLowerCase().includes(q)
          );
        }

        // Sorting
        if (auditSortConfig) {
          baseRows.sort((a, b) => {
            const asc = auditSortConfig.direction === 'asc' ? 1 : -1;
            const getVal = (row: any, key: string) => {
              switch(key) {
                case 'vendorName': return row.vendorName || '';
                case 'vendorType': return row.vendorType || '';
                case 'vendorChannelName': return row.vendorChannelName || '';
                case 'vendorCodename': return row.vendorCodename || '';
                case 'vendorStatus': return row.vendorActive ? 1 : 0;
                case 'vendorStartDate': return row.vendorStart || '';
                case 'vendorEndDate': return row.vendorEnd || '';
                case 'vendorDuration': return row.vendorDuration || '';

                case 'spendInvoiceNo': return row.spending?.invoice_number || '';
                case 'spendInvDate': return row.spending?.invoice_date || '';
                case 'spendAmount': return row.spending?.total_amount_usd !== undefined && row.spending?.total_amount_usd !== null ? Number(row.spending.total_amount_usd) : convertToUsdWithFallback(Number(row.spending?.total_amount) || 0, row.spending?.currency || 'USD');

                case 'contractNo': return row.contract?.contract_number || '';
                case 'contractTitle': return row.contract?.contract_title || '';
                case 'contractStatus': return row.contract?.status || '';
                case 'contractStartDate': return row.contract?.start_date || '';
                case 'contractEndDate': return row.contract?.end_date || '';
                case 'contractValue': return row.contract?.contract_value_usd !== undefined && row.contract?.contract_value_usd !== null && !isNaN(Number(row.contract.contract_value_usd)) ? Number(row.contract.contract_value_usd) : convertToUsdWithFallback(Number(row.contract?.contract_value) || 0, row.contract?.currency || 'USD');

                case 'ioNo': return row.io?.io_number || '';
                case 'ioTitle': return row.io?.io_title || '';
                case 'ioStatus': return row.io?.status || '';
                case 'ioChannel': return row.io?.media_channel || '';
                case 'ioStartDate': return row.io?.start_date || '';
                case 'ioEndDate': return row.io?.end_date || '';
                case 'ioValue': return row.io?.io_value_usd !== undefined && row.io?.io_value_usd !== null && !isNaN(Number(row.io.io_value_usd)) ? Number(row.io.io_value_usd) : convertToUsdWithFallback(Number(row.io?.io_value) || 0, row.io?.currency || 'USD');
                default: return '';
              }
            };
            const valA = getVal(a, auditSortConfig.key);
            const valB = getVal(b, auditSortConfig.key);
            if (valA < valB) return -1 * asc;
            if (valA > valB) return 1 * asc;
            return 0;
          });
        }

        // Grouping (RowSpan logic)
        if (auditFlatMode || auditSortConfig) {
          auditRows = baseRows.map(r => ({ ...r, isFirstForPartner: true, partnerRowSpan: 1, isFirstForContract: true, contractRowSpan: 1, isFirstForIO: true, ioRowSpan: 1 }));
        } else {
          let currentPartner = '';
          let currentContract = '';
          let currentIO = '';
          let pStartIndex = -1;
          let cStartIndex = -1;
          let ioStartIndex = -1;

          for (let i = 0; i < baseRows.length; i++) {
            const r = { ...baseRows[i] };
            const pKey = r.vendorName;
            const cKey = r.contract?.contract_id || `empty-${pKey}`;
            const ioKey = r.io?.io_id || `empty-io-${cKey}`;

            if (pKey !== currentPartner) {
              r.isFirstForPartner = true;
              r.partnerRowSpan = 1;
              currentPartner = pKey;
              pStartIndex = i;
            } else {
              r.isFirstForPartner = false;
              auditRows[pStartIndex].partnerRowSpan += 1;
            }

            if (cKey !== currentContract || r.isFirstForPartner) {
              r.isFirstForContract = true;
              r.contractRowSpan = 1;
              currentContract = cKey;
              cStartIndex = i;
            } else {
              r.isFirstForContract = false;
              if (cStartIndex >= 0 && auditRows[cStartIndex]) {
                 auditRows[cStartIndex].contractRowSpan += 1;
              }
            }

            if (ioKey !== currentIO || r.isFirstForContract) {
              r.isFirstForIO = true;
              r.ioRowSpan = 1;
              currentIO = ioKey;
              ioStartIndex = i;
            } else {
              r.isFirstForIO = false;
              if (ioStartIndex >= 0 && auditRows[ioStartIndex]) {
                 auditRows[ioStartIndex].ioRowSpan += 1;
              }
            }
            auditRows.push(r);
          }
        }

        const handleSort = (key: string) => {
          let dir: 'asc' | 'desc' = 'asc';
          if (auditSortConfig && auditSortConfig.key === key && auditSortConfig.direction === 'asc') {
            dir = 'desc';
          }
          setAuditSortConfig({ key, direction: dir });
          setAuditFlatMode(true);
        };

const exportToCSV = () => {
          const headers = columns.filter(c => auditVisibleCols[c.id]).map(c => t(`audit_col_${c.id}`, c.label));
          const csvRows = baseRows.map(row => {
            const rowData: Record<string, string> = {
              vendorName: row.vendorName || '',
              vendorType: row.vendorType || '',
              vendorChannelName: row.vendorChannelName || '',
              vendorCodename: row.vendorCodename || '',
              vendorStatus: row.vendorStart && row.vendorEnd ? (row.vendorTerminated ? t('status.terminated', 'Terminated') : row.vendorActive ? t('status.aktif', 'Aktif') : t('status.expired', 'Expired')) : '-',
              vendorStartDate: formatDate(row.vendorStart),
              vendorEndDate: formatDate(row.vendorEnd),
              vendorDuration: row.vendorDuration || '',
              vendorPicName: row.vendorPicName || '',
              vendorPicEmail: row.vendorPicEmail || '',
              vendorPicPhone: row.vendorPicPhone || '',
              vendorPicAlamat: row.vendorPicAlamat || '',
              vendorPicInternal: row.vendorPicInternal || '',
              vendorBadanHukum: row.vendorBadanHukum || '',
              vendorStatusDD: row.vendorStatusDD || '',
              vendorLinkNDA: row.vendorLinkNDA || '',
              vendorLinkCOR: row.vendorLinkCOR || '',
              vendorLinkDGT: row.vendorLinkDGT || '',
              vendorLinkTermination: row.vendorLinkTermination || '',
              vendorLinkAssessment: row.vendorLinkAssessment || '',
              vendorLinkPlacement: row.vendorLinkPlacement || '',
              vendorLinkInvoice: row.vendorLinkInvoice || '',
              vendorLinkNIB: row.vendorLinkNIB || '',
              vendorLinkLicense: row.vendorLinkLicense || '',
              vendorLinkNPWP: row.vendorLinkNPWP || '',
              vendorLinkAkta: row.vendorLinkAkta || '',

              evalReviewDate: formatDate(row.evaluation?.review_date),
              evalTypeOfWork: row.evaluation?.type_of_work || '',
              evalSlaScore: (row.evaluation?.sla_score ?? '').toString(),
              evalObligation: row.evaluation?.obligation_target || '',
              evalIncident: row.evaluation?.incident_frequency || '',
              evalCommunication: row.evaluation?.communication || '',
              evalPricing: row.evaluation?.pricing || '',
              evalFinal: row.evaluation?.final_evaluation || '',
              evalNotes: row.evaluation?.notes || '',

              spendInvoiceNo: row.spending?.invoice_number || '',
              spendInvDate: formatDate(row.spending?.invoice_date),
              spendInvoiceDesc: row.spending?.invoice_description || '',
              spendAmount: row.spending ? (row.spending.total_amount_usd !== undefined && row.spending.total_amount_usd !== null ? row.spending.total_amount_usd : convertToUsdWithFallback(row.spending.total_amount || 0, row.spending.currency || 'USD')).toString() : '',
              spendInvoiceLink: row.spending?.invoice_file_url || '',
              spendBillingLink: row.spending?.billing_file_url || '',

              contractNo: row.contract?.contract_number || '',
              contractTitle: row.contract?.contract_title || '',
              contractStatus: row.contract?.status || '',
              contractStartDate: formatDate(row.contract?.start_date),
              contractEndDate: formatDate(row.contract?.end_date),
              contractDuration: row.contractDuration || '',
              contractValue: row.contract ? (row.contract.contract_value_usd !== undefined && row.contract.contract_value_usd !== null && !isNaN(Number(row.contract.contract_value_usd)) ? row.contract.contract_value_usd : convertToUsdWithFallback(row.contract.contract_value || 0, row.contract.currency || 'USD')).toString() : '',
              contractKategori: row.contract?.cooperation_categories || '',
              contractAutoRenewal: row.contract?.auto_renewal ? 'Ya' : 'Tidak',
              contractNoticePeriod: (row.contract?.notice_period_days || '').toString(),
              contractStatusApproval: row.contract?.status_approval || '',
              contractInternalNotes: row.contract?.internal_notes || '',
              contractLink: row.contract?.contract_file_link || '',

              ioNo: row.io?.io_number || '',
              ioTitle: row.io?.io_title || '',
              ioStatus: row.io?.status || '',
              ioChannel: row.io?.media_channel || '',
              ioStartDate: formatDate(row.io?.start_date),
              ioEndDate: formatDate(row.io?.end_date),
              ioDuration: row.ioDuration || '',
              ioPricingModel: row.io?.pricing_model || '',
              ioChargingType: row.io?.charging_type || '',
              ioDeliverables: row.io?.deliverables || '',
              ioValue: row.io ? (row.io.io_value_usd !== undefined && row.io.io_value_usd !== null && !isNaN(Number(row.io.io_value_usd)) ? row.io.io_value_usd : convertToUsdWithFallback(row.io.io_value || 0, row.io.currency || 'USD')).toString() : '',
              ioLink: row.io?.io_file_link || '',
            };
            return columns.filter(c => auditVisibleCols[c.id]).map(c => rowData[c.id]);
          });
          downloadCsv(`Tabel_Audit_${new Date().getTime()}.csv`, headers, csvRows);
        };

        return (
          <Card className={`overflow-hidden flex flex-col ${baseRows.length === 0 ? '' : 'h-g987'}`}>
            <div className="p-g13 bg-card border-b border-border flex flex-col md:flex-row gap-g13 items-start md:items-center justify-between">
              <Heading as="h3" size="sm" weight="semibold">{t('hierarchy.audit_table_title', 'Tabel Audit Lengkap')}</Heading>
              <div className="flex flex-wrap items-center gap-g13">
                <Toggle variant="outline" pressed={auditFlatMode} onPressedChange={pressed => setAuditFlatMode(pressed)}>
                  <ArrowUpDown aria-hidden="true" />
                  {auditFlatMode ? t('hierarchy.view_flat', 'Tampilan: Datar (Bisa di-Sort)') : t('hierarchy.view_grouped', 'Tampilan: Grouping Row')}
                </Toggle>
                <Menu closeOnSelect={false} positioning={{ placement: 'bottom-end', gutter: 8 }} open={showColPicker} onOpenChange={details => setShowColPicker(details.open)}>
                  <MenuTrigger asChild>
                    <Button variant="outline"><SlidersHorizontal aria-hidden="true" />{t('hierarchy.custom_columns', 'Kustom Kolom')}</Button>
                  </MenuTrigger>
                  <MenuPositioner>
                    <MenuContent className="w-g233">
                      <MenuViewport className="max-h-g377">
                        <MenuItemGroup>
                          <MenuItemGroupLabel>{t('hierarchy.custom_columns_title', 'Kustomisasi Kolom')}</MenuItemGroupLabel>
                          <MenuCheckboxItem value="__all" checked={Object.keys(INITIAL_AUDIT_COLS).every(k => auditVisibleCols[k])} onCheckedChange={checked => {
                            const newState = {} as Record<string, boolean>;
                            Object.keys(INITIAL_AUDIT_COLS).forEach(k => { newState[k] = checked; });
                            setAuditVisibleCols(newState);
                          }}>
                            <MenuItemIndicator /><MenuItemText>{t('hierarchy.select_all', 'Pilih Semua / Kosongkan')}</MenuItemText>
                          </MenuCheckboxItem>
                          <MenuItem value="__reset" onSelect={() => setAuditVisibleCols(INITIAL_AUDIT_COLS)}>{t('hierarchy.reset', 'Reset')}</MenuItem>
                        </MenuItemGroup>
                        {['Vendor', 'Evaluation', 'Spending', 'Contract', 'IO'].map(groupName => (
                          <MenuItemGroup key={groupName}>
                            <MenuSeparator />
                            <MenuItemGroupLabel>{t(`audit_group_${groupName.toLowerCase()}`, groupName)}</MenuItemGroupLabel>
                            {columns.filter(c => c.group === groupName).map(col => (
                              <MenuCheckboxItem key={col.id} value={col.id} checked={!!auditVisibleCols[col.id]} onCheckedChange={checked => setAuditVisibleCols(prev => ({ ...prev, [col.id]: checked }))}>
                                <MenuItemIndicator /><MenuItemText>{t(`audit_col_${col.id}`, col.label)}</MenuItemText>
                              </MenuCheckboxItem>
                            ))}
                          </MenuItemGroup>
                        ))}
                      </MenuViewport>
                    </MenuContent>
                  </MenuPositioner>
                </Menu>
                {hasPermission('export.csv') && (
                  <Button
                    onClick={exportToCSV}
                    disabled={baseRows.length === 0}
                  >
                    <FileDown className="w-g13 h-g13" />
                    {t('hierarchy.export_csv', 'Ekspor CSV')}
                  </Button>
                )}
              </div>
            </div>
            <TableScrollArea className="@container flex-1">
              <Table className="w-full text-left">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow>
                    {columns.map((col, idx) => auditVisibleCols[col.id] && (
                      <TableColumnHeader
                        key={col.id}
                        scope="col"
                        aria-sort={
                          auditFlatMode
                            ? auditSortConfig?.key === col.id
                              ? auditSortConfig.direction === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                            : undefined
                        }
                        draggable
                        onDragStart={(e) => {
                          setDraggedColId(col.id);
                          setDraggedColIdx(idx);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!draggedColId || draggedColId === col.id) return;
                          setColumns(prev => {
                            const newCols = [...prev];
                            const dragIndex = newCols.findIndex(c => c.id === draggedColId);
                            const dropIndex = newCols.findIndex(c => c.id === col.id);
                            const [draggedItem] = newCols.splice(dragIndex, 1);
                            newCols.splice(dropIndex, 0, draggedItem);
                            return newCols;
                          });
                          setDraggedColId(null);
                          setDraggedColIdx(null);
                        }}
                        className="whitespace-nowrap"
                      >
                        {auditFlatMode ? (
                          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" onClick={() => handleSort(col.id)}>
                            {t(`audit_col_${col.id}`, col.label)}
                            {auditSortConfig?.key === col.id
                              ? (auditSortConfig.direction === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />)
                              : <ArrowUpDown aria-hidden="true" className="text-muted-foreground" />}
                          </Button></TooltipTrigger><TooltipBody>{t('hierarchy.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label: t(`audit_col_${col.id}`, col.label) })}</TooltipBody></Tooltip>
                        ) : t(`audit_col_${col.id}`, col.label)}
                      </TableColumnHeader>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditRows.map((row, index) => (
                     <TableRow key={index}>
                        {columns.map(col => auditVisibleCols[col.id] ? renderCell(col.id, row) : null)}
                     </TableRow>
                  ))}

                  {auditRows.length === 0 && (
                    <TableEmptyState colSpan={columns.filter(c => auditVisibleCols[c.id]).length} />
                  )}
                </TableBody>
              </Table>
            </TableScrollArea>
          </Card>
        );
      })()}
      </TabsContent>
      </Tabs>
    </div>
  );
};
