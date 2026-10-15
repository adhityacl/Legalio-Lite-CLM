import React, { useId, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, FileText, Folder, FolderOpen, Pencil, type LucideIcon } from 'lucide-react';
import type { Contract, DDDokumenItem, InsertionOrder, Partner } from '@legalio/types';
import { DD_STATUS_LABEL_KEY, DOC_STATUS_LABEL_KEY } from '@legalio/types/domainStatus';
import { isTerminationNoticeDocument, localizeDueDiligenceDocument } from '@legalio/shared/dueDiligence';
import { formatMoney, getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { Badge, statusTone } from '@legalio/ui-components/badge';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { TableEmptyMessage } from './ui/table-empty-state';
import { Spinner } from '@legalio/ui-components/spinner';
import { Menu, MenuContent, MenuItem, MenuPositioner, MenuTrigger, MenuViewport } from '@legalio/ui-components/menu';
import { useLanguage } from '../context/LanguageContext';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { usePermissions } from '../lib/permissions';

type OwnerKind = 'partner' | 'contract' | 'io';
type Selection = { kind: OwnerKind; id: string } | { kind: 'file'; owner: OwnerKind; id: string; fileKey: string };
type TreeFile = { key: string; name: string; url: string; status: string; updatedAt?: string };
interface Props {
  partners: Partner[]; contracts: Contract[]; ios: InsertionOrder[]; searchQuery: string;
  loading?: boolean; error?: boolean; onRetry?: () => void;
  onSelectPartner: (partner: Partner) => void;
  onSelectContract: (contract: Contract) => void;
  onSelectIO: (io: InsertionOrder) => void;
  onOpenAddPartner: () => void;
  onOpenAddContract: (partnerId?: string) => void;
  onOpenAddIO: (contractId?: string, partnerId?: string) => void;
}

function TreeRow({ title, subtitle, icon: Icon, badge, selected, expanded, controls, onToggle, onSelect, toggleLabel }: {
  title: string; subtitle?: string; icon: LucideIcon; badge?: React.ReactNode; selected?: boolean;
  expanded?: boolean; controls?: string; onToggle?: () => void; onSelect: () => void; toggleLabel?: string;
}) {
  return <div data-hierarchy-row className={`flex min-w-0 items-center gap-g5 rounded-md border px-g5 py-g5 ${selected ? 'border-primary/70 bg-accent' : 'border-transparent hover:bg-muted/60'}`}>
    {onToggle ? <Button variant="ghost" size="icon-sm" className="shrink-0 max-lg:size-11" aria-label={toggleLabel} aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
      {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
    </Button> : <span aria-hidden="true" className="w-g16 shrink-0 border-t border-border" />}
    <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-g8 px-0 py-g3 text-start font-normal whitespace-normal hover:bg-transparent max-lg:min-h-11" onClick={onSelect} aria-current={selected ? 'true' : undefined} aria-label={title}>
      <Icon aria-hidden="true" className={`size-g16 shrink-0 ${selected ? 'text-accent-foreground' : 'text-muted-foreground'}`} />
      <span className="min-w-0 flex-1 wrap-anywhere"><span className="block text-sm text-foreground">{title}</span>{subtitle && <span className="mt-g2 block text-xs leading-relaxed text-muted-foreground">{subtitle}</span>}</span>
    </Button>
    {badge && <span className="max-w-[30%] shrink-0 text-end [&_[data-slot=badge-root]]:rounded-sm [&_[data-slot=badge-root]]:px-g5 [&_[data-slot=badge-root]]:whitespace-normal [&_[data-slot=badge-root]]:wrap-anywhere">{badge}</span>}
  </div>;
}

/** Selection shows existing record metadata; files keep their owning record's edit action. */
export function HierarchyTreeView(props: Props) {
  const { partners, contracts, ios, searchQuery, loading, error, onRetry } = props;
  const { t, language } = useLanguage();
  const { policy } = useTenantSettings();
  const { hasPermission } = usePermissions();
  const prefix = useId();
  const treeRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const query = searchQuery.trim().toLowerCase();
  const statusLabel = (status?: string) => status ? t(({ ...DD_STATUS_LABEL_KEY, ...DOC_STATUS_LABEL_KEY } as Record<string, string>)[status] || `status.${status.toLowerCase().replaceAll(' ', '_')}`, status) : '—';
  const checklist = (partner?: Partner) => (partner?.daftar_dokumen_dd || []).filter(doc => !isTerminationNoticeDocument(doc));
  const documentName = (doc: DDDokumenItem) => localizeDueDiligenceDocument(doc, policy.dueDiligenceChecklist, language);
  const partnerContracts = (id: string) => contracts.filter(contract => contract.partner_id === id);
  const contractIOs = (id: string) => ios.filter(io => io.contract_id === id);
  const partnerIOs = (id: string) => ios.filter(io => io.partner_id === id);
  const safeLink = (link?: string) => {
    if (!link) return '';
    try { const url = new URL(link, window.location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  const filesFor = (kind: OwnerKind, id: string): TreeFile[] => {
    if (kind === 'partner') return checklist(partners.find(p => p.partner_id === id)).flatMap((doc, index) => {
      if (doc.files?.length) return doc.files.map(file => ({ key: `${index}:${file.id}`, name: file.fileName, url: safeLink(file.linkDrive), status: doc.status, updatedAt: file.uploadedAt }));
      return doc.linkDrive || doc.status === 'Available' ? [{ key: `${index}`, name: documentName(doc), url: safeLink(doc.linkDrive), status: doc.status, updatedAt: doc.uploadedAt }] : [];
    });
    const record = kind === 'contract' ? contracts.find(c => c.contract_id === id) : ios.find(io => io.io_id === id);
    if (!record) return [];
    const url = safeLink(kind === 'contract' ? (record as Contract).link_file_kontrak : (record as InsertionOrder).link_file_io);
    const name = record.fileName || (kind === 'contract' ? (record as Contract).judul_kontrak : (record as InsertionOrder).judul_io);
    return url || record.fileName ? [{ key: 'main', name, url, status: kind === 'contract' ? (record as Contract).status_approval || record.status : record.status, updatedAt: record.updated_at }] : [];
  };
  const matches = (...values: (string | undefined)[]) => values.some(value => value?.toLowerCase().includes(query));
  const filteredPartners = partners.filter(partner => !query || matches(partner.nama_partner, partner.jenis_partner, ...checklist(partner).map(documentName), ...filesFor('partner', partner.partner_id).map(file => file.name))
    || partnerContracts(partner.partner_id).some(contract => matches(contract.nomor_kontrak, contract.judul_kontrak, contract.fileName))
    || partnerIOs(partner.partner_id).some(io => matches(io.nomor_io, io.judul_io, io.fileName)));
  const fallback: Selection | null = filteredPartners[0] ? { kind: 'partner', id: filteredPartners[0].partner_id } : null;
  const selectedOwner = selection?.kind === 'file' ? selection.owner : selection?.kind;
  const ownerExists = selectedOwner === 'partner' ? partners.some(p => p.partner_id === selection?.id) : selectedOwner === 'contract' ? contracts.some(c => c.contract_id === selection?.id) : selectedOwner === 'io' && ios.some(io => io.io_id === selection?.id);
  const selectionExists = ownerExists && (selection?.kind !== 'file' || filesFor(selection.owner, selection.id).some(item => item.key === selection.fileKey));
  const active = selectionExists ? selection : fallback;
  const ownerKind = active?.kind === 'file' ? active.owner : active?.kind;
  const contract = ownerKind === 'contract' ? contracts.find(c => c.contract_id === active?.id) : ownerKind === 'io' ? contracts.find(c => c.contract_id === ios.find(io => io.io_id === active?.id)?.contract_id) : undefined;
  const io = ownerKind === 'io' ? ios.find(item => item.io_id === active?.id) : undefined;
  const partner = partners.find(p => p.partner_id === (ownerKind === 'partner' ? active?.id : io?.partner_id || contract?.partner_id));
  const selectedFiles = active && ownerKind ? filesFor(ownerKind, active.id) : [];
  const file = active?.kind === 'file' ? selectedFiles.find(item => item.key === active.fileKey) : undefined;
  const ddDocs = partner ? checklist(partner) : [];
  const available = ddDocs.filter(doc => doc.status === 'Available').length;
  const missingRequired = ddDocs.filter(doc => doc.wajib && doc.status !== 'Available').length;
  const activeContracts = partner ? partnerContracts(partner.partner_id).filter(c => ['Active', 'Expiring'].includes(c.status)) : [];
  const operational = activeContracts.length ? 'Active' : 'Review';
  const expansionKey = (key: string) => query ? JSON.stringify([query, key]) : key;
  const isOpen = (key: string, initial = true) => expanded[expansionKey(key)] ?? (Boolean(query) || initial);
  const toggle = (key: string, initial = true) => setExpanded(previous => ({ ...previous, [expansionKey(key)]: !(previous[expansionKey(key)] ?? (Boolean(query) || initial)) }));
  const select = (next: Selection) => {
    setSelection(next);
    if (window.matchMedia('(max-width: 1023px)').matches) requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  };
  const isSelected = (node: Selection) => active?.kind === node.kind && active.id === node.id && (node.kind !== 'file' || (active.kind === 'file' && active.owner === node.owner && active.fileKey === node.fileKey));
  const date = (value?: string) => {
    if (!value || Number.isNaN(Date.parse(value))) return '—';
    return new Date(value).toLocaleDateString(getActiveFormattingLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const period = (record?: Contract | InsertionOrder) => record ? `${date(record.tanggal_mulai)} – ${date(record.tanggal_berakhir || record.tanggal_selesai)}` : '—';
  const treeBadge = (status?: string) => <Badge tone={statusTone(status || '')}>{statusLabel(status)}</Badge>;
  const rowProps = (node: Selection) => ({ selected: isSelected(node), onSelect: () => select(node) });
  const toggleLabel = (title: string, open: boolean) => `${t(open ? 'nav.tutup_submenu' : 'nav.buka_submenu')}: ${title}`;
  const fileRows = (kind: OwnerKind, id: string) => filesFor(kind, id).map(item => <li key={item.key}><TreeRow title={item.name} icon={FileText} badge={<span className="text-xs text-muted-foreground">{statusLabel(item.status)}</span>} {...rowProps({ kind: 'file', owner: kind, id, fileKey: item.key })} /></li>);
  const branchClass = 'ml-g13 space-y-g3 border-l border-border pl-g8 sm:ml-g21 sm:pl-g13';
  const renderIO = (item: InsertionOrder) => {
    const key = `io:${item.io_id}`, open = isOpen(key);
    return <li key={key}>
      <TreeRow title={item.nomor_io} subtitle={`${t('hierarchy.insertion_order_badge')} · ${period(item)}`} icon={open ? FolderOpen : Folder} badge={treeBadge(item.status)} controls={`${prefix}-${key}`} expanded={open} onToggle={() => toggle(key)} toggleLabel={toggleLabel(item.nomor_io, open)} {...rowProps({ kind: 'io', id: item.io_id })} />
      {open && <ul id={`${prefix}-${key}`} className={branchClass}>{fileRows('io', item.io_id)}{!filesFor('io', item.io_id).length && <li className="px-g8 py-g8 text-xs text-muted-foreground">{t('hierarchy.no_document')}</li>}</ul>}
    </li>;
  };
  const detailField = (label: string, value: React.ReactNode) => <div className="min-w-0"><dt className="mb-g5 text-xs text-muted-foreground">{label}</dt><dd className="m-0 text-sm text-foreground wrap-anywhere">{value || '—'}</dd></div>;
  const detailTitle = file?.name || (ownerKind === 'partner' ? partner?.nama_partner : ownerKind === 'io' ? io?.nomor_io : contract?.nomor_kontrak);
  const edit = () => { if (ownerKind === 'partner' && partner) props.onSelectPartner(partner); else if (ownerKind === 'io' && io) props.onSelectIO(io); else if (contract) props.onSelectContract(contract); };
  const canEdit = hasPermission('document.edit');
  const uploadedFiles = (active?.kind === 'file' ? (file ? [file] : []) : selectedFiles).filter(item => item.url);
  const primaryDocument = uploadedFiles.length === 1 ? uploadedFiles[0] : undefined;

  if (loading) return <Card className="p-g21"><span role="status" className="flex items-center gap-g8"><Spinner size="sm" decorative />{t('sys.loading', 'Loading…')}</span></Card>;
  if (error) return <Alert status="error"><AlertIndicator /><AlertContent><AlertDescription>{t('app.failed_to_fetch_initial_data')}</AlertDescription>{onRetry && <Button variant="outline" className="mt-g8" onClick={onRetry}>{t('common.retry')}</Button>}</AlertContent></Alert>;
  if (!filteredPartners.length) return <TableEmptyMessage />;

  return <div className="grid min-w-0 items-start gap-g13 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
    <Card ref={treeRef} role="region" tabIndex={-1} className="min-w-0 overflow-hidden bg-card/60 lg:min-h-[48rem]" aria-label={t('tree.documents_status')}>
      <div className="border-b border-border px-g13 py-g13 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t('tree.documents_status')}</div>
      <ul className="space-y-g3 p-g8">
        {filteredPartners.map((item, index) => {
          const key = `partner:${item.partner_id}`, open = isOpen(key, index === 0);
          const linkedContracts = partnerContracts(item.partner_id);
          const activeVendor = linkedContracts.some(c => ['Active', 'Expiring'].includes(c.status));
          return <li key={key}>
            <TreeRow title={item.nama_partner} subtitle={`${item.jenis_partner || t('tree.partner')} · ${item.tags?.join(', ') || '—'}`} icon={open ? FolderOpen : Folder} badge={treeBadge(activeVendor ? 'Active' : 'Review')} expanded={open} controls={`${prefix}-${key}`} onToggle={() => toggle(key, index === 0)} toggleLabel={toggleLabel(item.nama_partner, open)} {...rowProps({ kind: 'partner', id: item.partner_id })} />
            {open && <ul id={`${prefix}-${key}`} className={branchClass}>
              {linkedContracts.map(itemContract => {
                const contractKey = `contract:${itemContract.contract_id}`, contractOpen = isOpen(contractKey);
                return <li key={contractKey}>
                  <TreeRow title={itemContract.nomor_kontrak} subtitle={`${t('tree.contract')} · ${period(itemContract)}`} icon={contractOpen ? FolderOpen : Folder} badge={treeBadge(itemContract.status)} expanded={contractOpen} controls={`${prefix}-${contractKey}`} onToggle={() => toggle(contractKey)} toggleLabel={toggleLabel(itemContract.nomor_kontrak, contractOpen)} {...rowProps({ kind: 'contract', id: itemContract.contract_id })} />
                  {contractOpen && <ul id={`${prefix}-${contractKey}`} className={branchClass}>{fileRows('contract', itemContract.contract_id)}{contractIOs(itemContract.contract_id).map(renderIO)}</ul>}
                </li>;
              })}
              {partnerIOs(item.partner_id).filter(itemIO => !linkedContracts.some(c => c.contract_id === itemIO.contract_id)).map(renderIO)}
              {!linkedContracts.length && <li className="px-g8 py-g8 text-xs text-muted-foreground">{t('hierarchy.no_master_contract_for_partner')}</li>}
            </ul>}
          </li>;
        })}
      </ul>
    </Card>

    <Card ref={detailRef} role="region" tabIndex={-1} className="min-w-0 scroll-mt-g13 p-g13 sm:p-g21 lg:sticky lg:top-0 lg:min-h-[48rem]" aria-label={t('tree.selected_details')}>
      <Button variant="ghost" className="mb-g13 min-h-11 self-start lg:hidden" onClick={() => { treeRef.current?.focus({ preventScroll: true }); treeRef.current?.scrollIntoView({ block: 'start' }); }}><ArrowLeft aria-hidden="true" />{t('tree.back_to_tree')}</Button>
      <div className="mb-g21 flex items-center gap-g8 text-xs font-semibold tracking-wider text-accent-foreground uppercase">{active?.kind === 'file' ? <FileText aria-hidden="true" className="size-g16" /> : <FolderOpen aria-hidden="true" className="size-g16" />}{t(active?.kind === 'file' ? 'tree.file_selected' : `tree.${ownerKind}_selected`)}</div>
      <Heading as="h3" size="md" weight="semibold" className="wrap-anywhere">{detailTitle}</Heading>
      <p className="mt-g8 text-sm text-muted-foreground wrap-anywhere">{active?.kind === 'file' ? t('tree.file_context') : ownerKind === 'partner' ? t('tree.partner_context') : ownerKind === 'io' ? io?.judul_io : contract?.judul_kontrak}</p>
      <div className="mt-g8 flex flex-wrap gap-g5">{active?.kind === 'file' && file ? <Badge tone={statusTone(file.status)}>{statusLabel(file.status)}</Badge> : treeBadge(ownerKind === 'partner' ? operational : io?.status || contract?.status || '')}{partner && ownerKind === 'partner' && <Badge tone={statusTone(partner.status_dd)}>{statusLabel(partner.status_dd)}</Badge>}{ownerKind === 'contract' && contract?.status_approval && treeBadge(contract.status_approval)}</div>
      <div className="my-g21 flex flex-wrap gap-g8">
        {primaryDocument ? (
          <Button asChild className="min-h-11 min-w-0 flex-1"><a href={primaryDocument.url} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{t('tree.open_document')}</a></Button>
        ) : uploadedFiles.length > 1 ? (
          <Menu positioning={{ placement: 'bottom-start', gutter: 8 }}>
            <MenuTrigger asChild><Button className="min-h-11 min-w-0 flex-1"><FileText aria-hidden="true" />{t('tree.view_documents')}<ChevronDown aria-hidden="true" /></Button></MenuTrigger>
            <MenuPositioner><MenuContent className="max-w-[calc(100vw-2rem)]"><MenuViewport className="max-h-g377">
              {uploadedFiles.map(item => <MenuItem key={item.key} value={item.key} asChild><a href={item.url} target="_blank" rel="noopener noreferrer" className="whitespace-normal wrap-anywhere"><FileText aria-hidden="true" />{item.name}<ExternalLink aria-hidden="true" /></a></MenuItem>)}
            </MenuViewport></MenuContent></MenuPositioner>
          </Menu>
        ) : <Button disabled className="min-h-11 flex-1">{t(selectedFiles.length ? 'tree.no_file_link' : 'hierarchy.no_document')}</Button>}
        {canEdit && <Button variant="outline" className="min-h-11" onClick={edit}><Pencil aria-hidden="true" />{t('hierarchy.edit_btn')}</Button>}
      </div>
      <section className="border-t border-border py-g13">
        <h4 className="mb-g13 text-xs font-medium tracking-wider text-muted-foreground uppercase">{t(active?.kind === 'file' ? 'tree.file_information' : `tree.${ownerKind}_information`)}</h4>
        <dl className="grid grid-cols-1 gap-g13 min-[400px]:grid-cols-2">
          {active?.kind === 'file' ? <>{detailField(t('tree.filename'), file?.name)}{detailField(t('tree.last_updated'), date(file?.updatedAt))}{detailField(t('tree.owner'), ownerKind === 'partner' ? partner?.nama_partner : io?.nomor_io || contract?.nomor_kontrak)}{detailField(t('tree.document_status'), statusLabel(file?.status))}</> : ownerKind === 'partner' ? <>{detailField(t('tree.operational_status'), statusLabel(operational))}{detailField(t('tree.legal_verification'), statusLabel(partner?.status_dd || ''))}{detailField(t('tree.responsible'), partner?.pic_internal || partner?.internal_pic)}{detailField(t('tree.last_verified'), date(partner?.tanggal_dd_diverifikasi))}</> : <>{detailField(t('hierarchy.validity_period'), period(io || contract))}{detailField(t('hierarchy.commercial_value'), io ? formatMoney(io.nilai_io, io.currency || io.mata_uang) : formatMoney(contract?.nilai_kontrak || 0, contract?.currency))}{io ? <>{detailField(t('hierarchy.pricing_model'), io.pricing_model)}{detailField(t('hierarchy.charging_type'), io.charging_type || io.skema_pembayaran)}</> : <>{detailField(t('hierarchy.notice_period'), `${contract?.notice_period_hari || 0} ${t('hierarchy.days')}`)}{detailField(t('tree.responsible'), contract?.pic_internal)}</>}</>}
        </dl>
      </section>
      {ownerKind !== 'partner' && <section className="border-t border-border py-g13"><h4 className="mb-g13 text-xs font-medium tracking-wider text-muted-foreground uppercase">{t('tree.contract_partner')}</h4>{contract && <p className="text-sm font-medium wrap-anywhere">{contract.nomor_kontrak}</p>}<p className="mt-g8 text-xs text-muted-foreground wrap-anywhere">{partner?.nama_partner || '—'}</p></section>}
      {active?.kind !== 'file' && <section className="border-t border-border py-g13">
        <div className="mb-g13 flex flex-wrap items-center justify-between gap-g8"><h4 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{t(ownerKind === 'partner' ? 'tree.legal_documents' : 'tree.documents')}</h4><span className="text-xs text-muted-foreground">{ownerKind === 'partner' ? `${available}/${ddDocs.length} ${t('tree.available')}` : t('tree.file_count', undefined, { count: selectedFiles.length })}</span></div>
        {ownerKind === 'partner' && ddDocs.length > 0 && <progress aria-label={t('tree.legal_documents')} max={ddDocs.length} value={available} className="mb-g8 h-g3 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-status-warning [&::-moz-progress-bar]:bg-status-warning" />}
        {selectedFiles.map(item => <Button key={item.key} variant="ghost" className="h-auto min-h-11 w-full justify-start px-0 py-g8 text-start whitespace-normal" onClick={() => active && ownerKind && select({ kind: 'file', owner: ownerKind, id: active.id, fileKey: item.key })}><FileText aria-hidden="true" className="shrink-0" /><span className="min-w-0 flex-1 text-xs wrap-anywhere">{item.name}</span><span className="text-xs font-normal text-muted-foreground">{statusLabel(item.status)}</span><ChevronRight aria-hidden="true" className="shrink-0" /></Button>)}
        {!selectedFiles.length && <p className="text-xs text-muted-foreground">{t('hierarchy.no_document')}</p>}
        {ownerKind === 'partner' && partner && <div className="mt-g13 flex flex-wrap justify-between gap-g8 text-xs text-muted-foreground"><span>{t('tree.linked_records')}</span><span>{partnerContracts(partner.partner_id).length} {t('tree.contract')} · {partnerIOs(partner.partner_id).length} IO</span></div>}
      </section>}
      {missingRequired > 0 && <Alert status="warning" className="mt-g8"><AlertIndicator /><AlertContent><AlertDescription className="text-xs leading-relaxed"><strong className="mb-g5 block">{t('tree.missing_required', undefined, { count: missingRequired })}</strong>{t('tree.legal_warning')}</AlertDescription></AlertContent></Alert>}
      {(io?.deliverables || io?.internal_notes || contract?.internal_notes || (ownerKind === 'partner' && partner?.catatan)) && <section className="mt-g13 border-t border-border pt-g13"><h4 className="mb-g8 text-xs font-medium tracking-wider text-muted-foreground uppercase">{t('tree.notes')}</h4><p className="text-sm leading-relaxed whitespace-pre-line wrap-anywhere">{io?.deliverables || io?.internal_notes || contract?.internal_notes || partner?.catatan}</p></section>}
    </Card>
  </div>;
}
