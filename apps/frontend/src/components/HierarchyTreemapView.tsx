import React, { useState } from 'react';
import { downloadCsv } from '../lib/csv';
import { isTerminationNoticeDocument, localizeDueDiligenceDocument } from '@legalio/shared/dueDiligence';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { TableEmptyMessage } from './ui/table-empty-state';
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
import { convertToUsdWithFallback, formatMoney, getActiveFormattingLocale } from '@legalio/shared/currencyUtils';

/** Requirement keys (all country packs) grouped for the generic Explore columns. */
const BUSINESS_REGISTRATION_KEYS = ['id_nib', 'sg_bizfile', 'my_ssm_profile', 'th_dbd_affidavit', 'vn_erc', 'ph_sec_certificate', 'ph_business_permit', 'in_incorporation', 'jp_registry_certificate', 'kr_business_registration', 'kr_corporate_registry', 'cn_business_licence', 'hk_br_certificate', 'ae_trade_licence', 'certificate_of_incorporation'];
const TAX_REGISTRATION_KEYS = ['id_npwp', 'sg_gst_certificate', 'my_sst_certificate', 'th_vat_certificate', 'ph_bir_2303', 'in_gst_certificate', 'in_pan_card', 'jp_invoice_registration', 'ae_vat_certificate', 'tax_registration'];
const INCORPORATION_KEYS = ['id_akta', 'hk_incorporation', 'in_incorporation', 'certificate_of_incorporation'];
import { useLanguage } from '../context/LanguageContext';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import {
  Layers,
  Building2,
  FileText,
  FileSpreadsheet,
  Plus,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Upload,
  Search,
  ArrowRight,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  FolderOpen,
  XCircle,
  Info,
  GitFork,
  LayoutGrid,
  Settings2,
  Download,
  ArrowUpDown,
  CheckSquare,
  Square,
  SlidersHorizontal,
  FileDown,
  CalendarDays
} from 'lucide-react';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@legalio/ui-components/input-group';
import { Button } from '@legalio/ui-components/button';
import { TableCell, Table, TableHeader, TableRow, TableColumnHeader, TableBody } from '@legalio/ui-components/table';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
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
  onOpenAddPartner,
  onOpenAddContract,
  onOpenAddIO,
  onSelectPartner,
  onSelectContract,
  onSelectIO,
}) => {
  const { t, language } = useLanguage();
  const { policy } = useTenantSettings();
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
  const [expandedPartners, setExpandedPartners] = useState<Record<string, boolean>>({});
  const [expandedContracts, setExpandedContracts] = useState<Record<string, boolean>>({});

  const togglePartner = (id: string) => {
    setExpandedPartners((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleContract = (id: string) => {
    setExpandedContracts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filtered partners
  const filteredPartners = partners.filter((p) => {
    const query = searchQuery.toLowerCase();
    const matchPartner =
      p.nama_partner.toLowerCase().includes(query) || p.jenis_partner.toLowerCase().includes(query);
    const partnerContracts = contracts.filter((c) => c.partner_id === p.partner_id);
    const matchContract = partnerContracts.some(
      (c) => c.nomor_kontrak.toLowerCase().includes(query) || c.judul_kontrak.toLowerCase().includes(query)
    );
    return matchPartner || matchContract;
  });

  // Helper stats
  const totalVerifiedDD = partners.filter((p) => p.status_dd === 'Complete').length;
  const totalContractDocs = contracts.filter((c) => c.link_file_kontrak || c.fileName).length;
  const totalIODocs = ios.filter((i) => i.link_file_io || i.fileName).length;

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <Card className="flex-row flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <Heading as="h2" size="lg" weight="semibold">
            <span>{t('hierarchy.title', 'Struktur Dokumen')}</span>
          </Heading>
        </div>
      </Card>

      {/* Control Toolbar & View Mode Switcher */}
      <Card className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* View Switchers - Solid Green Pill Buttons for Selected State matching reference */}
        <div role="tablist" aria-label={t('hierarchy.title')} className="mobile-page-actions flex flex-wrap items-center gap-2.5 sm:gap-3 w-full sm:w-auto"
          onKeyDown={event => {
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
            const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); tabs[next].focus(); tabs[next].click(); }
          }}>
          <button
            type="button" role="tab" id="structure-tree-tab" aria-selected={viewMode === 'treemap'} aria-controls="structure-panel" tabIndex={viewMode === 'treemap' ? 0 : -1}
            onClick={() => setViewMode('treemap')}
            className={`h-(--form-control-height) min-h-10 px-4 rounded-md transition-all flex items-center justify-center gap-2 cursor-pointer text-sm font-semibold shadow-xs ${
 viewMode === 'treemap'
 ? 'bg-primary text-white border border-transparent shadow-md'
 : 'bg-card border border-border text-foreground hover:bg-card '
 }`}
          >
            <GitFork className={`w-4 h-4 ${viewMode === 'treemap' ? 'text-white' : 'text-muted-foreground '}`} />
            <span>{t('hierarchy.tree_view', 'Tampilan Pohon')}</span>
          </button>
          <button
            type="button" role="tab" id="structure-audit-tab" aria-selected={viewMode === 'audit'} aria-controls="structure-panel" tabIndex={viewMode === 'audit' ? 0 : -1}
            onClick={() => setViewMode('audit')}
            className={`h-(--form-control-height) min-h-10 px-4 rounded-md transition-all flex items-center justify-center gap-2 cursor-pointer text-sm font-semibold shadow-xs ${
 viewMode === 'audit'
 ? 'bg-primary text-white border border-transparent shadow-md'
 : 'bg-card border border-border text-foreground hover:bg-card '
 }`}
          >
            <FileSpreadsheet className={`w-4 h-4 ${viewMode === 'audit' ? 'text-white' : 'text-muted-foreground '}`} />
            <span>{t('hierarchy.audit_view', 'Tampilan Tabel')}</span>
          </button>
          <button type="button" role="tab" id="structure-calendar-tab" aria-selected={viewMode === 'calendar'} aria-controls="structure-panel" tabIndex={viewMode === 'calendar' ? 0 : -1}
            onClick={() => setViewMode('calendar')}
            className={`h-(--form-control-height) min-h-10 px-4 rounded-md transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm font-semibold shadow-xs ${viewMode === 'calendar' ? 'bg-primary text-white border border-transparent shadow-md' : 'bg-card border border-border text-foreground hover:bg-card '}`}>
            <CalendarDays aria-hidden="true" className="size-4" /><span>{t('hierarchy.calendar_view')}</span>
          </button>
        </div>

        {/* Search Input */}
        {viewMode !== 'calendar' && <InputGroup className="relative w-full sm:w-72">
          <InputGroupAddon><Search className="size-4" aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput aria-label={t('hierarchy.search_placeholder', 'Cari partner, nomor kontrak, atau IO...')}
            type="text"
            placeholder={t('hierarchy.search_placeholder', 'Cari partner, nomor kontrak, atau IO...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>}
      </Card>

      <div id="structure-panel" role="tabpanel" aria-labelledby={`structure-${viewMode === 'treemap' ? 'tree' : viewMode}-tab`}>
      {viewMode === 'calendar' && <WorkspaceDocumentCalendar contracts={contracts} ios={ios} partners={partners}
        loading={loading} error={error} onRetry={onRetry} onOpenDocument={onOpenCalendarDocument} />}

      {/* VIEW MODE 1: VISUAL TREEMAP */}
      {viewMode === 'treemap' && (
        <div className="space-y-4">
          {filteredPartners.length === 0 ? (
            <Card>
              <TableEmptyMessage icon={Building2} />
            </Card>
          ) : (
            filteredPartners.map((partner) => {
              const partnerContracts = contracts.filter((c) => c.partner_id === partner.partner_id);
              const isPartnerExpanded = expandedPartners[partner.partner_id] ?? false;

              // DD Document stats
              const ddDocs = (partner.daftar_dokumen_dd || []).filter((doc) => !isTerminationNoticeDocument(doc));
              const verifiedDocsCount = ddDocs.filter((d) => d.status === 'Available').length;
              const isDDComplete = partner.status_dd === 'Complete';

              return (
                <Card
                  key={partner.partner_id}
                  className="overflow-hidden hover:border-border"
                >
                  {/* LEVEL 1: CAMPAIGN HEADER (PARTNER) */}
                  <div className="p-4 border-b border-border text-foreground flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Button size="sm"
                        type="button"
                        aria-label={`${isPartnerExpanded ? t('nav.tutup_submenu', 'Tutup Submenu') : t('nav.buka_submenu', 'Buka Submenu')}: ${partner.nama_partner}`}
                        aria-expanded={isPartnerExpanded}
                        onClick={() => togglePartner(partner.partner_id)}
                      >
                        {isPartnerExpanded ? (
                          <ChevronDown className="w-5 h-5 text-accent-foreground" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-muted-foreground" />
                        )}
                      </Button>

                      <div className="size-10 rounded-md bg-primary text-white flex items-center justify-center font-extrabold text-xs shadow-xs shrink-0">
                        L1
                      </div>

                      <div>
                        <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                          <span>{partner.nama_partner}</span>
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center">
                      <Button size="sm"
                        onClick={() => onOpenAddContract(partner.partner_id)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t('hierarchy.kontrak_induk_short', 'New Contract')}</span>
                      </Button>
                    </div>
                  </div>

                  {/* LEVEL 1 DUE DILIGENCE EXPANDED SUMMARY */}
                  {isPartnerExpanded && (
                    <div className="bg-card border-b border-border p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <FileCheck className="w-3.5 h-3.5 text-accent-foreground" />
                          {t('hierarchy.dd_verification_title', 'Verifikasi Dokumen Legal Due Diligence (Level 1 Checklist):')}
                        </span>
                        <span className="text-xs font-semibold text-muted-foreground">
                          {partnerContracts.length} {t('hierarchy.contracts_linked', 'Kontrak Terhubung')}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {ddDocs.length > 0 ? (
                          ddDocs.map((doc, idx) => {
                            const displayName = localizeDueDiligenceDocument(doc, policy.dueDiligenceChecklist, language);
                            return (
                              <Card
                                key={idx}
                                className={` p-2.5 flex items-center justify-between transition-all ${
 doc.status === 'Available'
 ? 'bg-primary text-accent-foreground '
 : 'text-foreground '
 }`}
                              >
                                <div className="truncate pr-1">
                                  <span className="font-bold block truncate text-foreground" title={displayName}>{displayName}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {doc.status === 'Available' ? (doc.nomorDokumen || t('status.doc_available', 'Available')) : t('hierarchy.no_document', 'No Document')}
                                  </span>
                                </div>
                                {doc.status === 'Available' ? (
                                  <CheckCircle2 className="w-4 h-4 text-accent-foreground shrink-0" />
                                ) : (
                                  <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
                                )}
                              </Card>
                            );
                          })
                        ) : (
                          <div className="col-span-4 text-xs text-muted-foreground italic">
                            {t('hierarchy.standard_dd_docs_hint', 'The due-diligence checklist comes from your organization settings.')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* LEVEL 2 & LEVEL 3 EXPANDED LIST */}
                  {isPartnerExpanded && (
                    <div className="p-4 sm:p-6 space-y-4">
                      {partnerContracts.length === 0 ? (
                        <Card className="p-6 text-center">
                          <FileText className="w-8 h-8 text-primary-foreground mx-auto mb-2" />
                          <p className="text-xs font-semibold text-muted-foreground">
                            {t('hierarchy.no_master_contract_for_partner', 'Belum ada Kontrak Induk terdaftar untuk Partner')} ({partner.nama_partner})
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t('hierarchy.commercial_contract_hint', 'Setiap kerjasama komersial membutuhkan kontrak induk sebelum rincian IO.')}
                          </p>
                          <Button variant="ghost" size="sm"
                            onClick={() => onOpenAddContract(partner.partner_id)}
                            className="mt-3"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{t('hierarchy.create_new_master_contract', 'Buat Kontrak Induk Baru')}</span>
                          </Button>
                        </Card>
                      ) : (
                        partnerContracts.map((contract) => {
                          const contractIOs = ios.filter((i) => i.contract_id === contract.contract_id);
                          const isContractExpanded = expandedContracts[contract.contract_id] ?? true;
                          const hasContractFile = Boolean(contract.link_file_kontrak || contract.fileName);
                          const isContractAddendum =
                            contract.jenis_dokumen === 'Agreement Addendum' ||
                            Boolean(contract.parent_contract_id) ||
                            /ADD/i.test(contract.nomor_kontrak || '') ||
                            /Addendum/i.test(contract.judul_kontrak || '');

                          return (
                            <div
                              key={contract.contract_id}
                              className={`ml-0 sm:ml-4 border-l-2 pl-3 sm:pl-4 space-y-3 ${
 isContractAddendum ? 'border-status-special-border ' : 'border-primary'
 }`}
                            >
                              {/* LEVEL 2: CONTRACT CARD */}
                              <Card className="p-4 transition-all">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5">
                                    <Button size="sm"
                                      onClick={() => toggleContract(contract.contract_id)}
                                      className={` ${
 isContractAddendum
 ? ' '
 : ''
 }`}
                                    >
                                      {isContractExpanded ? (
                                        <ChevronDown className={`w-4 h-4 ${isContractAddendum ? 'text-status-special ' : 'text-accent-foreground'}`} />
                                      ) : (
                                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                      )}
                                    </Button>

                                    <div
                                      className={`w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-xs shrink-0 ${
 isContractAddendum ? 'bg-status-special' : 'bg-primary'
 }`}
                                    >
                                      L2
                                    </div>

                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {isContractAddendum ? (
                                          <span className="text-xs font-bold uppercase tracking-wider bg-status-special-soft text-status-special border border-status-special-border px-1.5 py-0.5 rounded-sm">
                                            {t('hierarchy.agreement_addendum_badge', 'AGREEMENT ADDENDUM')}
                                          </span>
                                        ) : (
                                          <span className="text-xs font-bold uppercase tracking-wider bg-primary text-accent-foreground border border-primary/30 px-1.5 py-0.5 rounded-sm">
                                            {t('hierarchy.master_agreement_badge', 'KONTRAK INDUK (MASTER AGREEMENT)')}
                                          </span>
                                        )}
                                        <span className="text-xs font-semibold text-foreground px-1.5 py-0.5 rounded-sm border border-border">
                                          {contract.nomor_kontrak}
                                        </span>
                                        <span
                                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
 contract.status === 'Active'
 ? 'bg-primary text-accent-foreground border border-primary/30'
 : contract.status === 'Expiring'
 ? 'bg-status-warning-soft text-status-warning'
 : 'bg-status-danger-soft text-status-danger'
 }`}
                                        >
                                          {t(`status.${(contract.status || '').toLowerCase().replace(' ', '_')}`, contract.status)}
                                        </span>
                                      </div>
                                      <h4 className="text-sm font-bold text-foreground mt-1 flex items-center gap-2">
                                        <span>{contract.judul_kontrak}</span>
                                      </h4>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 self-end md:self-center">
                                    {contract.link_file_kontrak && (
                                      <a
                                        href={contract.link_file_kontrak}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-2.5 py-1 bg-card hover:bg-primary text-accent-foreground text-xs font-semibold rounded-lg border border-primary/30 hover:border-primary transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                        title={t('hierarchy.download_contract_doc', 'Unduh Dokumen Kontrak')}
                                      >
                                        <FileDown className="w-3.5 h-3.5 text-accent-foreground" />
                                        <span>{t('hierarchy.download_doc', 'Unduh Dokumen')}</span>
                                      </a>
                                    )}

                                    {hasPermission('document.edit') && (
                                      <Button variant="outline" size="sm"
                                        onClick={() => onSelectContract(contract)}
                                      >
                                        {t('hierarchy.edit_btn', 'Edit')}
                                      </Button>
                                    )}

                                    <Button size="sm"
                                      onClick={() => onOpenAddIO(contract.contract_id, contract.partner_id)}
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>{t('hierarchy.new_io', 'Insertion Order Baru')}</span>
                                    </Button>
                                  </div>
                                </div>

                                {/* Contract quick terms */}
                                <div className="mt-3 pt-2.5 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-foreground">
                                  <div>
                                    <span className="text-xs text-muted-foreground block">{t('hierarchy.commercial_value', 'Nilai Komersial:')}</span>
                                    <span className="font-bold text-accent-foreground">
                                      {formatMoney(contract.nilai_kontrak, contract.currency)}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-muted-foreground block">{t('hierarchy.validity_period', 'Masa Berlaku:')}</span>
                                    <span className="font-semibold text-foreground">
                                      {contract.tanggal_mulai} s/d {contract.tanggal_berakhir}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-muted-foreground block">{t('hierarchy.notice_period', 'Notice Period:')}</span>
                                    <span className="font-semibold">{contract.notice_period_hari} {t('hierarchy.days', 'Hari')}</span>
                                  </div>
                                  <div>
                                    <span className="text-xs text-muted-foreground block">{t('hierarchy.executions_detail', 'Rincian Executions (IOs):')}</span>
                                    <span className="font-semibold text-accent-foreground">
                                      {contractIOs.length} {t('hierarchy.executions_count', 'Executions')}
                                    </span>
                                  </div>
                                </div>

                                {/* Contract Internal Notes */}
                                {contract.internal_notes && (
                                  <div className="mt-2.5 pt-2 border-t border-border bg-background rounded-lg p-2.5 flex items-start gap-2 text-xs">
                                    <FileText className="w-3.5 h-3.5 text-accent-foreground mt-0.5 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-0.5">
                                        {t('hierarchy.contract_notes', 'Catatan Kontrak / Internal Notes')}:
                                      </span>
                                      <p className="text-foreground text-xs whitespace-pre-line leading-relaxed">
                                        {contract.internal_notes}
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </Card>

                              {/* LEVEL 3: INSERTION ORDERS */}
                              {isContractExpanded && (
                                <div className="ml-3 sm:ml-6 space-y-2 border-l-2 border-primary pl-3">
                                  {contractIOs.length === 0 ? (
                                    <div className="p-3 border border-border rounded-lg text-xs text-muted-foreground flex items-center justify-between">
                                      <span>{t('hierarchy.no_io_connected', 'Belum ada Insertion Order terhubung ke Kontrak ini.')}</span>
                                      <Button variant="link"
                                        onClick={() => onOpenAddIO(contract.contract_id, contract.partner_id)}
                                      >
                                        {t('hierarchy.add_new_io', 'Tambah IO Baru')}
                                      </Button>
                                    </div>
                                  ) : (
                                    contractIOs.map((io) => {
                                      const hasIOFile = Boolean(io.link_file_io || io.fileName);
                                      const ioNoteContent = io.deliverables || (io as any).internal_notes;

                                      return (
                                        <Card
                                          key={io.io_id}
                                          className="p-3 flex flex-col gap-2.5 transition-all"
                                        >
                                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <div className="flex items-center gap-2.5">
                                              <div className="w-6 h-6 rounded-sm bg-primary text-white flex items-center justify-center font-bold text-xs shrink-0">
                                                L3
                                              </div>
                                              <div>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  <span className="text-xs font-bold uppercase tracking-wider bg-primary text-accent-foreground border border-primary/30 px-1.5 py-0.5 rounded-sm">
                                                    {t('hierarchy.insertion_order_badge', 'INSERTION ORDER (IO)')}
                                                  </span>
                                                  <span className="text-xs font-semibold text-foreground px-1.5 py-0.5 rounded-sm border border-border">
                                                    {io.nomor_io}
                                                  </span>
                                                  <span className="text-xs font-semibold bg-muted px-1.5 py-0.5 rounded-sm border border-border text-muted-foreground">
                                                    {io.kanal_media}
                                                  </span>
                                                </div>
                                                <h5 className="text-xs font-bold text-foreground mt-0.5">
                                                  {io.judul_io}
                                                </h5>
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-2 text-xs self-end sm:self-center">
                                              {io.link_file_io && (
                                                <a
                                                  href={io.link_file_io}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="px-2.5 py-1 bg-card hover:bg-primary text-accent-foreground text-xs font-semibold rounded-lg border border-primary/30 hover:border-primary transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                                  title={t('hierarchy.download_io_doc', 'Unduh Dokumen Insertion Order')}
                                                >
                                                  <FileDown className="w-3.5 h-3.5 text-accent-foreground" />
                                                  <span>{t('hierarchy.download_doc', 'Unduh Dokumen')}</span>
                                                </a>
                                              )}

                                              {hasPermission('document.edit') && (
                                                <Button variant="outline" size="sm"
                                                  onClick={() => onSelectIO(io)}
                                                >
                                                  {t('hierarchy.edit_btn', 'Edit')}
                                                </Button>
                                              )}
                                            </div>
                                          </div>

                                          {/* IO Quick Details: Commercial Value, Validity Period, Pricing Model, Charging Type */}
                                          <div className="pt-2 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-foreground">
                                            <div>
                                              <span className="text-xs text-muted-foreground block">{t('hierarchy.commercial_value', 'Nilai Komersial:')}</span>
                                              <span className="font-bold text-accent-foreground">
                                                {formatMoney(io.nilai_io, io.currency || io.mata_uang)}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-xs text-muted-foreground block">{t('hierarchy.validity_period', 'Masa Berlaku:')}</span>
                                              <span className="font-semibold text-foreground">
                                                {io.tanggal_mulai} s/d {io.tanggal_berakhir}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-xs text-muted-foreground block">{t('hierarchy.pricing_model', 'Model Biaya (Pricing Model):')}</span>
                                              <div className="mt-0.5">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs font-bold bg-primary text-accent-foreground border border-primary/20">
                                                  {io.pricing_model || 'Fixed'}
                                                </span>
                                              </div>
                                            </div>
                                            <div>
                                              <span className="text-xs text-muted-foreground block">{t('hierarchy.charging_type', 'Skema Penagihan (Charging Type):')}</span>
                                              <div className="mt-0.5">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs font-semibold bg-muted text-foreground border border-border">
                                                  {io.charging_type || io.skema_pembayaran || '-'}
                                                </span>
                                              </div>
                                            </div>
                                          </div>

                                          {/* IO Notes / Deliverables */}
                                          {ioNoteContent && (
                                            <Card className="mt-0.5 pt-2 bg-background p-2.5 flex items-start gap-2 text-xs">
                                              <FileText className="w-3.5 h-3.5 text-accent-foreground mt-0.5 shrink-0" />
                                              <div className="flex-1 min-w-0">
                                                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide block mb-0.5">
                                                  {t('hierarchy.io_notes', 'Catatan Deliverables / Scope IO')}:
                                                </span>
                                                <p className="text-foreground text-xs whitespace-pre-line leading-relaxed">
                                                  {ioNoteContent}
                                                </p>
                                              </div>
                                            </Card>
                                          )}
                                        </Card>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}

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
              const className = "border border-border  p-2 align-top";

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

              if (colId === 'vendorLinkNDA') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkNDA ? <a href={row.vendorLinkNDA} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkCOR') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkCOR ? <a href={row.vendorLinkCOR} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkDGT') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkDGT ? <a href={row.vendorLinkDGT} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkTermination') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkTermination ? <a href={row.vendorLinkTermination} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkAssessment') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkAssessment ? <a href={row.vendorLinkAssessment} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkPlacement') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkPlacement ? <a href={row.vendorLinkPlacement} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkInvoice') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkInvoice ? <a href={row.vendorLinkInvoice} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkNIB') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkNIB ? <a href={row.vendorLinkNIB} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkLicense') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkLicense ? <a href={row.vendorLinkLicense} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkNPWP') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkNPWP ? <a href={row.vendorLinkNPWP} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'vendorLinkAkta') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.vendorLinkAkta ? <a href={row.vendorLinkAkta} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
           }

           const className = "border border-border  p-2 align-top";

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
              if (colId === 'spendInvoiceLink') return <TableCell key={colId} className={`${className} text-center`}>{row.spending.invoice_file_url ? <a href={row.spending.invoice_file_url} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
              if (colId === 'spendBillingLink') return <TableCell key={colId} className={`${className} text-center`}>{row.spending.billing_file_url ? <a href={row.spending.billing_file_url} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
           }

           // Contract Group (Grouped)
           if (colId.startsWith('contract')) {
              if (!auditFlatMode && !auditSortConfig && !row.isFirstForContract) return null; // Skip rendering, covered by rowSpan
              const rowSpan = auditFlatMode || auditSortConfig ? 1 : (row.contractRowSpan || 1);

              if (!row.contract) return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>-</TableCell>;
              if (colId === 'contractNo') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.nomor_kontrak}</TableCell>;
              if (colId === 'contractTitle') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.judul_kontrak}</TableCell>;
              if (colId === 'contractStatus') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>{renderStatusBadge(row.contract.status)}</TableCell>;
              if (colId === 'contractStartDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.contract.tanggal_mulai)}</TableCell>;
              if (colId === 'contractEndDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.contract.tanggal_berakhir)}</TableCell>;
              if (colId === 'contractDuration') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contractDuration || '-'}</TableCell>;
              if (colId === 'contractValue') {
                  const cUsd = row.contract.nilai_kontrak_usd !== undefined && row.contract.nilai_kontrak_usd !== null && !isNaN(Number(row.contract.nilai_kontrak_usd))
                     ? Number(row.contract.nilai_kontrak_usd)
                     : convertToUsdWithFallback(Number(row.contract.nilai_kontrak) || 0, row.contract.currency || 'USD');
                  return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap text-right`}>{cUsd ? t('hierarchy.us', 'US$ {value}', { value: cUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }) : '-'}</TableCell>;
               }
              if (colId === 'contractKategori') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.kategori_kerjasama?.join(', ') || '-'}</TableCell>;
              if (colId === 'contractAutoRenewal') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.auto_renewal ? t('common.yes', 'Ya') : t('common.no', 'Tidak')}</TableCell>;
              if (colId === 'contractNoticePeriod') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.notice_period_hari || '-'}</TableCell>;
              if (colId === 'contractStatusApproval') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.status_approval || '-'}</TableCell>;
              if (colId === 'contractInternalNotes') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.contract.internal_notes || '-'}</TableCell>;
              if (colId === 'contractLink') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.contract.link_file_kontrak ? <a href={row.contract.link_file_kontrak} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
           }

           // IO Group (Grouped)
           if (colId.startsWith('io')) {
              if (!auditFlatMode && !auditSortConfig && !row.isFirstForIO) return null; // Skip rendering, covered by rowSpan
              const rowSpan = auditFlatMode || auditSortConfig ? 1 : (row.ioRowSpan || 1);

              if (!row.io) return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>-</TableCell>;
              if (colId === 'ioNo') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.nomor_io}</TableCell>;
              if (colId === 'ioTitle') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.judul_io}</TableCell>;
              if (colId === 'ioStatus') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap`}>{renderStatusBadge(row.io.status)}</TableCell>;
              if (colId === 'ioChannel') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.kanal_media || '-'}</TableCell>;
              if (colId === 'ioStartDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.io.tanggal_mulai)}</TableCell>;
              if (colId === 'ioEndDate') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{formatDate(row.io.tanggal_berakhir)}</TableCell>;
              if (colId === 'ioDuration') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.ioDuration || '-'}</TableCell>;
              if (colId === 'ioPricingModel') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.pricing_model || '-'}</TableCell>;
              if (colId === 'ioChargingType') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.charging_type || '-'}</TableCell>;
              if (colId === 'ioDeliverables') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} `}>{row.io.deliverables || '-'}</TableCell>;
              if (colId === 'ioValue') {
                  const ioUsd = row.io.nilai_io_usd !== undefined && row.io.nilai_io_usd !== null && !isNaN(Number(row.io.nilai_io_usd))
                     ? Number(row.io.nilai_io_usd)
                     : convertToUsdWithFallback(Number(row.io.nilai_io) || 0, row.io.currency || 'USD');
                  return <TableCell key={colId} rowSpan={rowSpan} className={`${className} whitespace-nowrap text-right`}>{ioUsd ? t('hierarchy.us', 'US$ {value}', { value: ioUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }) : '-'}</TableCell>;
               }
              if (colId === 'ioLink') return <TableCell key={colId} rowSpan={rowSpan} className={`${className} text-center`}>{row.io.link_file_io ? <a href={row.io.link_file_io} target="_blank" rel="noreferrer" className="text-status-info hover:underline">{t('hierarchy.link', 'Link')}</a> : '-'}</TableCell>;
           }

           return <TableCell key={colId} className={className}>-</TableCell>;
        };

        let auditRows: any[] = [];
        let baseRows: any[] = [];

        // Generate flat data with max-rows padding
        partners.forEach(p => {
           const pContracts = contracts.filter(c => c.partner_id === p.partner_id);
           const pIos = ios.filter(io => io.partner_id === p.partner_id);
           const pEvals = evaluations.filter(e => e.partner_id === p.partner_id || e.supplier_name.toLowerCase() === p.nama_partner.toLowerCase());
           const pSpends = spendings.filter(s => s.vendor_id === p.partner_id || s.vendor_name.toLowerCase() === p.nama_partner.toLowerCase());

           const allStartDates = [...pContracts.map(c => c.tanggal_mulai), ...pIos.map(i => i.tanggal_mulai)].filter(Boolean);
           const allEndDates = [...pContracts.map(c => c.tanggal_berakhir), ...pIos.map(i => i.tanggal_berakhir)].filter(Boolean);
           allStartDates.sort();
           allEndDates.sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime());

           const vendorStart = allStartDates[0] || null;
           const vendorEnd = allEndDates[0] || null;
           const vendorDuration = calculateDuration(vendorStart || undefined, vendorEnd || undefined);
           let vendorActive = vendorEnd ? isVendorActive(vendorEnd) : false;
           let vendorTerminated = false;

           if (pContracts.length > 0) {
              const hasActiveContracts = pContracts.some(c => c.status && c.status.toLowerCase() === 'aktif');
              const sortedContracts = [...pContracts].sort((a, b) => new Date(b.tanggal_berakhir || '').getTime() - new Date(a.tanggal_berakhir || '').getTime());
              const lastContract = sortedContracts[0];
              const isLastTerminated = lastContract && lastContract.status && lastContract.status.toLowerCase() === 'terminated';
              if (!hasActiveContracts && isLastTerminated) {
                 vendorActive = false;
                 vendorTerminated = true;
              }
           }

           // Match by policy-pack requirement key first, then by legacy name.
           const getDDLink = (nama: string, keys: string[] = []) => {
              const docs = p.daftar_dokumen_dd || [];
              const doc = docs.find(d => d.key && keys.includes(d.key) && (d.linkDrive || d.files?.length))
                || docs.find(d => d.nama.toLowerCase() === nama.toLowerCase() || d.nama.includes(nama));
              return doc?.linkDrive || doc?.files?.[0]?.linkDrive || '';
           };

           const cioRows: any[] = [];
           if (pContracts.length === 0 && pIos.length === 0) {
              // no contracts, no IOs
           } else {
              pContracts.forEach(c => {
                 const cIos = pIos.filter(io => io.contract_id === c.contract_id);
                 const contractDuration = calculateDuration(c.tanggal_mulai, c.tanggal_berakhir);
                 if (cIos.length === 0) {
                    cioRows.push({ contract: c, contractDuration, io: null, ioDuration: null });
                 } else {
                    cIos.forEach(io => {
                       const ioDuration = calculateDuration(io.tanggal_mulai, io.tanggal_berakhir);
                       cioRows.push({ contract: c, contractDuration, io: io, ioDuration });
                    });
                 }
              });
              // orphan IOs
              const orphanIos = pIos.filter(io => !io.contract_id || !pContracts.find(c => c.contract_id === io.contract_id));
              orphanIos.forEach(io => {
                 const ioDuration = calculateDuration(io.tanggal_mulai, io.tanggal_berakhir);
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
                 vendorName: p.nama_partner, vendorType: p.jenis_partner, vendorChannelName: (p.tags && p.tags.length > 0) ? p.tags.join(', ') : '-', vendorCodename: p.codename || '-', vendorStart, vendorEnd, vendorDuration, vendorActive, vendorTerminated,
                 vendorPicName: p.nama_pic, vendorPicEmail: p.email_pic, vendorPicPhone: p.telepon_pic, vendorPicAlamat: p.alamat_pic, vendorPicInternal: p.pic_internal, vendorBadanHukum: p.country ?? (p.badan_hukum === 'BHI' ? 'ID' : ''), vendorStatusDD: p.status_dd,
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
            (r.contract?.judul_kontrak || '').toLowerCase().includes(q) ||
            (r.io?.judul_io || '').toLowerCase().includes(q)
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

                case 'contractNo': return row.contract?.nomor_kontrak || '';
                case 'contractTitle': return row.contract?.judul_kontrak || '';
                case 'contractStatus': return row.contract?.status || '';
                case 'contractStartDate': return row.contract?.tanggal_mulai || '';
                case 'contractEndDate': return row.contract?.tanggal_berakhir || '';
                case 'contractValue': return row.contract?.nilai_kontrak_usd !== undefined && row.contract?.nilai_kontrak_usd !== null && !isNaN(Number(row.contract.nilai_kontrak_usd)) ? Number(row.contract.nilai_kontrak_usd) : convertToUsdWithFallback(Number(row.contract?.nilai_kontrak) || 0, row.contract?.currency || 'USD');

                case 'ioNo': return row.io?.nomor_io || '';
                case 'ioTitle': return row.io?.judul_io || '';
                case 'ioStatus': return row.io?.status || '';
                case 'ioChannel': return row.io?.kanal_media || '';
                case 'ioStartDate': return row.io?.tanggal_mulai || '';
                case 'ioEndDate': return row.io?.tanggal_berakhir || '';
                case 'ioValue': return row.io?.nilai_io_usd !== undefined && row.io?.nilai_io_usd !== null && !isNaN(Number(row.io.nilai_io_usd)) ? Number(row.io.nilai_io_usd) : convertToUsdWithFallback(Number(row.io?.nilai_io) || 0, row.io?.currency || 'USD');
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

              contractNo: row.contract?.nomor_kontrak || '',
              contractTitle: row.contract?.judul_kontrak || '',
              contractStatus: row.contract?.status || '',
              contractStartDate: formatDate(row.contract?.tanggal_mulai),
              contractEndDate: formatDate(row.contract?.tanggal_berakhir),
              contractDuration: row.contractDuration || '',
              contractValue: row.contract ? (row.contract.nilai_kontrak_usd !== undefined && row.contract.nilai_kontrak_usd !== null && !isNaN(Number(row.contract.nilai_kontrak_usd)) ? row.contract.nilai_kontrak_usd : convertToUsdWithFallback(row.contract.nilai_kontrak || 0, row.contract.currency || 'USD')).toString() : '',
              contractKategori: row.contract?.kategori_kerjasama || '',
              contractAutoRenewal: row.contract?.auto_renewal ? 'Ya' : 'Tidak',
              contractNoticePeriod: (row.contract?.notice_period_days || '').toString(),
              contractStatusApproval: row.contract?.status_approval || '',
              contractInternalNotes: row.contract?.internal_notes || '',
              contractLink: row.contract?.link_file_kontrak || '',

              ioNo: row.io?.nomor_io || '',
              ioTitle: row.io?.judul_io || '',
              ioStatus: row.io?.status || '',
              ioChannel: row.io?.kanal_media || '',
              ioStartDate: formatDate(row.io?.tanggal_mulai),
              ioEndDate: formatDate(row.io?.tanggal_berakhir),
              ioDuration: row.ioDuration || '',
              ioPricingModel: row.io?.pricing_model || '',
              ioChargingType: row.io?.charging_type || '',
              ioDeliverables: row.io?.deliverables || '',
              ioValue: row.io ? (row.io.nilai_io_usd !== undefined && row.io.nilai_io_usd !== null && !isNaN(Number(row.io.nilai_io_usd)) ? row.io.nilai_io_usd : convertToUsdWithFallback(row.io.nilai_io || 0, row.io.currency || 'USD')).toString() : '',
              ioLink: row.io?.link_file_io || '',
            };
            return columns.filter(c => auditVisibleCols[c.id]).map(c => rowData[c.id]);
          });
          downloadCsv(`Tabel_Audit_${new Date().getTime()}.csv`, headers, csvRows);
        };

        return (
          <div className={`bg-card rounded-2xl border border-border shadow-xs overflow-hidden flex flex-col ${baseRows.length === 0 ? '' : 'h-[calc(100vh-190px)]'}`}>
            <div className="p-4 bg-background border-b border-border flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-accent-foreground" />
                <Heading as="h3" size="sm" weight="semibold">{t('hierarchy.audit_table_title', 'Tabel Audit Lengkap')}</Heading>
              </div>
              <div className="mobile-page-actions flex flex-wrap items-center gap-3">
                <Button variant="outline"
                  onClick={() => setAuditFlatMode(!auditFlatMode)}
                  className={` ${
 auditFlatMode ? '' : ''
 }`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  {auditFlatMode ? t('hierarchy.view_flat', 'Tampilan: Datar (Bisa di-Sort)') : t('hierarchy.view_grouped', 'Tampilan: Grouping Row')}
                </Button>
                <div className="relative">
                  <Button variant="outline"
                    onClick={() => setShowColPicker(!showColPicker)}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    {t('hierarchy.custom_columns', 'Kustom Kolom')}
                  </Button>
                  {showColPicker && (
                    <Card className="absolute right-0 top-full mt-2 w-64 z-50 overflow-hidden flex flex-col backdrop-blur-none ring-1 ring-black/5">
                      <div className="p-2.5 bg-card border-b border-border flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-muted-foreground uppercase">{t('hierarchy.custom_columns_title', 'Kustomisasi Kolom')}</span>
                          <Button variant="ghost" size="sm"
                            onClick={() => setAuditVisibleCols(INITIAL_AUDIT_COLS)}
                          >
                            {t('hierarchy.reset', 'Reset')}
                          </Button>
                        </div>
                        <Checkbox checked={Object.keys(INITIAL_AUDIT_COLS).every(k => auditVisibleCols[k])} onCheckedChange={(details) => {
                              const isChecked = details.checked === true;
                              const newState = {} as Record<string, boolean>;
                              Object.keys(INITIAL_AUDIT_COLS).forEach(k => newState[k] = isChecked);
                              setAuditVisibleCols(newState);
                            }}><CheckboxControl /><CheckboxLabel><span className="text-xs font-bold text-foreground">{t('hierarchy.select_all', 'Pilih Semua / Kosongkan')}</span></CheckboxLabel><CheckboxHiddenInput /></Checkbox>
                      </div>
                      <div className="p-3 bg-card max-h-[300px] overflow-y-auto">
                        {['Vendor', 'Evaluation', 'Spending', 'Contract', 'IO'].map(groupName => (
                          <div key={groupName} className="mb-3 last:mb-0">
                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 px-1 border-b border-border pb-1">{t(`audit_group_${groupName.toLowerCase()}`, groupName)}</div>
                            {columns.filter(c => c.group === groupName).map(col => (
                              <Checkbox checked={!!auditVisibleCols[col.id]} onCheckedChange={(details) => setAuditVisibleCols(prev => ({...prev, [col.id]: details.checked === true}))}><CheckboxControl /><CheckboxLabel>{t(`audit_col_${col.id}`, col.label)}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
                            ))}
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
                {hasPermission('export.csv') && (
                  <Button
                    onClick={exportToCSV}
                    disabled={baseRows.length === 0}
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    {t('hierarchy.export_csv', 'Ekspor CSV')}
                  </Button>
                )}
              </div>
            </div>
            <div className="@container p-0 overflow-auto flex-1">
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
                        className={`whitespace-nowrap ${auditFlatMode ? ' ' : ''}`}
                      >
                        {auditFlatMode ? (
                          <button
                            type="button"
                            onClick={() => handleSort(col.id)}
                            className="w-full flex items-center justify-between gap-2 text-left hover:text-foreground transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none rounded-sm py-0.5"
                            title={t('hierarchy.urutkan_berdasarkan', 'Urutkan berdasarkan {label}', { label: t(`audit_col_${col.id}`, col.label) })}
                          >
                            <span>{t(`audit_col_${col.id}`, col.label)}</span>
                            {auditSortConfig?.key === col.id ? (
                              <span className="text-accent-foreground font-bold shrink-0">{auditSortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs shrink-0">↕</span>
                            )}
                          </button>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span>{t(`audit_col_${col.id}`, col.label)}</span>
                          </div>
                        )}
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
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
};
