import { AlphabeticalSelect } from './ui/alphabetical-select';
import { SuggestTagsInput } from './ui/suggest-input';
import React, { useState, useEffect, useRef } from 'react';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { Contract, Partner, NoticeType, JenisDokumenContract, ContractStatus, RedlineAnalysisData } from '@legalio/types';
import { ArrowLeft, Link2, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { DateInput } from './DateInput';
import { isGlobalRole } from '../lib/rbacScoping';
import { useDepartments } from '../hooks/useDepartments';
import { getSavedCategories, saveCategory, saveMultipleCategories } from '../lib/categoryUtils';
import { SUPPORTED_CURRENCIES, currencyLabel, formatMoney, fetchHistoricalRate, getDefaultUsdRate } from '@legalio/shared/currencyUtils';
import { formatContractFileName } from '@legalio/shared/fileNaming';
import { contractLifecycle, contractLifecycleMode, validateContractTermination } from '@legalio/shared/contractLifecycle';
import { CONTRACT_STATUS_LABEL_KEY } from '@legalio/types/domainStatus';
import { ContractEndingFields } from '../features/contracts/ContractEndingFields';
import { Badge } from '@legalio/ui-components/badge';

import { Button } from '@legalio/ui-components/button';
import { Textarea } from '@legalio/ui-components/textarea';
import { Input } from '@legalio/ui-components/input';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { ContractRedliningPanel } from './ContractRedliningPanel';
import { FormSection } from '@legalio/ui-components/blocks';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Checkbox, CheckboxControl, CheckboxHiddenInput, CheckboxLabel } from '@legalio/ui-components/checkbox';
import { TagsInput, TagsInputClearTrigger, TagsInputControl, TagsInputHiddenInput, TagsInputInput, TagsInputItems, TagsInputLabel } from '@legalio/ui-components/tags-input';
import { Alert, AlertContent, AlertDescription, AlertIndicator, AlertTitle } from '@legalio/ui-components/alert';
import { FileUpload, FileUploadDropzone, FileUploadDropzoneIcon, FileUploadHiddenInput, FileUploadLabel, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { ToggleGroup, ToggleGroupItem } from '@legalio/ui-components/toggle-group';
import { Text } from '@legalio/ui-components/text';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { NumberInput, NumberInputControl, NumberInputDecrementTrigger, NumberInputIncrementTrigger, NumberInputInput } from '@legalio/ui-components/number-input';
interface ContractModalProps {
  contractToEdit?: Contract | null;
  partners: Partner[];
  contracts?: Contract[];
  onClose: () => void;
  onSave: (contractData: any) => Promise<void>;
  /** An existing contract's analysis was stored by the server; keep the list in sync. */
  onRedlineSaved?: (contractId: string, analysis: RedlineAnalysisData, analyzedAt: string) => void;
}

export const ContractModal: React.FC<ContractModalProps> = ({
  contractToEdit,
  partners,
  contracts = [],
  onClose,
  onSave,
  onRedlineSaved,
}) => {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { departments: ENTERPRISE_DEPARTMENTS } = useDepartments();

  const [jenisDokumen, setJenisDokumen] = useState<JenisDokumenContract>(
    contractToEdit?.document_type || 'Master Agreement'
  );
  const [parentContractId, setParentContractId] = useState<string>(
    contractToEdit?.parent_contract_id || ''
  );
  const [nomorKontrak, setNomorKontrak] = useState(contractToEdit?.contract_number || '');
  const [partnerId, setPartnerId] = useState(contractToEdit?.partner_id || (partners[0]?.partner_id || ''));
  const [kategoriTags, setKategoriTags] = useState<string[]>(
    contractToEdit?.cooperation_categories || ['Advertising', 'Content']
  );
  const [savedTemplates, setSavedTemplates] = useState<string[]>(() => {
    const loaded = getSavedCategories();
    if (contractToEdit?.cooperation_categories && contractToEdit.cooperation_categories.length > 0) {
      return saveMultipleCategories(contractToEdit.cooperation_categories);
    }
    return loaded;
  });
  const [tanggalMulai, setTanggalMulai] = useState(contractToEdit?.start_date || '2026-08-01');
  const [tanggalBerakhir, setTanggalBerakhir] = useState(contractToEdit?.end_date || '2027-07-31');
  const { policy } = useTenantSettings();
  const tenantCurrency = policy.settings.defaultCurrency;
  const [currency, setCurrency] = useState<string>(contractToEdit?.currency || tenantCurrency);
  const [nilaiKontrak, setNilaiKontrak] = useState<number>(contractToEdit?.contract_value ?? 0);
  const [historicalRate, setHistoricalRate] = useState<number>(() => getDefaultUsdRate(contractToEdit?.currency || tenantCurrency));

  useEffect(() => {
    let isMounted = true;
    if (currency === 'USD') {
      setHistoricalRate(1);
      return;
    }
    fetchHistoricalRate(currency, tanggalMulai).then((res) => {
      if (isMounted && res.rate) {
        setHistoricalRate(res.rate);
      }
    }).catch(() => undefined);
    return () => { isMounted = false; };
  }, [currency, tanggalMulai]);

  const estimatedUsd = currency === 'USD'
    ? Number(nilaiKontrak || 0)
    : Math.round(Number(nilaiKontrak || 0) * historicalRate * 100) / 100;

  const getVendorName = (pId: string) => {
    const p = partners.find((item) => item.partner_id === pId);
    return p ? p.partner_name : 'Partner';
  };

  const generateAutoTitle = (
    pId: string,
    jenisDoc: JenisDokumenContract,
    tags: string[],
    tglMulai: string
  ) => {
    const vendorName = getVendorName(pId);
    const docTypeStr = jenisDoc === 'Agreement Addendum' ? 'Addendum Agreement' : 'Master Agreement';
    const tagStr = tags.length > 0 ? tags.join('-') : 'Tag';
    return `${vendorName}_${docTypeStr}_${tagStr}_${tglMulai}`;
  };

  const [isAutoTitle, setIsAutoTitle] = useState(!contractToEdit?.contract_title);
  const [judulKontrak, setJudulKontrak] = useState(() => {
    if (contractToEdit?.contract_title) return contractToEdit.contract_title;
    const initialPartnerId = contractToEdit?.partner_id || (partners[0]?.partner_id || '');
    const initialJenis = contractToEdit?.document_type || 'Master Agreement';
    const initialTags = contractToEdit?.cooperation_categories || ['Advertising', 'Content'];
    const initialStartDate = contractToEdit?.start_date || '2026-08-01';
    return generateAutoTitle(initialPartnerId, initialJenis, initialTags, initialStartDate);
  });

  useEffect(() => {
    if (isAutoTitle) {
      setJudulKontrak(generateAutoTitle(partnerId, jenisDokumen, kategoriTags, tanggalMulai));
    }
  }, [partnerId, jenisDokumen, kategoriTags, tanggalMulai, isAutoTitle]);

  const [autoRenewal, setAutoRenewal] = useState(contractToEdit?.auto_renewal || false);
  const [status, setStatus] = useState<ContractStatus>(
    contractToEdit && contractLifecycleMode(contractToEdit) === 'terminated' ? 'Terminated' : 'Active'
  );
  const [terminationDate, setTerminationDate] = useState(contractToEdit?.termination_date || '');
  const [terminationReason, setTerminationReason] = useState(contractToEdit?.termination_reason || '');
  const [terminationFile, setTerminationFile] = useState<{ fileName: string; fileData: string }>();
  const [readingTerminationFile, setReadingTerminationFile] = useState(false);
  const lifecycleMode = status === 'Terminated' ? 'terminated' : 'normal';
  const lifecyclePreview = contractLifecycle({ lifecycle_mode: lifecycleMode, termination_date: terminationDate,
    end_date: tanggalBerakhir, auto_renewal: autoRenewal }, policy.settings);
  const showEndingFields = lifecycleMode === 'terminated' || lifecyclePreview.status === 'Expired';
  const [noticePeriodHari, setNoticePeriodHari] = useState(contractToEdit?.notice_period_days || 30);
  const [noticeTypeRequired, setNoticeTypeRequired] = useState<NoticeType>(
    contractToEdit?.notice_type_required || 'Termination'
  );
  const [picInternal, setPicInternal] = useState(() => {
    if (contractToEdit?.internal_pic) return contractToEdit.internal_pic;
    const initialPartnerId = contractToEdit?.partner_id || (partners[0]?.partner_id || '');
    const matchedPartner = partners.find((p) => p.partner_id === initialPartnerId);
    return matchedPartner?.internal_pic || user?.department || 'Commercial & Marketing';
  });
  const [internalNotes, setInternalNotes] = useState(
    contractToEdit?.internal_notes || ''
  );

  const [fieldYangBerubah, setFieldYangBerubah] = useState<string[]>(
    contractToEdit?.changed_fields || ['Nilai Kontrak / IO', 'Jangka Waktu Periode']
  );
  const [ringkasanPerubahan, setRingkasanPerubahan] = useState<string>(
    contractToEdit?.change_summary || ''
  );

  const handleAutoRenewalChange = (checked: boolean) => {
    setAutoRenewal(checked);
    if (checked) {
      if (tanggalMulai && (!tanggalBerakhir || tanggalBerakhir.startsWith('9999'))) {
        // Default to until termination / indefinite if not set or previously indefinite
        const parts = tanggalMulai.split('-').map(Number);
        if (parts.length === 3) {
          const d = new Date(parts[0], parts[1] - 1, parts[2]);
          d.setDate(d.getDate() - 1);
          setTanggalBerakhir(
            `9999-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          );
        }
      }
    }
  };

  const availableMasterContracts = contracts.filter((c) => {
    const isMaster = (c.document_type || 'Master Agreement') === 'Master Agreement';
    const notSelf = contractToEdit ? c.contract_id !== contractToEdit.contract_id : true;
    const matchPartner = partnerId ? c.partner_id === partnerId : true;
    return isMaster && notSelf && matchPartner;
  });

  const [fileName, setFileName] = useState(contractToEdit?.fileName || '');
  const [rawFileName, setRawFileName] = useState(contractToEdit?.fileName || '');
  const [fileData, setFileData] = useState<string | null>(null);
  const [rawFileObj, setRawFileObj] = useState<File | null>(null);
  const [redline, setRedline] = useState<{ analysis: RedlineAnalysisData; at?: string } | null>(
    contractToEdit?.redline_analysis ? { analysis: contractToEdit.redline_analysis, at: contractToEdit.redline_analyzed_at } : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const isAddendumValid =
    jenisDokumen !== 'Agreement Addendum' ||
    (parentContractId && fieldYangBerubah.length > 0 && ringkasanPerubahan.trim());

  const isFormValid = Boolean(
    nomorKontrak.trim() &&
    judulKontrak.trim() &&
    partnerId &&
    tanggalMulai &&
    tanggalBerakhir &&
    nilaiKontrak !== undefined && nilaiKontrak !== null && String(nilaiKontrak) !== '' &&
    noticePeriodHari !== undefined && noticePeriodHari !== null && String(noticePeriodHari) !== '' &&
    isAddendumValid
  );

  /** TagsInput change: new categories are remembered as templates; duplicates are ignored case-insensitively. */
  const handleTagsChange = (next: string[]) => {
    const unique = next.map((tag) => tag.trim()).filter((tag, index, all) => tag && all.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === index);
    unique.filter((tag) => !kategoriTags.some((existing) => existing.toLowerCase() === tag.toLowerCase())).forEach((tag) => setSavedTemplates(saveCategory(tag)));
    setKategoriTags(unique);
  };

  const [isParsing, setIsParsing] = useState(false);
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);

  const handleParseContract = async () => {
    if (!fileData && !rawFileObj) {
      setError(t('contracts.please_upload_a_pdf_file_first', 'Please upload a PDF file first.'));
      return;
    }
    setIsParsing(true);
    setError(null);
    setParseSuccessMsg(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout
      
      let response: Response;
      if (rawFileObj) {
        const formData = new FormData();
        formData.append('file', rawFileObj);
        response = await fetch('/api/contracts/parse', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
      } else {
        response = await fetch('/api/contracts/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfBase64: fileData }),
          signal: controller.signal,
        });
      }
      clearTimeout(timeoutId);
      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        throw new Error(text && text.trim().startsWith('<') ? t('contracts.koneksi_ai_server_timeout_atau_sibuk', 'Koneksi AI Server timeout atau sibuk. Silakan coba kembali beberapa saat lagi.') : (text || t('contracts.gagal_memproses_dokumen', 'Gagal memproses dokumen')));
      }
      if (!response.ok) {
        throw new Error(result.error || t('contracts.failed_to_parse', 'Failed to parse'));
      }
      if (result.success && result.data) {
        const parsed = result.data;
        if (parsed.document_type) {
          const docType = parsed.document_type.toLowerCase().includes('addendum') ? 'Agreement Addendum' : 'Master Agreement';
          setJenisDokumen(docType as any);
        }
        if (parsed.contract_number) setNomorKontrak(parsed.contract_number);
        if (parsed.start_date) setTanggalMulai(parsed.start_date);
        if (parsed.end_date) setTanggalBerakhir(parsed.end_date);
        if (parsed.contract_value !== undefined && parsed.contract_value !== null) setNilaiKontrak(Number(parsed.contract_value) || 0);
        if (parsed.currency && SUPPORTED_CURRENCIES.some((c) => c.code === String(parsed.currency).toUpperCase())) setCurrency(String(parsed.currency).toUpperCase());
        if (parsed.notice_period_days !== undefined && parsed.notice_period_days !== null) setNoticePeriodHari(Number(parsed.notice_period_days) || 30);
        if (parsed.auto_renewal !== undefined) setAutoRenewal(Boolean(parsed.auto_renewal));
        if (parsed.internal_notes) setInternalNotes(String(parsed.internal_notes).trim());
        if (parsed.change_summary) setRingkasanPerubahan(String(parsed.change_summary).trim());
        if (Array.isArray(parsed.changed_fields) && parsed.changed_fields.length > 0) {
          setFieldYangBerubah(parsed.changed_fields);
        }
        
        // Match partner name intelligently
        let matchedPartnerId = '';
        if (parsed.partner_name) {
          const rawP = parsed.partner_name.toLowerCase().trim();
          const cleanP = rawP.replace(/^(pt|cv|ltd|co\.|inc)\s+/i, '').replace(/[\.,]/g, '').trim();
          const matchedPartner = partners.find(p => {
            const cleanTarget = p.partner_name.toLowerCase().replace(/^(pt|cv|ltd|co\.|inc)\s+/i, '').replace(/[\.,]/g, '').trim();
            return p.partner_name.toLowerCase().includes(rawP) ||
                   rawP.includes(p.partner_name.toLowerCase()) ||
                   cleanTarget.includes(cleanP) ||
                   cleanP.includes(cleanTarget);
          });
          if (matchedPartner) {
            matchedPartnerId = matchedPartner.partner_id;
            setPartnerId(matchedPartner.partner_id);
          }
        }

        // Match parent contract if Addendum
        if (parsed.parent_contract_number) {
          const rawInduk = parsed.parent_contract_number.toLowerCase().trim();
          const matchedMaster = contracts.find(c => 
            c.contract_number && (
              c.contract_number.toLowerCase().includes(rawInduk) ||
              rawInduk.includes(c.contract_number.toLowerCase())
            )
          );
          if (matchedMaster) {
            setParentContractId(matchedMaster.contract_id);
            if (!matchedPartnerId && matchedMaster.partner_id) {
              setPartnerId(matchedMaster.partner_id);
            }
          }
        }

        if (parsed.contract_title) {
          setIsAutoTitle(false);
          setJudulKontrak(parsed.contract_title);
        }

        if (result.cached) {
          setParseSuccessMsg(`⚡ Auto-fill didapat instan dari Cache SHA-256 dokumen!`);
          setTimeout(() => setParseSuccessMsg(null), 6000);
        } else if (result.performance) {
          setParseSuccessMsg(`⚡ Auto-fill berhasil diekstrak dalam ${(result.performance.durationMs / 1000).toFixed(1)}s! (${result.performance.processedPages} dari ${result.performance.originalPages} halaman penting dianalisis)`);
          setTimeout(() => setParseSuccessMsg(null), 6000);
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setError(t('contracts.parsing_timeout_server_terlalu_lama_merespon', 'Parsing timeout, server terlalu lama merespon. Silakan coba lagi.'));
      } else {
        setError(err.message || t('contracts.error_parsing_document', 'Error parsing document'));
      }
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = (file: File | undefined) => {
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        setError(t('contracts.ukuran_file_maksimal_20mb', 'Ukuran file maksimal 20MB.'));
        return;
      }
      setRawFileObj(file);
      setRawFileName(file.name);
      const selectedPartner = partners.find((p) => p.partner_id === partnerId);
      const autoRenamed = formatContractFileName({
        partnerName: selectedPartner?.partner_name,
        documentType: jenisDokumen,
        contractNumber: nomorKontrak.trim(),
        startDate: tanggalMulai,
        rawFileName: file.name,
      });
      setFileName(autoRenamed);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFileData(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTerminationFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(pdf|doc|docx)$/i.test(file.name) || file.size > 10 * 1024 * 1024 || file.size === 0) {
      setError(t('termination.file_invalid')); return;
    }
    setReadingTerminationFile(true);
    try {
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(t('termination.file_read_error')));
        reader.readAsDataURL(file);
      });
      setTerminationFile({ fileName: file.name, fileData });
      setError('');
    } catch { setError(t('termination.file_read_error')); }
    finally { setReadingTerminationFile(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!partnerId) {
      setError(t('form.contract.partner_vendor', 'Partner wajib dipilih.'));
      return;
    }
    if (jenisDokumen === 'Agreement Addendum') {
      if (!parentContractId) {
        setError(t('form.contract.no_master_warning', 'Harap pilih partner lain atau buat Master Agreement terlebih dahulu.'));
        return;
      }
      if (fieldYangBerubah.length === 0) {
        setError(t('contracts.pilih_minimal_1_elemen_field_yang', 'Pilih minimal 1 elemen / field yang berubah untuk Agreement Addendum.'));
        return;
      }
      if (!ringkasanPerubahan.trim()) {
        setError(t('contracts.ringkasan_detail_track_change_perubahan_wajib', 'Ringkasan detail track-change perubahan wajib diisi untuk Agreement Addendum.'));
        return;
      }
    }
    if (!nomorKontrak.trim()) {
      setError(t('form.contract.contract_number', 'Nomor Kontrak Legal wajib diisi.'));
      return;
    }
    if (!judulKontrak.trim()) {
      setError(t('form.contract.contract_title', 'Judul Perjanjian Kontrak wajib diisi.'));
      return;
    }
    if (!tanggalMulai || !tanggalBerakhir) {
      setError(t('contracts.tanggal_mulai_dan_tanggal_berakhir_wajib', 'Tanggal Mulai dan Tanggal Berakhir wajib diisi.'));
      return;
    }
    if (new Date(tanggalBerakhir) <= new Date(tanggalMulai)) {
      setError(t('contracts.tanggal_berakhir_harus_setelah_tanggal_mulai', 'Tanggal Berakhir harus setelah Tanggal Mulai.'));
      return;
    }

    const terminationError = validateContractTermination({ lifecycle_mode: lifecycleMode, termination_date: terminationDate,
      start_date: tanggalMulai, end_date: tanggalBerakhir });
    if (terminationError) { setError(t(terminationError)); return; }
    if (readingTerminationFile) return;
    if ((fileData?.length || 0) + (terminationFile?.fileData.length || 0) > 24 * 1024 * 1024) {
      setError(t('termination.payload_too_large')); return;
    }
    setSubmitting(true);

    try {
      const selectedMaster = availableMasterContracts.find((c) => c.contract_id === parentContractId);
      const selectedPartner = partners.find((p) => p.partner_id === partnerId);

      let finalFileName = fileName;
      if (fileName) {
        finalFileName = formatContractFileName({
          partnerName: selectedPartner?.partner_name,
          documentType: jenisDokumen,
          contractNumber: nomorKontrak.trim(),
          startDate: tanggalMulai,
          rawFileName: fileName,
        });
      }

      if (kategoriTags.length > 0) {
        saveMultipleCategories(kategoriTags);
      }

      await onSave({
        document_type: jenisDokumen,
        parent_contract_id: jenisDokumen === 'Agreement Addendum' ? parentContractId : undefined,
        parent_contract_number:
          jenisDokumen === 'Agreement Addendum' ? selectedMaster?.contract_number : undefined,
        contract_number: nomorKontrak.trim(),
        contract_title: judulKontrak.trim(),
        partner_id: partnerId,
        cooperation_categories: kategoriTags,
        start_date: tanggalMulai,
        end_date: tanggalBerakhir,
        currency,
        contract_value: Number(nilaiKontrak),
        contract_value_usd: estimatedUsd,
        auto_renewal: autoRenewal,
        notice_period_days: Number(noticePeriodHari),
        notice_type_required: noticeTypeRequired,
        status: lifecyclePreview.status,
        lifecycle_mode: lifecycleMode,
        termination_date: lifecycleMode === 'terminated' ? terminationDate : null,
        termination_reason: terminationReason.trim(),
        termination_document_file: terminationFile,
        internal_pic: (contractToEdit?.internal_pic || selectedPartner?.internal_pic || user?.department || 'Commercial & Marketing').trim(),
        internal_notes: internalNotes.trim(),
        changed_fields: jenisDokumen === 'Agreement Addendum' ? fieldYangBerubah : undefined,
        change_summary: jenisDokumen === 'Agreement Addendum' ? ringkasanPerubahan.trim() : undefined,
        fileName: finalFileName,
        fileData,
        ...(redline && { redline_analysis: redline.analysis, redline_analyzed_at: redline.at }),
      });

      onClose();
    } catch (err: any) {
      setError(err.message || t('contracts.gagal_menyimpan_data_kontrak_coba_lagi', 'Gagal menyimpan data kontrak. Coba lagi.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="contract-form w-full min-w-0 space-y-g21" aria-labelledby="contract-form-heading">
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <Heading as="h2" size="md" weight="semibold" id="contract-form-heading">
          {contractToEdit?.contract_id
            ? (jenisDokumen === 'Agreement Addendum'
                ? t('form.contract.title_edit_addendum', 'Edit Agreement Addendum')
                : t('form.contract.title_edit_master', 'Edit Kontrak Induk'))
            : (jenisDokumen === 'Agreement Addendum'
                ? t('form.contract.title_add_addendum', 'Buat & Upload Agreement Addendum Baru')
                : t('contract.form.page_title_new', 'Submit a new contract'))}
        </Heading>
        <Button variant="link" size="sm" type="button" onClick={onClose} className="no-underline hover:underline"><ArrowLeft className="size-g13" aria-hidden />{t('contract.form.back', 'Back to contract list')}</Button>
      </div>

      <div className="grid grid-cols-1 items-start gap-g21 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          <div className="flex min-w-0 flex-col gap-g13 text-foreground">
            <FormSection step={1} title={t('contract.form.section_details', 'Contract Details')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-1">{t('contract.form.doc_type', 'Agreement Document Type *')}</FieldLabel>
                  <AlphabeticalSelect id="contract-field-1"
                    value={jenisDokumen}
                    onChange={(e) => setJenisDokumen(e.target.value as JenisDokumenContract)}
                    className="w-full" controlProps={{ className: "w-full" }}
                  >
                    <option value="Master Agreement">{t('form.contract.master_agreement_opt', 'Master Agreement (Kontrak Induk Utama)')}</option>
                    <option value="Agreement Addendum">{t('form.contract.agreement_addendum_opt', 'Agreement Addendum (Perubahan / Adendum)')}</option>
                  </AlphabeticalSelect>
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-2">{t('contract.form.partner', 'Partner *')}</FieldLabel>
                  <AlphabeticalSelect id="contract-field-2"
                    value={partnerId}
                    onChange={(e) => {
                      setPartnerId(e.target.value);
                      setParentContractId('');
                    }}
                    className="w-full" controlProps={{ className: "w-full" }}
                  >
                    {partners.map((p) => (
                      <option key={p.partner_id} value={p.partner_id}>{p.partner_name}</option>
                    ))}
                  </AlphabeticalSelect>
                </Field>
              </div>
              {/* Referensi Master Agreement Field - Active when Agreement Addendum is chosen */}
              {jenisDokumen === 'Agreement Addendum' && (
                <div className="pt-g8 border-t border-border space-y-g13">
                  <Field>
                    <FieldLabel htmlFor="contract-field-3" className="gap-g5">
                      <Link2 className="size-g16 text-accent-foreground" aria-hidden="true" />
                      {t('form.contract.ref_master_agreement', 'Referensi Master Agreement (Kontrak Induk) *')}
                    </FieldLabel>
                    {availableMasterContracts.length === 0 ? (
                      <Alert status="warning"><AlertIndicator /><AlertContent><AlertDescription>{t('form.contract.no_master_warning', 'Harap pilih partner lain atau buat Master Agreement terlebih dahulu.')}</AlertDescription></AlertContent></Alert>
                    ) : (
                      <AlphabeticalSelect id="contract-field-3"
                        required={jenisDokumen === 'Agreement Addendum'}
                        value={parentContractId}
                        onChange={(e) => setParentContractId(e.target.value)}
                        className="w-full" controlProps={{ className: "w-full" }}
                      >
                        <option value="">{t('form.contract.select_master_placeholder', '-- Pilih Master Agreement Induk --')}</option>
                        {availableMasterContracts.map((m) => (
                          <option key={m.contract_id} value={m.contract_id}>
                            {m.contract_number} | {m.contract_title}
                          </option>
                        ))}
                      </AlphabeticalSelect>
                    )}
                  </Field>

                  <Card size="sm" className="gap-g13 p-g13">
                    <Fieldset>
                      <FieldsetLegend>{t('form.contract.changed_fields', 'Isi yang Berubah *')}</FieldsetLegend>
                      <ToggleGroup multiple value={fieldYangBerubah} onValueChange={details => setFieldYangBerubah(details.value)} aria-label={t('form.contract.changed_fields', 'Isi yang Berubah *')} variant="outline" size="sm" className="flex-wrap gap-g8 p-g8">
                        {/* values are the stored codes the backend expects; only the chip text is shortened */}
                        {[['Nilai Kontrak / IO', 'Nilai Kontrak'], ['Jangka Waktu Periode', 'Jangka Waktu'], ['Ruang Lingkup / Deliverables', 'Ruang Lingkup'], ['Syarat Pembayaran', 'Syarat Pembayaran'], ['Pihak Berwenang', 'Pihak Berwenang']].map(([f, label]) => (
                          <ToggleGroupItem key={f} value={f}>
                            {fieldYangBerubah.includes(f) && <Check aria-hidden />}
                            {label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Fieldset>

                    <Field>
                      <FieldLabel htmlFor="contract-field-4">
                        {t('form.contract.track_change_summary', 'Ringkasan perubahan')}
                      </FieldLabel>
                      <Textarea id="contract-field-4"
                        required
                        rows={3}
                        placeholder={t('form.contract.track_change_placeholder', 'Jelaskan perubahan secara spesifik, misalnya nilai lama → nilai baru, tanggal lama → tanggal baru, atau pasal yang diperbarui.')}
                        value={ringkasanPerubahan}
                        onChange={(e) => setRingkasanPerubahan(e.target.value)}
                        className="w-full"
                      />
                    </Field>
                  </Card>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-5">
                    {jenisDokumen === 'Agreement Addendum'
                      ? t('form.contract.addendum_number', 'Nomor Addendum *')
                      : t('contract.form.number', 'Legal Contract Number *')}
                  </FieldLabel>
                  <Input id="contract-field-5"
                    type="text"
                    required
                    placeholder={
                      jenisDokumen === 'Agreement Addendum'
                        ? t('contracts.contoh_01_add_its_xi_2024', 'contoh: 01/ADD-ITS/XI/2024 atau 01A/ADD-ITS/I/2023')
                        : t('contracts.contoh_01_pks_its_xi_2024', 'contoh: 01/PKS-ITS/XI/2024 atau 52/PKS-ITS/VII/2025')
                    }
                    value={nomorKontrak}
                    onChange={(e) => setNomorKontrak(e.target.value)}
                    className="w-full"
                  />
                </Field>

                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-6">
                    {jenisDokumen === 'Agreement Addendum'
                      ? t('form.contract.judul_addendum', 'Judul Perjanjian Addendum *')
                      : t('contract.form.title_label', 'Contract Agreement Title *')}
                  </FieldLabel>
                  <Input id="contract-field-6"
                    type="text"
                    required
                    placeholder={t('form.contract.judul_ph', 'contoh: PT Telkomsel_Master Agreement_Advertising-Content_2026-08-01')}
                    value={judulKontrak}
                    onChange={(e) => {
                      setJudulKontrak(e.target.value);
                      setIsAutoTitle(false);
                    }}
                    className="w-full"
                  />
                </Field>
              </div>
              <SuggestTagsInput id="contract-field-7" label={t('contract.form.tags', 'Partnership Category Tags *')} value={kategoriTags} onValueChange={handleTagsChange} options={savedTemplates}
                placeholder={t('form.partner.tag_placeholder', 'Tambah tag kategori (mis. Advertising, IT, Logistics)...')} clearLabel={t('common.clear', 'Hapus semua')} />
            </FormSection>

            <FormSection step={2} title={t('contract.form.section_period', 'Period & Value')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-8">{t('contract.form.start', 'Start Date *')}</FieldLabel>
                  <DateInput id="contract-field-8" required focusColor="emerald" value={tanggalMulai} onChange={(val) => setTanggalMulai(val)} />
                </Field>
                <Field className="min-w-0">
                  <div className="flex w-full items-center justify-between gap-g8">
                    <FieldLabel htmlFor="contract-field-9">{t('contract.form.end', 'End Date *')}</FieldLabel>
                    {autoRenewal && <Badge tone="success">{t('contracts.auto_renewal', 'Auto-Renewal')}</Badge>}
                  </div>
                  <DateInput id="contract-field-9" required focusColor="emerald" value={tanggalBerakhir} onChange={(val) => setTanggalBerakhir(val)} />
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-10">{t('form.contract.currency', 'Mata Uang')}</FieldLabel>
                  <AlphabeticalSelect id="contract-field-10" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full" controlProps={{ className: "w-full" }}>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {currencyLabel(c.code, language)}</option>
                    ))}
                  </AlphabeticalSelect>
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-11">{t('contract.form.value', 'Contract Value *')}</FieldLabel>
                  <NumberInput className="w-full" ids={{ input: "contract-field-11" }} required value={String(nilaiKontrak ?? '')} onValueChange={details => setNilaiKontrak(Number(details.value))}><NumberInputControl><NumberInputDecrementTrigger /><NumberInputInput /><NumberInputIncrementTrigger /></NumberInputControl></NumberInput>
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-g8 rounded-md border border-border bg-muted px-g13 py-g8" aria-live="polite"
                title={currency === 'USD' ? undefined : t('contracts.1_usd', '1 {currency} ≈ {value} USD', { currency, value: historicalRate.toFixed(8) })}>
                <Text as="span" size="sm" tone="muted">{t('contract.form.usd_estimate', 'Estimated USD Conversion (Rate on {date})', { date: tanggalMulai })}</Text>
                <Text as="span" size="sm" tone="muted" className="tabular-nums">{formatMoney(estimatedUsd, 'USD')}</Text>
              </div>
            </FormSection>

            <FormSection step={3} title={t('contract.form.section_renewal', 'Renewal & Status')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-12">{t('contract.form.notice_period', 'Notice Period (Days) *')}</FieldLabel>
                  <NumberInput className="w-full" ids={{ input: "contract-field-12" }} required value={String(noticePeriodHari ?? '')} onValueChange={details => setNoticePeriodHari(Number(details.value))}><NumberInputControl><NumberInputDecrementTrigger /><NumberInputInput /><NumberInputIncrementTrigger /></NumberInputControl></NumberInput>
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-13">{t('contract.form.notice_type', 'Notice Type Required *')}</FieldLabel>
                  <AlphabeticalSelect id="contract-field-13" value={noticeTypeRequired} onChange={(e) => setNoticeTypeRequired(e.target.value as any)} className="w-full" controlProps={{ className: "w-full" }}>
                    <option value="Termination">{t('contracts.notice_of_termination', 'Notice of Termination')}</option>
                    <option value="Extension">{t('contracts.notice_of_extension', 'Notice of Extension')}</option>
                    <option value="Both">{t('contracts.keduanya_termination_extension', 'Keduanya (Termination & Extension)')}</option>
                    <option value="None">{t('common.none', 'None')}</option>
                  </AlphabeticalSelect>
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="contract-field-14">{t('contract.form.status', 'Contract Status *')}</FieldLabel>
                  <AlphabeticalSelect id="contract-field-14"
                    value={status === 'Terminated' ? 'Terminated' : 'Active'}
                    onChange={(e) => { setStatus(e.target.value as ContractStatus); if (e.target.value === 'Terminated') setAutoRenewal(false); }}
                    className="w-full" controlProps={{ className: "w-full" }}
                  >
                    <option value="Active">{t('form.contract.status_normal', 'Normal (Sesuai tanggal berlaku)')}</option>
                    <option value="Terminated">{t('form.contract.status_terminated', 'Dihentikan (Penghentian Perjanjian)')}</option>
                  </AlphabeticalSelect>
                </Field>
                <div className="flex min-w-0 flex-wrap items-end gap-g13">
                  <div className="flex h-control-md flex-wrap items-center gap-g13">
                    <Badge tone={lifecyclePreview.status === 'Expired' ? 'warning' : lifecyclePreview.status === 'Terminated' ? 'danger' : 'info'}>{t(CONTRACT_STATUS_LABEL_KEY[lifecyclePreview.status])}</Badge>
                    <Checkbox checked={autoRenewal} disabled={status === 'Terminated'} onCheckedChange={(details) => handleAutoRenewalChange(details.checked === true)}><CheckboxControl /><CheckboxLabel>{t('form.contract.auto_renewal', 'Auto Renewal')}</CheckboxLabel><CheckboxHiddenInput /></Checkbox>
                  </div>
                  {lifecyclePreview.scheduled && terminationDate && <Text size="xs" tone="muted">{t('termination.scheduled')}</Text>}
                </div>
              </div>
              <Field>
                <FieldLabel htmlFor="contract-field-15">{t('form.contract.internal_notes', 'Internal Notes')}</FieldLabel>
                <Textarea id="contract-field-15" rows={3} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder={t('form.contract.internal_notes_placeholder', 'Rangkuman kontrak...')} />
              </Field>
            </FormSection>

            {showEndingFields && <ContractEndingFields step={4} terminated={lifecycleMode === 'terminated'} date={terminationDate} endDate={tanggalBerakhir}
              reason={terminationReason} document={contractToEdit?.termination_document} fileName={terminationFile?.fileName} reading={readingTerminationFile}
              onDate={setTerminationDate} onReason={setTerminationReason} onFile={handleTerminationFile} />}

            <FormSection step={showEndingFields ? 5 : 4} title={t('contract.form.section_document', 'Contract Document')}>
              <FileUpload className="w-full" accept=".pdf,.doc,.docx" maxFiles={1} maxFileSize={20 * 1024 * 1024}
                onFileAccept={details => handleFileChange(details.files[0])}
                onFileReject={() => setError(t('contracts.ukuran_file_maksimal_20mb', 'Ukuran file maksimal 20MB.'))}>
                <FileUploadLabel>{t('contract.form.upload', 'Upload Contract')}</FileUploadLabel>
                <FileUploadDropzone>
                  <FileUploadDropzoneIcon />
                  <Text size="sm" weight="semibold" className="break-words">
                    {fileData || fileName ? <>{t('form.contract.file_selected', 'File selected:')} <span className="break-all font-normal">{rawFileName || fileName}</span></> : t('contract.form.choose_reference', 'Choose a reference document')}
                  </Text>
                  <FileUploadTrigger asChild><Button size="sm">{t('contract.form.choose_file', 'Choose file')}</Button></FileUploadTrigger>
                </FileUploadDropzone>
                <FileUploadHiddenInput />
              </FileUpload>
              {fileData && (
                <Button variant="secondary" onClick={handleParseContract} loading={isParsing} className="self-start">
                  {isParsing ? t('contracts.parsing', 'Parsing...') : t('contracts.parse_file', 'Parse File')}
                </Button>
              )}
            </FormSection>

            {parseSuccessMsg && (
              <Alert status="success" role="status"><AlertIndicator /><AlertContent><AlertDescription>{parseSuccessMsg}</AlertDescription></AlertContent></Alert>
            )}

            {error && (
              <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>
            )}
          </div>

          <ContractRedliningPanel
            canAnalyze={Boolean(partnerId && nomorKontrak.trim() && judulKontrak.trim())}
            analysis={redline?.analysis ?? null}
            onAnalysis={(analysis, at) => {
              setRedline({ analysis, at });
              if (contractToEdit?.contract_id) onRedlineSaved?.(contractToEdit.contract_id, analysis, at);
            }}
            endpoint="/api/contracts/redline-analysis"
            body={{ contract: {
              contract_id: contractToEdit?.contract_id,
              contract_number: nomorKontrak, contract_title: judulKontrak, document_type: jenisDokumen, partner_id: partnerId,
              cooperation_categories: kategoriTags, currency, contract_value: nilaiKontrak, start_date: tanggalMulai, end_date: tanggalBerakhir,
              auto_renewal: autoRenewal, notice_period_days: noticePeriodHari, notice_type_required: noticeTypeRequired,
              internal_notes: internalNotes, change_summary: jenisDokumen === 'Agreement Addendum' ? ringkasanPerubahan : undefined,
            } }}
          />
      </div>

          <Card className="flex-row flex-wrap items-center justify-between gap-g8 px-g21 py-g13">
            <Text size="xs" tone="muted" className="hidden sm:block">{t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}</Text>
            <div className="ms-auto flex items-center gap-g8">
              <Button variant="outline" onClick={onClose}>
                {t('form.common.cancel', 'Batal')}
              </Button>
              <Tooltip disabled={!(!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : '')}><TooltipTrigger asChild><Button
                type="submit"
                loading={submitting}
                disabled={readingTerminationFile || !isFormValid}
              >
                {submitting
                  ? t('form.contract.saving_btn', 'Menyimpan Kontrak...')
                  : t('contract.form.save', 'Save Contract Data')}
              </Button></TooltipTrigger><TooltipBody>{!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : ''}</TooltipBody></Tooltip>
            </div>
          </Card>
    </form>
  );
};
