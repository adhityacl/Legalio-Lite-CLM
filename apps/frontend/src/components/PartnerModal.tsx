import { AlphabeticalDatalist, AlphabeticalSelect } from './ui/alphabetical-select';
import { ModalFrame, ModalTitle } from './ui/modal-frame';
import React, { useState } from 'react';
import { Partner, PartyIdentifier } from '@legalio/types';
import { Building2, User, Mail, Phone, X, MapPin, Upload, Loader2, Shield } from 'lucide-react';
import { AiIcon } from './icons/AiIcon';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { isGlobalRole } from '../lib/rbacScoping';
import { getSavedCategories, saveCategory, saveMultipleCategories } from '../lib/categoryUtils';
import { useDepartments } from '../hooks/useDepartments';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { PartnerJurisdictionFields } from './partners/PartnerJurisdictionFields';

export const ENTERPRISE_DEPARTMENTS = [
  'Executive Office',
  'Commercial & Marketing',
  'Legal & Compliance',
  'Finance & Tax',
  'Operasional & HR',
  'Teknologi & IT',
];

interface PartnerModalProps {
  partnerToEdit?: Partner | null;
  onClose: () => void;
  onSave: (partnerData: any) => Promise<void>;
}

export const PartnerModal: React.FC<PartnerModalProps> = ({
  partnerToEdit,
  onClose,
  onSave,
}) => {
  const { t } = useLanguage();

  const getInitialNamaPic = () => {
    if (partnerToEdit?.nama_pic) return partnerToEdit.nama_pic;
    if (!partnerToEdit?.pic_partner) return '';
    const match = partnerToEdit.pic_partner.match(/^(.*?)\s*(?:\((.*?)\))?$/);
    return match ? match[1].trim() : partnerToEdit.pic_partner;
  };

  const getInitialEmailPic = () => {
    if (partnerToEdit?.email_pic) return partnerToEdit.email_pic;
    if (partnerToEdit?.kontak_pic) {
      const parts = partnerToEdit.kontak_pic.split(/[/|]/);
      const emailPart = parts.find((p) => p.includes('@'));
      if (emailPart) return emailPart.trim();
    }
    if (partnerToEdit?.pic_partner) {
      const match = partnerToEdit.pic_partner.match(/\((.*?)\)/);
      if (match) {
        const inside = match[1];
        const parts = inside.split(/[/|]/);
        const emailPart = parts.find((p) => p.includes('@'));
        if (emailPart) return emailPart.trim();
      }
    }
    return '';
  };

  const getInitialTeleponPic = () => {
    if (partnerToEdit?.telepon_pic) return partnerToEdit.telepon_pic;
    if (partnerToEdit?.kontak_pic) {
      const parts = partnerToEdit.kontak_pic.split(/[/|]/);
      const phonePart = parts.find((p) => !p.includes('@') && /\d/.test(p));
      if (phonePart) return phonePart.trim();
    }
    if (partnerToEdit?.pic_partner) {
      const match = partnerToEdit.pic_partner.match(/\((.*?)\)/);
      if (match) {
        const inside = match[1];
        const parts = inside.split(/[/|]/);
        const phonePart = parts.find((p) => !p.includes('@') && /\d/.test(p));
        if (phonePart) return phonePart.trim();
      }
    }
    return '';
  };


  const { user } = useAuth();
  const isGlobal = isGlobalRole(user?.role);
  const userDept = user?.department || 'Commercial & Marketing';
  const { departments: ENTERPRISE_DEPARTMENTS } = useDepartments();

  const [namaPartner, setNamaPartner] = useState(partnerToEdit?.nama_partner || '');
  const [codename, setCodename] = useState(partnerToEdit?.codename || '');
  const { policy } = useTenantSettings();
  // New partners default to the organization's own country.
  const [country, setCountry] = useState<string>(
    partnerToEdit ? (partnerToEdit.country ?? (partnerToEdit.badan_hukum === 'BHI' ? 'ID' : '')) : (policy.settings.countryCode === 'INTL' ? '' : policy.settings.countryCode),
  );
  const [entityType, setEntityType] = useState(partnerToEdit?.entity_type || '');
  const [identifiers, setIdentifiers] = useState<PartyIdentifier[]>(partnerToEdit?.identifiers || []);
  const [picInternal, setPicInternal] = useState(partnerToEdit?.pic_internal || userDept);
  
  // Update custom dept flag dynamically when departments load
  React.useEffect(() => {
    if (partnerToEdit?.pic_internal) {
      setIsCustomDept(!ENTERPRISE_DEPARTMENTS.includes(partnerToEdit.pic_internal));
    }
  }, [ENTERPRISE_DEPARTMENTS, partnerToEdit?.pic_internal]);

  const [isCustomDept, setIsCustomDept] = useState<boolean>(() => {
    if (partnerToEdit?.pic_internal) {
      return !ENTERPRISE_DEPARTMENTS.includes(partnerToEdit.pic_internal);
    }
    return false;
  });
  const [namaPic, setNamaPic] = useState(getInitialNamaPic);
  const [emailPic, setEmailPic] = useState(getInitialEmailPic);
  const [teleponPic, setTeleponPic] = useState(getInitialTeleponPic);
  const [alamatPic, setAlamatPic] = useState(partnerToEdit?.alamat_pic || '');
  const [catatan, setCatatan] = useState(partnerToEdit?.catatan || '');
  const [tags, setTags] = useState<string[]>(
    partnerToEdit?.tags && partnerToEdit.tags.length > 0 ? partnerToEdit.tags : []
  );
  const [savedTemplates, setSavedTemplates] = useState<string[]>(() => {
    const loaded = getSavedCategories(policy.industry.partnerCategories);
    if (partnerToEdit?.tags && partnerToEdit.tags.length > 0) {
      return saveMultipleCategories(partnerToEdit.tags);
    }
    return loaded;
  });
  const [tagInput, setTagInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fileData, setFileData] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rawFileObj, setRawFileObj] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);

  const handleGenerateNotes = async () => {
    if (!namaPartner.trim()) {
      setError(t('partners.nama_legal_partner_wajib_diisi_terlebih', 'Nama Legal Partner wajib diisi terlebih dahulu untuk generate Catatan Due Diligence.'));
      return;
    }
    setIsGeneratingNotes(true);
    setError(null);
    try {
      const response = await fetch('/api/partners/generate-dd-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama_partner: namaPartner.trim(),
          country,
          entity_type: entityType,
          tags: tags,
          pdfBase64: fileData || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || t('partners.gagal_menghasilkan_ringkasan_due_diligence_ai', 'Gagal menghasilkan ringkasan Due Diligence AI.'));
      }
      if (result.success && result.notes) {
        setCatatan(result.notes);
      }
    } catch (err: any) {
      setError(err.message || t('partners.error_generating_due_diligence_notes', 'Error generating Due Diligence notes'));
    } finally {
      setIsGeneratingNotes(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        setError(t('partners.ukuran_file_maksimal_20mb', 'Ukuran file maksimal 20MB.'));
        return;
      }
      setRawFileObj(file);
      setFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFileData(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleParsePartner = async () => {
    if (!fileData && !rawFileObj) {
      setError(t('partners.please_upload_a_pdf_file_first', 'Please upload a PDF file first.'));
      return;
    }
    setIsParsing(true);
    setError(null);
    try {
      let response: Response;
      if (rawFileObj) {
        const formData = new FormData();
        formData.append('file', rawFileObj);
        response = await fetch('/api/partners/parse', {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch('/api/partners/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfBase64: fileData })
        });
      }
      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        throw new Error(text && text.trim().startsWith('<') ? t('partners.koneksi_ai_server_timeout_atau_sibuk', 'Koneksi AI Server timeout atau sibuk. Silakan coba kembali beberapa saat lagi.') : (text || t('partners.gagal_memproses_dokumen', 'Gagal memproses dokumen')));
      }
      if (!response.ok) {
        throw new Error(result.error || t('partners.failed_to_parse', 'Failed to parse'));
      }
      if (result.success && result.data) {
        const parsed = result.data;
        if (parsed.nama_partner) setNamaPartner(parsed.nama_partner);
        if (typeof parsed.country === 'string' && /^[A-Z]{2}$/.test(parsed.country)) setCountry(parsed.country);
        if (parsed.entity_type) setEntityType(parsed.entity_type);
        if (parsed.nama_pic) setNamaPic(parsed.nama_pic);
        if (parsed.email_pic) setEmailPic(parsed.email_pic);
        if (parsed.telepon_pic) setTeleponPic(parsed.telepon_pic);
        if (parsed.alamat_pic) setAlamatPic(parsed.alamat_pic);
        if (parsed.notes && parsed.notes !== '-') setCatatan(parsed.notes);
      }
    } catch (err: any) {
      setError(err.message || t('partners.error_parsing_document', 'Error parsing document'));
    } finally {
      setIsParsing(false);
    }
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      const updatedTemplates = saveCategory(trimmed);
      setSavedTemplates(updatedTemplates);
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const isFormValid = Boolean(
    namaPartner.trim() &&
    namaPic.trim() &&
    emailPic.trim() &&
    teleponPic.trim() &&
    tags.length > 0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!namaPartner.trim()) {
      setError(t('form.partner.err_nama_legal', 'Nama Legal wajib diisi.'));
      return;
    }
    if (!namaPic.trim()) {
      setError(t('form.partner.err_nama_pic', 'Nama PIC wajib diisi.'));
      return;
    }
    if (!emailPic.trim()) {
      setError(t('form.partner.err_email_pic', 'Email PIC wajib diisi.'));
      return;
    }
    if (!teleponPic.trim()) {
      setError(t('form.partner.err_telepon_pic', 'Nomor Telepon PIC wajib diisi.'));
      return;
    }
    if (tags.length === 0) {
      setError(t('form.partner.err_tags', 'Minimal 1 tag kategori kerjasama harus ada.'));
      return;
    }

    setSubmitting(true);

    if (tags.length > 0) {
      saveMultipleCategories(tags);
    }

    const fullPicString = `${namaPic.trim()} (${emailPic.trim()} | ${teleponPic.trim()})`;
    const kontakString = `${emailPic.trim()} / ${teleponPic.trim()}`;

    await onSave({
      nama_partner: namaPartner.trim(),
      codename: codename.trim(),
      country,
      entity_type: entityType.trim(),
      identifiers: identifiers.filter((i) => i.value.trim()).map((i) => ({ ...i, value: i.value.trim() })),
      jenis_partner: partnerToEdit?.jenis_partner || 'Vendor',
      pic_partner: fullPicString,
      nama_pic: namaPic.trim(),
      email_pic: emailPic.trim(),
      telepon_pic: teleponPic.trim(),
      alamat_pic: alamatPic.trim(),
      kontak_pic: kontakString,
      pic_internal: picInternal.trim(),
      catatan: catatan.trim(),
      tags,
    });

    setSubmitting(false);
    onClose();
  };

  return (
    <ModalFrame onClose={onClose}>
        {/* Header */}
        <div className="ds-section-header">
          <div>
            <ModalTitle className="ds-modal-title flex items-center gap-2">
              <Building2 className="w-5 h-5 text-accent-text" />
              <span>
                {partnerToEdit
                  ? t('form.partner.title_edit', 'Edit Data Partner')
                  : t('form.partner.title_add', 'Tambah Partner / Vendor Baru')}
              </span>
            </ModalTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            className="min-w-10 min-h-10 flex items-center justify-center text-ink-soft hover:text-ink dark:hover:text-ink p-1.5 rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-sm flex-1 text-ink">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ds-grid">
              <div>
                <label htmlFor="PartnerModal-field-1" className="block font-bold text-ink mb-1.5 text-sm">
                  {t('form.partner.nama_legal', 'Nama Legal *')}
                </label>
                <input id="PartnerModal-field-1"
                  type="text"
                  required
                  placeholder={t('form.partner.nama_legal_placeholder', 'contoh: PT Telekomunikasi Selular')}
                  value={namaPartner}
                  onChange={(e) => setNamaPartner(e.target.value)}
                  className="ds-input w-full"
                />
              </div>

              <div>
                <label htmlFor="PartnerModal-field-2" className="block font-bold text-ink mb-1.5 text-sm">
                  {t('form.partner.nama_channel', 'Nama Channel')}
                </label>
                <input id="PartnerModal-field-2"
                  type="text"
                  placeholder={t('form.partner.nama_channel_placeholder', 'mis. TSEL, XL, INDOSAT')}
                  value={codename}
                  onChange={(e) => setCodename(e.target.value)}
                  className="ds-input w-full"
                />
              </div>
            </div>

            <PartnerJurisdictionFields
              country={country}
              entityType={entityType}
              identifiers={identifiers}
              onCountryChange={setCountry}
              onEntityTypeChange={setEntityType}
              onIdentifiersChange={setIdentifiers}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ds-grid">
              <div className="space-y-1.5">
                <label htmlFor="PartnerModal-field-3" className="block font-bold text-ink mb-1 text-sm flex items-center justify-between">
                  <span>{t('form.partner.department', 'Department')}</span>
                </label>

                {isGlobal ? (
                  <div className="space-y-2">
                    {/* Primary Department Dropdown */}
                    <AlphabeticalSelect id="PartnerModal-field-3"
                      value={
                        ENTERPRISE_DEPARTMENTS.includes(picInternal)
                          ? picInternal
                          : (isCustomDept ? '__custom__' : (picInternal || (ENTERPRISE_DEPARTMENTS[0] || '')))
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__custom__') {
                          setIsCustomDept(true);
                          setPicInternal('');
                        } else {
                          setIsCustomDept(false);
                          setPicInternal(val);
                        }
                      }}
                      className="ds-input w-full cursor-pointer"
                    >
                      <option value="" disabled>{t('partners.pilih_department', '-- Pilih Department --')}</option>
                      {ENTERPRISE_DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                      <option value="__custom__">{t('partners.input_departemen_lainnya_kustom', '+ Input Departemen Lainnya / Kustom...')}</option>
                    </AlphabeticalSelect>

                    {/* Custom Department text input if user selected custom */}
                    {isCustomDept && (
                      <input
                        type="text"
                        autoFocus
                        placeholder={t('partners.ketik_nama_departemen_kustom', 'Ketik nama departemen kustom...')}
                        value={picInternal}
                        onChange={(e) => setPicInternal(e.target.value)}
                        className="ds-input w-full"
                      />
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      list="departments-list"
                      placeholder={t('form.partner.department_placeholder', 'contoh: Marketing')}
                      value={picInternal}
                      onChange={(e) => setPicInternal(e.target.value)}
                      className="ds-input w-full"
                    />
                    <AlphabeticalDatalist id="departments-list">
                      {ENTERPRISE_DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept} />
                      ))}
                    </AlphabeticalDatalist>
                  </div>
                )}
              </div>
            </div>

            {/* Separated PIC Contact Person Section */}
            <div className="ds-panel p-4 space-y-3">
              <div className="text-xs font-extrabold text-accent-text uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-4 h-4 text-accent-text" />
                <span>{t('form.partner.contact_section_title', 'Informasi Kontak PIC (Person In Charge)')}</span>
              </div>

              <div>
                <label htmlFor="PartnerModal-field-4" className="block font-bold text-ink mb-1.5 text-sm">
                  {t('form.partner.nama_pic', 'Nama PIC *')}
                </label>
                <input id="PartnerModal-field-4"
                  type="text"
                  required
                  placeholder={t('form.partner.nama_pic_placeholder', 'contoh: Andi Hermawan')}
                  value={namaPic}
                  onChange={(e) => setNamaPic(e.target.value)}
                  className="ds-input w-full"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ds-grid">
                <div>
                  <label htmlFor="PartnerModal-field-5" className="block font-bold text-ink mb-1.5 text-sm flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-ink-soft" />
                    <span>{t('form.partner.email_pic', 'Email PIC *')}</span>
                  </label>
                  <input id="PartnerModal-field-5"
                    type="email"
                    required
                    placeholder={t('form.partner.email_pic_placeholder', 'contoh: andi@telkomsel.co.id')}
                    value={emailPic}
                    onChange={(e) => setEmailPic(e.target.value)}
                    className="ds-input w-full"
                  />
                </div>

                <div>
                  <label htmlFor="PartnerModal-field-6" className="block font-bold text-ink mb-1.5 text-sm flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-ink-soft" />
                    <span>{t('form.partner.telepon_pic', 'Nomor Telepon / WA PIC *')}</span>
                  </label>
                  <input id="PartnerModal-field-6"
                    type="text"
                    required
                    placeholder={t('form.partner.telepon_pic_placeholder', 'contoh: 0811-2233-4455')}
                    value={teleponPic}
                    onChange={(e) => setTeleponPic(e.target.value)}
                    className="ds-input w-full"
                  />
                </div>

                <div className="md:col-span-2 mt-2">
                  <label htmlFor="PartnerModal-field-7" className="block font-bold text-ink mb-1.5 text-sm flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-ink-soft" />
                    <span>{t('form.partner.alamat_pic', 'Alamat *')}</span>
                  </label>
                  <textarea id="PartnerModal-field-7"
                    required
                    placeholder={t('form.partner.alamat_pic_placeholder', 'contoh: Jl. Jend. Sudirman Kav 52-53...')}
                    value={alamatPic}
                    onChange={(e) => setAlamatPic(e.target.value)}
                    rows={2}
                    className="ds-input w-full resize-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="PartnerModal-field-8" className="block font-bold text-ink text-sm mb-1.5">
                {t('form.partner.kategori_kerjasama', 'Kategori Kerjasama *')}
              </label>
              <div className="flex gap-2 mb-2">
                <input id="PartnerModal-field-8"
                  type="text"
                  list="partner-category-templates-list"
                  placeholder={t('form.partner.tag_placeholder', 'Tambah tag kategori (mis. Advertising, IT, Logistics)...')}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  className="ds-input min-w-0 flex-1"
                />
                <AlphabeticalDatalist id="partner-category-templates-list">
                  {savedTemplates.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </AlphabeticalDatalist>
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="ui-button ui-button-lg cursor-pointer ds-button ds-button-lg ds-button-ghost"
                >
                  {t('form.partner.add_tag_btn', 'Tambah Tag')}
                </button>
              </div>

              {/* Active Selected Tag Pills */}
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent-soft text-accent-text border border-accent/30 rounded-lg text-sm font-semibold shadow-2xs"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-accent-text hover:text-accent-text font-extrabold leading-none cursor-pointer"
                      title={t('partners.hapus_tag', 'Hapus tag')}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="PartnerModal-field-9" className="block font-bold text-ink text-sm">
                  {t('form.partner.notes_label', 'Catatan Due Diligence / Internal Notes')}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateNotes}
                    disabled={isGeneratingNotes || !namaPartner.trim()}
                    className="px-3 min-h-8 text-xs font-semibold bg-accent-soft text-accent-text border border-accent/30 hover:bg-accent/20 rounded-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('partners.generate_analisis_due_diligence_ai_senior', 'Generate Analisis Due Diligence (AI Senior Analyst)')}
                  >
                    {isGeneratingNotes ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-text" />
                        <span>{t('partners.menganalisis', 'Menganalisis...')}</span>
                      </>
                    ) : (
                      <>
                        <AiIcon className="w-3.5 h-3.5 text-accent-text" />
                        <span>{t('partners.generate_ai_notes', 'Generate AI Notes')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <textarea id="PartnerModal-field-9"
                rows={4}
                placeholder={t('partners.format_1_paragraf_narrative_analyst_nama', 'Format 1 Paragraf Narrative Analyst: [Nama Entitas] merupakan vendor digital/ad-tech berbadan hukum... (Mencakup: 1. Core Business, 2. Media Network, 3. Proprietary Tech/AI, 4. Strategic Function/Location)')}
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                className="ds-input w-full"
              />
            </div>


            {/* File Upload Area for Parsing */}
            <div className="pt-4 border-t border-hairline">
              <label htmlFor="PartnerModal-field-10" className="block font-bold text-ink mb-1.5 text-sm">
                {t('form.partner.upload_label', 'Auto-fill dari Dokumen Kontrak (AI Parse)')}
              </label>
              <div className="ds-upload text-center">
                <Upload className="w-6 h-6 text-accent-text mx-auto mb-1.5" />
                <p className="text-sm font-bold text-ink">
                  {fileName
                    ? `${t('form.contract.file_selected', 'File terpilih:')} ${fileName}`
                    : t('form.partner.drag_ref', 'Pilih atau Drag Dokumen Referensi ke sini')}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                  {fileData && (
                    <button
                      type="button"
                      onClick={handleParsePartner}
                      disabled={isParsing}
                      className="flex items-center gap-1.5 px-4 min-h-10 bg-accent-soft text-accent-text hover:bg-accent/20 font-semibold text-sm rounded-md transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isParsing ? t('partners.parsing', 'Parsing...') : t('partners.parse_file', 'Parse File')}
                    </button>
                  )}
                  <input id="PartnerModal-field-10"
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                    className="w-[220px] text-sm text-ink-soft file:mr-2 file:py-1.5 file:px-3.5 file:rounded-md file:border-0 file:text-sm file:font-bold file:bg-accent-soft file:text-accent-text hover:file:bg-accent/20 cursor-pointer"
                  />
                </div>
              </div>
            </div>
            {error && (
              <div className="p-3.5 bg-status-danger-soft dark:bg-status-danger-soft/40 border border-status-danger-border text-status-danger rounded-xl text-sm font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="p-4 sm:p-5 bg-surface border-t border-hairline flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs text-ink-soft font-medium hidden sm:inline">
              {t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="ui-button ui-button-lg cursor-pointer ds-button ds-button-lg ds-button-ghost"
              >
                {t('form.common.cancel', 'Batal')}
              </button>
              <button
                type="submit"
                disabled={submitting || !isFormValid}
                title={!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : ''}
                className="ui-button ui-button-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ds-button ds-button-lg ds-button-default"
              >
                {submitting
                  ? t('form.partner.saving_btn', 'Menyimpan Partner...')
                  : t('form.partner.save_btn', 'Simpan Partner')}
              </button>
            </div>
          </div>
        </form>
    </ModalFrame>
  );
};
