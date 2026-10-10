import { AlphabeticalDatalist, AlphabeticalSelect } from './ui/alphabetical-select';
import React, { useState, useEffect, useRef } from 'react';
import { Dialog } from 'radix-ui';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { Contract, Partner, NoticeType, JenisDokumenContract, ContractStatus } from '@legalio/types';
import { FileText, Upload, Plus, X, Tag, Link2, Shield, Check } from 'lucide-react';
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

interface ContractModalProps {
  contractToEdit?: Contract | null;
  partners: Partner[];
  contracts?: Contract[];
  onClose: () => void;
  onSave: (contractData: any) => Promise<void>;
}

export const ContractModal: React.FC<ContractModalProps> = ({
  contractToEdit,
  partners,
  contracts = [],
  onClose,
  onSave,
}) => {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { departments: ENTERPRISE_DEPARTMENTS } = useDepartments();

  const [jenisDokumen, setJenisDokumen] = useState<JenisDokumenContract>(
    contractToEdit?.jenis_dokumen || 'Master Agreement'
  );
  const [parentContractId, setParentContractId] = useState<string>(
    contractToEdit?.parent_contract_id || ''
  );
  const [nomorKontrak, setNomorKontrak] = useState(contractToEdit?.nomor_kontrak || '');
  const [partnerId, setPartnerId] = useState(contractToEdit?.partner_id || (partners[0]?.partner_id || ''));
  const [kategoriInput, setKategoriInput] = useState('');
  const [kategoriTags, setKategoriTags] = useState<string[]>(
    contractToEdit?.kategori_kerjasama || ['Advertising', 'Content']
  );
  const [savedTemplates, setSavedTemplates] = useState<string[]>(() => {
    const loaded = getSavedCategories();
    if (contractToEdit?.kategori_kerjasama && contractToEdit.kategori_kerjasama.length > 0) {
      return saveMultipleCategories(contractToEdit.kategori_kerjasama);
    }
    return loaded;
  });
  const [tanggalMulai, setTanggalMulai] = useState(contractToEdit?.tanggal_mulai || '2026-08-01');
  const [tanggalBerakhir, setTanggalBerakhir] = useState(contractToEdit?.tanggal_berakhir || '2027-07-31');
  const { policy } = useTenantSettings();
  const tenantCurrency = policy.settings.defaultCurrency;
  const [currency, setCurrency] = useState<string>(contractToEdit?.currency || tenantCurrency);
  const [nilaiKontrak, setNilaiKontrak] = useState<number>(contractToEdit?.nilai_kontrak ?? 0);
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
    });
    return () => { isMounted = false; };
  }, [currency, tanggalMulai]);

  const estimatedUsd = currency === 'USD'
    ? Number(nilaiKontrak || 0)
    : Math.round(Number(nilaiKontrak || 0) * historicalRate * 100) / 100;

  const getVendorName = (pId: string) => {
    const p = partners.find((item) => item.partner_id === pId);
    return p ? p.nama_partner : 'Partner';
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

  const [isAutoTitle, setIsAutoTitle] = useState(!contractToEdit?.judul_kontrak);
  const [judulKontrak, setJudulKontrak] = useState(() => {
    if (contractToEdit?.judul_kontrak) return contractToEdit.judul_kontrak;
    const initialPartnerId = contractToEdit?.partner_id || (partners[0]?.partner_id || '');
    const initialJenis = contractToEdit?.jenis_dokumen || 'Master Agreement';
    const initialTags = contractToEdit?.kategori_kerjasama || ['Advertising', 'Content'];
    const initialStartDate = contractToEdit?.tanggal_mulai || '2026-08-01';
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
    tanggal_berakhir: tanggalBerakhir, auto_renewal: autoRenewal }, policy.settings);
  const showEndingFields = lifecycleMode === 'terminated' || lifecyclePreview.status === 'Expired';
  const [noticePeriodHari, setNoticePeriodHari] = useState(contractToEdit?.notice_period_hari || 30);
  const [noticeTypeRequired, setNoticeTypeRequired] = useState<NoticeType>(
    contractToEdit?.notice_type_required || 'Termination'
  );
  const [picInternal, setPicInternal] = useState(() => {
    if (contractToEdit?.pic_internal) return contractToEdit.pic_internal;
    const initialPartnerId = contractToEdit?.partner_id || (partners[0]?.partner_id || '');
    const matchedPartner = partners.find((p) => p.partner_id === initialPartnerId);
    return matchedPartner?.pic_internal || user?.department || 'Commercial & Marketing';
  });
  const [internalNotes, setInternalNotes] = useState(
    contractToEdit?.internal_notes || ''
  );

  const [fieldYangBerubah, setFieldYangBerubah] = useState<string[]>(
    contractToEdit?.field_yang_berubah || ['Nilai Kontrak / IO', 'Jangka Waktu Periode']
  );
  const [ringkasanPerubahan, setRingkasanPerubahan] = useState<string>(
    contractToEdit?.ringkasan_perubahan || ''
  );

  const handleFieldToggle = (field: string) => {
    if (fieldYangBerubah.includes(field)) {
      setFieldYangBerubah(fieldYangBerubah.filter((f) => f !== field));
    } else {
      setFieldYangBerubah([...fieldYangBerubah, field]);
    }
  };

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
    const isMaster = (c.jenis_dokumen || 'Master Agreement') === 'Master Agreement';
    const notSelf = contractToEdit ? c.contract_id !== contractToEdit.contract_id : true;
    const matchPartner = partnerId ? c.partner_id === partnerId : true;
    return isMaster && notSelf && matchPartner;
  });

  const [fileName, setFileName] = useState(contractToEdit?.fileName || '');
  const [rawFileName, setRawFileName] = useState(contractToEdit?.fileName || '');
  const [fileData, setFileData] = useState<string | null>(null);
  const [rawFileObj, setRawFileObj] = useState<File | null>(null);
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

  const handleAddTag = () => {
    const trimmed = kategoriInput.trim();
    if (trimmed && !kategoriTags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      const updated = saveCategory(trimmed);
      setSavedTemplates(updated);
      setKategoriTags([...kategoriTags, trimmed]);
      setKategoriInput('');
    }
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
        if (parsed.jenis_dokumen) {
          const docType = parsed.jenis_dokumen.toLowerCase().includes('addendum') ? 'Agreement Addendum' : 'Master Agreement';
          setJenisDokumen(docType as any);
        }
        if (parsed.nomor_kontrak) setNomorKontrak(parsed.nomor_kontrak);
        if (parsed.tanggal_mulai) setTanggalMulai(parsed.tanggal_mulai);
        if (parsed.tanggal_berakhir) setTanggalBerakhir(parsed.tanggal_berakhir);
        if (parsed.nilai_kontrak !== undefined && parsed.nilai_kontrak !== null) setNilaiKontrak(Number(parsed.nilai_kontrak) || 0);
        if (parsed.currency && SUPPORTED_CURRENCIES.some((c) => c.code === String(parsed.currency).toUpperCase())) setCurrency(String(parsed.currency).toUpperCase());
        if (parsed.notice_period_hari !== undefined && parsed.notice_period_hari !== null) setNoticePeriodHari(Number(parsed.notice_period_hari) || 30);
        if (parsed.auto_renewal !== undefined) setAutoRenewal(Boolean(parsed.auto_renewal));
        if (parsed.internal_notes) setInternalNotes(String(parsed.internal_notes).trim());
        if (parsed.ringkasan_perubahan) setRingkasanPerubahan(String(parsed.ringkasan_perubahan).trim());
        if (Array.isArray(parsed.field_yang_berubah) && parsed.field_yang_berubah.length > 0) {
          setFieldYangBerubah(parsed.field_yang_berubah);
        }
        
        // Match partner name intelligently
        let matchedPartnerId = '';
        if (parsed.nama_partner) {
          const rawP = parsed.nama_partner.toLowerCase().trim();
          const cleanP = rawP.replace(/^(pt|cv|ltd|co\.|inc)\s+/i, '').replace(/[\.,]/g, '').trim();
          const matchedPartner = partners.find(p => {
            const cleanTarget = p.nama_partner.toLowerCase().replace(/^(pt|cv|ltd|co\.|inc)\s+/i, '').replace(/[\.,]/g, '').trim();
            return p.nama_partner.toLowerCase().includes(rawP) ||
                   rawP.includes(p.nama_partner.toLowerCase()) ||
                   cleanTarget.includes(cleanP) ||
                   cleanP.includes(cleanTarget);
          });
          if (matchedPartner) {
            matchedPartnerId = matchedPartner.partner_id;
            setPartnerId(matchedPartner.partner_id);
          }
        }

        // Match parent contract if Addendum
        if (parsed.nomor_kontrak_induk) {
          const rawInduk = parsed.nomor_kontrak_induk.toLowerCase().trim();
          const matchedMaster = contracts.find(c => 
            c.nomor_kontrak && (
              c.nomor_kontrak.toLowerCase().includes(rawInduk) ||
              rawInduk.includes(c.nomor_kontrak.toLowerCase())
            )
          );
          if (matchedMaster) {
            setParentContractId(matchedMaster.contract_id);
            if (!matchedPartnerId && matchedMaster.partner_id) {
              setPartnerId(matchedMaster.partner_id);
            }
          }
        }

        if (parsed.judul_kontrak) {
          setIsAutoTitle(false);
          setJudulKontrak(parsed.judul_kontrak);
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

  const handleRemoveTag = (tag: string) => {
    setKategoriTags(kategoriTags.filter((t) => t !== tag));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        setError(t('contracts.ukuran_file_maksimal_20mb', 'Ukuran file maksimal 20MB.'));
        return;
      }
      setRawFileObj(file);
      setRawFileName(file.name);
      const selectedPartner = partners.find((p) => p.partner_id === partnerId);
      const autoRenamed = formatContractFileName({
        partnerName: selectedPartner?.nama_partner,
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
      setError(t('form.contract.nomor_kontrak', 'Nomor Kontrak Legal wajib diisi.'));
      return;
    }
    if (!judulKontrak.trim()) {
      setError(t('form.contract.judul_kontrak', 'Judul Perjanjian Kontrak wajib diisi.'));
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
      tanggal_mulai: tanggalMulai, tanggal_berakhir: tanggalBerakhir });
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
          partnerName: selectedPartner?.nama_partner,
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
        jenis_dokumen: jenisDokumen,
        parent_contract_id: jenisDokumen === 'Agreement Addendum' ? parentContractId : undefined,
        parent_contract_nomor:
          jenisDokumen === 'Agreement Addendum' ? selectedMaster?.nomor_kontrak : undefined,
        nomor_kontrak: nomorKontrak.trim(),
        judul_kontrak: judulKontrak.trim(),
        partner_id: partnerId,
        kategori_kerjasama: kategoriTags,
        tanggal_mulai: tanggalMulai,
        tanggal_berakhir: tanggalBerakhir,
        currency,
        nilai_kontrak: Number(nilaiKontrak),
        nilai_kontrak_usd: estimatedUsd,
        auto_renewal: autoRenewal,
        notice_period_hari: Number(noticePeriodHari),
        notice_type_required: noticeTypeRequired,
        status: lifecyclePreview.status,
        lifecycle_mode: lifecycleMode,
        termination_date: lifecycleMode === 'terminated' ? terminationDate : null,
        termination_reason: terminationReason.trim(),
        termination_document_file: terminationFile,
        pic_internal: (contractToEdit?.pic_internal || selectedPartner?.pic_internal || selectedPartner?.internal_pic || user?.department || 'Commercial & Marketing').trim(),
        internal_notes: internalNotes.trim(),
        field_yang_berubah: jenisDokumen === 'Agreement Addendum' ? fieldYangBerubah : undefined,
        ringkasan_perubahan: jenisDokumen === 'Agreement Addendum' ? ringkasanPerubahan.trim() : undefined,
        fileName: finalFileName,
        fileData,
      });

      onClose();
    } catch (err: any) {
      setError(err.message || t('contracts.gagal_menyimpan_data_kontrak_coba_lagi', 'Gagal menyimpan data kontrak. Coba lagi.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-xs animate-in" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 pointer-events-none">
      <Dialog.Content
        onOpenAutoFocus={() => { returnFocusRef.current = document.activeElement as HTMLElement; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus(); }}
        aria-describedby={undefined} onPointerDownOutside={(event) => event.preventDefault()} className="contract-form pointer-events-auto animate-in bg-surface rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-hairline overflow-hidden">
        {/* Header */}
        <div className="ds-section-header">
          <div>
            <Dialog.Title className="ds-modal-title flex items-center gap-2">
              <FileText className="w-5 h-5 text-accent-text" />
              <span>
                {contractToEdit?.contract_id
                  ? (jenisDokumen === 'Agreement Addendum'
                      ? t('form.contract.title_edit_addendum', 'Edit Agreement Addendum')
                      : t('form.contract.title_edit_master', 'Edit Kontrak Induk'))
                  : (jenisDokumen === 'Agreement Addendum'
                      ? t('form.contract.title_add_addendum', 'Buat & Upload Agreement Addendum Baru')
                      : t('form.contract.title_add_master', 'Buat & Upload Kontrak Baru'))}
              </span>
            </Dialog.Title>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Tutup')}
            className="min-w-10 min-h-10 flex items-center justify-center text-ink-soft hover:text-ink dark:hover:text-ink p-1.5 rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-sm flex-1 text-ink">
            {/* Document Type Selection & Parent Contract Selector */}
            <div className="ds-panel p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ds-grid">
                <div>
                  <label htmlFor="contract-field-1" className="block font-bold text-ink mb-1.5 text-sm">
                    {t('form.contract.jenis_dokumen', 'Jenis Dokumen Perjanjian *')}
                  </label>
                  <AlphabeticalSelect id="contract-field-1"
                    value={jenisDokumen}
                    onChange={(e) => setJenisDokumen(e.target.value as JenisDokumenContract)}
                    className="ds-input w-full cursor-pointer"
                  >
                    <option value="Master Agreement">
                      {t('form.contract.master_agreement_opt', 'Master Agreement (Kontrak Induk Utama)')}
                    </option>
                    <option value="Agreement Addendum">
                      {t('form.contract.agreement_addendum_opt', 'Agreement Addendum (Perubahan / Adendum)')}
                    </option>
                  </AlphabeticalSelect>
                </div>

                <div>
                  <label htmlFor="contract-field-2" className="block font-bold text-ink mb-1.5 text-sm">
                    {t('form.contract.partner_vendor', 'Partner *')}
                  </label>
                  <AlphabeticalSelect id="contract-field-2"
                    value={partnerId}
                    onChange={(e) => {
                      setPartnerId(e.target.value);
                      setParentContractId('');
                    }}
                    className="ds-input w-full cursor-pointer"
                  >
                    {partners.map((p) => (
                      <option key={p.partner_id} value={p.partner_id}>
                        {p.nama_partner} ({p.jenis_partner})
                      </option>
                    ))}
                  </AlphabeticalSelect>
                </div>
              </div>

              {/* Referensi Master Agreement Field - Active when Agreement Addendum is chosen */}
              {jenisDokumen === 'Agreement Addendum' && (
                <div className="pt-2 border-t border-hairline dark:border-hairline/80 space-y-3">
                  <div>
                    <label htmlFor="contract-field-3" className="block font-bold text-ink mb-1.5 flex items-center gap-1.5 text-sm">
                      <Link2 className="w-4 h-4 text-accent-text" />
                      <span>{t('form.contract.ref_master_agreement', 'Referensi Master Agreement (Kontrak Induk) *')}</span>
                    </label>
                    {availableMasterContracts.length === 0 ? (
                      <div className="p-3 bg-status-warning-soft dark:bg-status-warning-soft/40 border border-status-warning-border rounded-xl text-status-warning text-sm font-semibold">
                        {t('form.contract.no_master_warning', 'Harap pilih partner lain atau buat Master Agreement terlebih dahulu.')}
                      </div>
                    ) : (
                      <AlphabeticalSelect id="contract-field-3"
                        required={jenisDokumen === 'Agreement Addendum'}
                        value={parentContractId}
                        onChange={(e) => setParentContractId(e.target.value)}
                        className="ds-input w-full cursor-pointer"
                      >
                        <option value="">{t('form.contract.select_master_placeholder', '-- Pilih Master Agreement Induk --')}</option>
                        {availableMasterContracts.map((m) => (
                          <option key={m.contract_id} value={m.contract_id}>
                            {m.nomor_kontrak} | {m.judul_kontrak}
                          </option>
                        ))}
                      </AlphabeticalSelect>
                    )}
                  </div>

                  <div className="p-3.5 bg-status-warning-soft/80 dark:bg-status-warning-soft/30 border border-status-warning-border/80 dark:border-status-warning-border/60 rounded-xl space-y-3">
                    <div>
                      <div className="block font-bold text-status-warning mb-1.5 text-sm">
                        {t('form.contract.changed_fields', 'Elemen / Field Yang Berubah *')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          'Nilai Kontrak / IO',
                          'Jangka Waktu Periode',
                          'Ruang Lingkup / Deliverables',
                          'Syarat Pembayaran',
                          'Pihak Berwenang',
                        ].map((f) => {
                          const isSelected = fieldYangBerubah.includes(f);
                          return (
                            <button
                              type="button"
                              key={f}
                              aria-pressed={isSelected}
                              onClick={() => handleFieldToggle(f)}
                              className={`inline-flex items-center px-4 min-h-10 rounded-md text-sm font-semibold border cursor-pointer select-none transition-colors ${
                                isSelected
                                  ? 'bg-accent-soft text-accent-text border-accent/50 font-semibold'
                                  : 'bg-surface text-ink-soft border-hairline hover:bg-surface dark:hover:bg-surface-2'
                              }`}
                            >
                              {isSelected ? '✓ ' : '+ '}
                              {f}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="contract-field-4" className="block font-bold text-status-warning mb-1.5 text-sm">
                        {t('form.contract.track_change_summary', 'Ringkasan Detail Track-Change Perubahan * (Wajib)')}
                      </label>
                      <textarea id="contract-field-4"
                        required
                        rows={3}
                        placeholder={t('form.contract.track_change_placeholder', 'Jelaskan secara eksplisit nilai lama -> nilai baru, tanggal lama -> tanggal baru, atau perubahan pasal...')}
                        value={ringkasanPerubahan}
                        onChange={(e) => setRingkasanPerubahan(e.target.value)}
                        className="ds-input w-full"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ds-grid">
              <div>
                <label htmlFor="contract-field-5" className="block font-bold text-ink mb-1.5 text-sm">
                  {jenisDokumen === 'Agreement Addendum'
                    ? t('form.contract.nomor_addendum', 'Nomor Addendum *')
                    : t('form.contract.nomor_kontrak', 'Nomor Kontrak Legal *')}
                </label>
                <input id="contract-field-5"
                  type="text"
                  required
                  placeholder={
                    jenisDokumen === 'Agreement Addendum'
                      ? t('contracts.contoh_01_add_its_xi_2024', 'contoh: 01/ADD-ITS/XI/2024 atau 01A/ADD-ITS/I/2023')
                      : t('contracts.contoh_01_pks_its_xi_2024', 'contoh: 01/PKS-ITS/XI/2024 atau 52/PKS-ITS/VII/2025')
                  }
                  value={nomorKontrak}
                  onChange={(e) => setNomorKontrak(e.target.value)}
                  className="ds-input w-full"
                />
              </div>

              <div>
                <label htmlFor="contract-field-6" className="block font-bold text-ink mb-1.5 text-sm">
                  {jenisDokumen === 'Agreement Addendum'
                    ? t('form.contract.judul_addendum', 'Judul Perjanjian Addendum *')
                    : t('form.contract.judul_kontrak', 'Judul Perjanjian Kontrak *')}
                </label>
                <input id="contract-field-6"
                  type="text"
                  required
                  placeholder={t('form.contract.judul_ph', 'contoh: PT Telkomsel_Master Agreement_Advertising-Content_2026-08-01')}
                  value={judulKontrak}
                  onChange={(e) => {
                    setJudulKontrak(e.target.value);
                    setIsAutoTitle(false);
                  }}
                  className="ds-input w-full"
                />
              </div>
            </div>

            {/* Kategori Tags */}
            <div>
              <label htmlFor="contract-field-7" className="block font-bold text-ink text-sm mb-1.5">
                {t('form.contract.kategori_tag', 'Kategori Kerjasama Tag *')}
              </label>
              <div className="flex items-center gap-2 mb-2">
                <input id="contract-field-7"
                  type="text"
                  list="contract-category-templates-list"
                  placeholder={t('form.partner.tag_placeholder', 'Tambah tag kategori (mis. Advertising, IT, Logistics)...')}
                  value={kategoriInput}
                  onChange={(e) => setKategoriInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  className="ds-input min-w-0 flex-1"
                />
                <AlphabeticalDatalist id="contract-category-templates-list">
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

              <div className="flex flex-wrap gap-1.5">
                {kategoriTags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-accent-soft text-accent-text border border-accent/30 px-3 py-1 rounded-lg text-sm font-semibold flex items-center gap-1.5"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="inline-flex size-6 items-center justify-center rounded-sm text-accent-text hover:bg-accent-soft font-semibold cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ds-grid">
              <div>
                <label htmlFor="contract-field-8" className="block font-bold text-ink mb-1.5 text-sm">
                  {t('form.contract.tanggal_mulai', 'Tanggal Mulai *')}
                </label>
                <DateInput id="contract-field-8"
                  required
                  focusColor="emerald"
                  value={tanggalMulai}
                  onChange={(val) => setTanggalMulai(val)}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="contract-field-9" className="block font-bold text-ink text-sm">
                    {t('form.contract.tanggal_berakhir', 'Tanggal Berakhir *')}
                  </label>
                  {autoRenewal && (
                    <span className="text-xs bg-status-success-soft text-status-success dark:bg-status-success-soft/50 font-semibold px-2 py-0.5 rounded-md border border-status-success-border">
                      {t('contracts.auto_renewal', 'Auto-Renewal')}
                    </span>
                  )}
                </div>
                <DateInput id="contract-field-9"
                  required
                  focusColor="emerald"
                  value={tanggalBerakhir}
                  onChange={(val) => setTanggalBerakhir(val)}
                />
              </div>

              <div>
                <label htmlFor="contract-field-10" className="block font-bold text-ink mb-1.5 text-sm">
                  {t('form.contract.currency', 'Mata Uang')}
                </label>
                <AlphabeticalSelect id="contract-field-10"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="ds-input w-full"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {currencyLabel(c.code, language)}
                    </option>
                  ))}
                </AlphabeticalSelect>
              </div>

              <div>
                <label htmlFor="contract-field-11" className="block font-bold text-ink mb-1.5 text-sm">
                  {t('form.contract.nilai_kontrak', 'Nilai Kontrak *')}
                </label>
                <input id="contract-field-11"
                  type="number"
                  required
                  value={nilaiKontrak}
                  onChange={(e) => setNilaiKontrak(Number(e.target.value))}
                  className="ds-input w-full"
                />
              </div>
            </div>

            {/* USD Conversion Info Banner */}
            <div className="bg-accent/5 border border-accent/20 rounded-xl p-3 text-sm flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-ink">{t('contracts.estimasi_konversi_usd_kurs', 'Estimasi Konversi USD (Kurs {tanggalMulai}):', { tanggalMulai })}</span>
                <span className="ml-2 font-bold text-accent-text">
                  {formatMoney(estimatedUsd, 'USD')}
                </span>
              </div>
              <span className="text-xs text-ink-soft italic">
                {currency === 'USD' ? t('contracts.sama_mata_uang_usd', 'Sama (Mata uang USD)') : t('contracts.1_usd', '1 {currency} ≈ {value} USD', { currency, value: historicalRate.toFixed(8) })}
              </span>
            </div>

            <div className="ds-panel grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 ds-grid">
              <div>
                <label htmlFor="contract-field-12" className="block font-bold text-ink mb-1.5 text-sm">
                  {t('form.contract.masa_notice', 'Masa Notice (Hari) *')}
                </label>
                <input id="contract-field-12"
                  type="number"
                  required
                  value={noticePeriodHari}
                  onChange={(e) => setNoticePeriodHari(Number(e.target.value))}
                  className="ds-input w-full"
                />
              </div>

              <div>
                <label htmlFor="contract-field-13" className="block font-bold text-ink mb-1.5 text-sm">
                  {t('form.contract.notice_type', 'Notice Type Required *')}
                </label>
                <AlphabeticalSelect id="contract-field-13"
                  value={noticeTypeRequired}
                  onChange={(e) => setNoticeTypeRequired(e.target.value as any)}
                  className="ds-input w-full cursor-pointer"
                >
                  <option value="Termination">{t('contracts.notice_of_termination', 'Notice of Termination')}</option>
                  <option value="Extension">{t('contracts.notice_of_extension', 'Notice of Extension')}</option>
                  <option value="Both">{t('contracts.keduanya_termination_extension', 'Keduanya (Termination & Extension)')}</option>
                  <option value="None">{t('common.none', 'None')}</option>
                </AlphabeticalSelect>
              </div>
              <div className="flex items-center pt-4 sm:pt-6">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoRenewal}
                    disabled={status === 'Terminated'}
                    onChange={(e) => handleAutoRenewalChange(e.target.checked)}
                    className="w-4 h-4 text-accent-text rounded-sm border-hairline focus:ring-accent"
                  />
                  <span className="font-bold text-ink text-sm">
                    {t('form.contract.auto_renewal', 'Auto Renewal')}
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label htmlFor="contract-field-14" className="block font-bold text-ink mb-1.5 text-sm">
                {t('form.contract.status_kontrak', 'Status Kontrak *')}
              </label>
              <AlphabeticalSelect id="contract-field-14"
                value={status === 'Terminated' ? 'Terminated' : 'Active'}
                onChange={(e) => { setStatus(e.target.value as ContractStatus); if (e.target.value === 'Terminated') setAutoRenewal(false); }}
                className="ds-input w-full cursor-pointer"
              >
                <option value="Active">{t('form.contract.status_normal', 'Normal (Sesuai tanggal berlaku)')}</option>
                <option value="Terminated">{t('form.contract.status_terminated', 'Dihentikan (Penghentian Perjanjian)')}</option>
              </AlphabeticalSelect>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={lifecyclePreview.status === 'Expired' ? 'warning' : lifecyclePreview.status === 'Terminated' ? 'danger' : 'info'}>{t(CONTRACT_STATUS_LABEL_KEY[lifecyclePreview.status])}</Badge>
                {lifecyclePreview.scheduled && terminationDate && <p className="text-xs text-ink-soft">{t('termination.scheduled')}</p>}
              </div>
            </div>

            {showEndingFields && <ContractEndingFields terminated={lifecycleMode === 'terminated'} date={terminationDate} endDate={tanggalBerakhir}
              reason={terminationReason} document={contractToEdit?.termination_document} fileName={terminationFile?.fileName} reading={readingTerminationFile}
              onDate={setTerminationDate} onReason={setTerminationReason} onFile={handleTerminationFile} />}

            {/* Internal Notes */}
            <div>
              <label htmlFor="contract-field-15" className="block font-bold text-ink text-sm mb-1.5">
                {t('form.contract.internal_notes', 'Internal Notes')}
              </label>
              <textarea id="contract-field-15"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={5}
                placeholder={t('form.contract.internal_notes_placeholder', 'Rangkuman kontrak...')}
                className="ds-input w-full max-h-[500px] resize-y"
              />
            </div>

            {/* File Upload Area */}
            <div>
              <label htmlFor="contract-field-16" className="block font-bold text-ink mb-1.5 text-sm">
                {t('form.contract.upload_label', 'Dokumen Asli Kontrak (Drive PDF Upload)')}
              </label>
              <div className="ds-upload text-center">
                <Upload className="w-6 h-6 text-accent-text mx-auto mb-1.5" />
                {fileData || fileName ? (
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-ink">
                      {t('contracts.file_terpilih', '📄 File terpilih:')} <span className="font-normal font-mono text-ink dark:text-white">{rawFileName || fileName}</span>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-bold text-ink">
                    {t('form.contract.drag_pdf', 'Pilih atau Drag Dokumen Kontrak ke sini')}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  {fileData && (
                    <button
                      type="button"
                      onClick={handleParseContract}
                      disabled={isParsing}
                      className="flex items-center gap-1.5 px-4 min-h-10 bg-accent-soft text-accent-text hover:bg-accent/20 font-semibold text-sm rounded-md transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isParsing ? t('contracts.parsing', 'Parsing...') : t('contracts.parse_file', 'Parse File')}
                    </button>
                  )}
                  <input id="contract-field-16"
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                    className="w-[220px] max-w-full text-sm text-ink-soft file:mr-2 file:py-1.5 file:px-3.5 file:rounded-md file:border-0 file:text-sm file:font-bold file:bg-accent-soft file:text-accent-text hover:file:bg-accent/20 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {parseSuccessMsg && (
              <div className="p-3 bg-status-success-soft dark:bg-status-success-soft/40 border border-status-success-border text-status-success rounded-xl text-sm font-semibold flex items-center gap-2">
                <span>{parseSuccessMsg}</span>
              </div>
            )}

            {error && (
              <div className="p-3.5 bg-status-danger-soft dark:bg-status-danger-soft/40 border border-status-danger-border text-status-danger rounded-xl text-sm font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="p-4 sm:p-5 bg-surface border-t border-hairline flex flex-wrap items-center justify-between gap-2 shrink-0">
            <span className="text-xs text-ink-soft font-medium">
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
                disabled={submitting || readingTerminationFile || !isFormValid}
                title={!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : ''}
                className="ui-button ui-button-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ds-button ds-button-lg ds-button-default"
              >
                {submitting
                  ? t('form.contract.saving_btn', 'Menyimpan Kontrak...')
                  : t('form.contract.save_btn', 'Simpan Data Kontrak')}
              </button>
            </div>
          </div>
        </form>
      </Dialog.Content>
      </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
