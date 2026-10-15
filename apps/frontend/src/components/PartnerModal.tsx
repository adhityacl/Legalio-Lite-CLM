import { AlphabeticalSelect } from './ui/alphabetical-select';
import { SuggestInput, SuggestTagsInput } from './ui/suggest-input';
import { ModalFrame } from './ui/modal-frame';
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

import { Button } from '@legalio/ui-components/button';
import { FormSection } from '@legalio/ui-components/blocks';
import { Input } from '@legalio/ui-components/input';
import { Textarea } from '@legalio/ui-components/textarea';
import { DialogBody, DialogCloseIcon, DialogFooter, DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Card } from '@legalio/ui-components/card';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Text } from '@legalio/ui-components/text';
import { FileUpload, FileUploadDropzone, FileUploadDropzoneIcon, FileUploadHiddenInput, FileUploadLabel, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { TagsInput, TagsInputClearTrigger, TagsInputControl, TagsInputHiddenInput, TagsInputInput, TagsInputItems, TagsInputLabel } from '@legalio/ui-components/tags-input';
import { Spinner } from '@legalio/ui-components/spinner';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
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

  const getInitialEmailPic = () => {
    if (partnerToEdit?.email_pic) return partnerToEdit.email_pic;
    if (partnerToEdit?.kontak_pic) {
      const parts = partnerToEdit.kontak_pic.split(/[/|]/);
      const emailPart = parts.find((p) => p.includes('@'));
      if (emailPart) return emailPart.trim();
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
  const [namaPic, setNamaPic] = useState(partnerToEdit?.nama_pic || '');
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

  const handleFileChange = (file: File | undefined) => {
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

  /** TagsInput change: new categories are remembered as templates; duplicates are ignored case-insensitively. */
  const handleTagsChange = (next: string[]) => {
    const unique = next.map((tag) => tag.trim()).filter((tag, index, all) => tag && all.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === index);
    unique.filter((tag) => !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())).forEach((tag) => setSavedTemplates(saveCategory(tag)));
    setTags(unique);
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

    const kontakString = `${emailPic.trim()} / ${teleponPic.trim()}`;

    await onSave({
      nama_partner: namaPartner.trim(),
      codename: codename.trim(),
      country,
      entity_type: entityType.trim(),
      identifiers: identifiers.filter((i) => i.value.trim()).map((i) => ({ ...i, value: i.value.trim() })),
      jenis_partner: partnerToEdit?.jenis_partner || 'Vendor',
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
    <ModalFrame size="form" onClose={onClose}>
        {/* Header */}
        <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
          <div>
            <DialogTitle className="flex items-center gap-g8">
              <Building2 className="w-g21 h-g21 text-muted-foreground" />
              <span>
                {partnerToEdit
                  ? t('form.partner.title_edit', 'Edit Data Partner')
                  : t('form.partner.title_add', 'Tambah Partner / Vendor Baru')}
              </span>
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('common.close', 'Close')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <DialogBody className="mt-0 flex flex-1 flex-col gap-g13 overflow-y-auto px-g21 py-g13 text-foreground">
            <FormSection step={1} title={t('form.partner.section_basic', 'Basic Information')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                <Field>
                  <FieldLabel htmlFor="PartnerModal-field-1">{t('form.partner.nama_legal', 'Legal Name *')}</FieldLabel>
                  <Input id="PartnerModal-field-1" type="text" required placeholder={t('form.partner.nama_legal_placeholder', 'e.g. Acme Supplies Pte. Ltd.')} value={namaPartner} onChange={(e) => setNamaPartner(e.target.value)} className="w-full" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="PartnerModal-field-2">{t('form.partner.nama_channel', 'Channel Name')}</FieldLabel>
                  <Input id="PartnerModal-field-2" type="text" placeholder={t('form.partner.nama_channel_placeholder', 'e.g. TSEL, XL, INDOSAT')} value={codename} onChange={(e) => setCodename(e.target.value)} className="w-full" />
                </Field>
              </div>

              <PartnerJurisdictionFields
                country={country}
                entityType={entityType}
                identifiers={identifiers}
                onCountryChange={setCountry}
                onEntityTypeChange={setEntityType}
                onIdentifiersChange={setIdentifiers}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
              <Field>
                  <FieldLabel htmlFor="PartnerModal-field-3">{t('form.partner.department', 'Department')}</FieldLabel>
  
                  {isGlobal ? (
                    <div className="w-full space-y-g8">
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
                        className="w-full" controlProps={{ className: "w-full" }}
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
                        <Input
                          type="text"
                          autoFocus
                          placeholder={t('partners.ketik_nama_departemen_kustom', 'Ketik nama departemen kustom...')}
                          value={picInternal}
                          onChange={(e) => setPicInternal(e.target.value)}
                          className="w-full"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="space-y-g5">
                      <SuggestInput
                        placeholder={t('form.partner.department_placeholder', 'contoh: Marketing')}
                        aria-label={t('form.partner.department_placeholder', 'contoh: Marketing')}
                        value={picInternal}
                        onValueChange={setPicInternal}
                        options={ENTERPRISE_DEPARTMENTS}
                      />
                    </div>
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection step={2} title={t('form.partner.contact_section_title', 'PIC Contact Information')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                <Field>
                  <FieldLabel htmlFor="PartnerModal-field-4">{t('form.partner.nama_pic', 'PIC Name *')}</FieldLabel>
                  <Input id="PartnerModal-field-4" type="text" required placeholder={t('form.partner.nama_pic_placeholder', 'e.g. Andi Hermawan')} value={namaPic} onChange={(e) => setNamaPic(e.target.value)} className="w-full" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="PartnerModal-field-5">{t('form.partner.email_pic', 'PIC Email *')}</FieldLabel>
                  <Input id="PartnerModal-field-5" type="email" required placeholder={t('form.partner.email_pic_placeholder', 'e.g. andi@telkomsel.co.id')} value={emailPic} onChange={(e) => setEmailPic(e.target.value)} className="w-full" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="PartnerModal-field-6">{t('form.partner.telepon_pic', 'Contact phone *')}</FieldLabel>
                  <Input id="PartnerModal-field-6" type="text" required placeholder={t('form.partner.telepon_pic_placeholder', '+65 6123 4567')} value={teleponPic} onChange={(e) => setTeleponPic(e.target.value)} className="w-full" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="PartnerModal-field-7">{t('form.partner.alamat_pic', 'PIC Address *')}</FieldLabel>
                  <Input id="PartnerModal-field-7" type="text" required placeholder={t('form.partner.alamat_pic_placeholder', 'Jl. Jend. Sudirman Kav 52–53...')} value={alamatPic} onChange={(e) => setAlamatPic(e.target.value)} className="w-full" />
                </Field>
              </div>
            </FormSection>

            <FormSection step={3} title={t('form.partner.section_category_notes', 'Category & Notes')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                <SuggestTagsInput className="h-full" controlClassName="flex-1 content-start" id="PartnerModal-field-8" label={t('form.partner.kategori_kerjasama', 'Partnership Category *')} value={tags} onValueChange={handleTagsChange} options={savedTemplates}
                  placeholder={t('form.partner.tag_placeholder', 'Advertising, IT, Logistics')} clearLabel={t('common.clear', 'Clear all')} />
                <Field className="h-full">
                  <FieldLabel htmlFor="PartnerModal-field-9">{t('form.partner.notes_label', 'Internal Notes')}</FieldLabel>
                  <div className="relative w-full flex-1">
                    <Textarea id="PartnerModal-field-9"
                      rows={3}
                      placeholder={t('partners.format_1_paragraf_narrative_analyst_nama', 'One-paragraph analyst narrative...')}
                      value={catatan}
                      onChange={(e) => setCatatan(e.target.value)}
                      className="h-full w-full pb-g42"
                    />
                    <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm"
                      type="button"
                      onClick={handleGenerateNotes}
                      disabled={isGeneratingNotes || !namaPartner.trim()}
                      className="absolute bottom-g8 end-g8"
                    >
                      {isGeneratingNotes ? <Spinner size="sm" decorative /> : <AiIcon className="size-g13" />}
                      {isGeneratingNotes ? t('partners.menganalisis', 'Analyzing...') : t('partners.generate_ai_notes', 'Generate')}
                    </Button></TooltipTrigger><TooltipBody>{t('partners.generate_analisis_due_diligence_ai_senior', 'Generate due diligence analysis (AI senior analyst)')}</TooltipBody></Tooltip>
                  </div>
                </Field>
              </div>
            </FormSection>

            <FormSection step={4} title={t('form.partner.section_upload', 'File Upload')}>
              <FileUpload className="w-full" accept=".pdf,.doc,.docx" maxFiles={1} onFileAccept={details => handleFileChange(details.files[0])}>
                <FileUploadLabel>{t('form.partner.upload_label', 'Contract document')}</FileUploadLabel>
                <FileUploadDropzone>
                  <FileUploadDropzoneIcon />
                  <Text size="sm" weight="semibold" className="break-words">{fileName ? <>{t('form.contract.file_selected', 'File selected:')} <span className="break-all font-normal">{fileName}</span></> : t('contract.form.choose_reference', 'Choose a reference document')}</Text>
                  <FileUploadTrigger asChild><Button size="sm">{t('contract.form.choose_file', 'Choose file')}</Button></FileUploadTrigger>
                </FileUploadDropzone>
                <FileUploadHiddenInput />
              </FileUpload>
              {fileData && <Button variant="secondary" onClick={handleParsePartner} loading={isParsing} className="self-start">{isParsing ? t('partners.parsing', 'Parsing...') : t('partners.parse_file', 'Parse File')}</Button>}
            </FormSection>
            {error && (
              <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>
            )}
          </DialogBody>

          <DialogFooter className="mt-0 flex-wrap items-center justify-between border-t border-border px-g21 py-g13">
            <Text size="xs" tone="muted" className="hidden sm:block">{t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}</Text>
            <div className="flex items-center gap-g8 ml-auto">
              <Button variant="outline" onClick={onClose}
              >
                {t('form.common.cancel', 'Batal')}
              </Button>
              <Tooltip disabled={!(!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : '')}><TooltipTrigger asChild><Button
                type="submit"
                disabled={submitting || !isFormValid}
              >
                {submitting
                  ? t('form.partner.saving_btn', 'Menyimpan Partner...')
                  : t('form.partner.save_btn', 'Simpan Partner')}
              </Button></TooltipTrigger><TooltipBody>{!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : ''}</TooltipBody></Tooltip>
            </div>
          </DialogFooter>
        </form>
    </ModalFrame>
  );
};
