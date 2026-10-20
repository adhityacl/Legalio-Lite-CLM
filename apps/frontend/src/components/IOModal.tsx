import { AlphabeticalSelect } from './ui/alphabetical-select';
import { FormSection } from '@legalio/ui-components/blocks';
import React, { useState, useEffect } from 'react';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { InsertionOrder, Contract, Partner, ChargingType, PRICING_MODELS, RedlineAnalysisData } from '@legalio/types';
import { ArrowLeft, AlertTriangle, XCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { DateInput } from './DateInput';
import { SUPPORTED_CURRENCIES, currencyLabel, formatMoney, fetchHistoricalRate, getDefaultUsdRate } from '@legalio/shared/currencyUtils';
import { formatIOFileName } from '@legalio/shared/fileNaming';

import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Textarea } from '@legalio/ui-components/textarea';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { ContractRedliningPanel } from './ContractRedliningPanel';
import { serviceOrderChecks, type CheckStatus } from '../lib/serviceOrderChecks';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { FileUpload, FileUploadDropzone, FileUploadDropzoneIcon, FileUploadHiddenInput, FileUploadLabel, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Text } from '@legalio/ui-components/text';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { NumberInput, NumberInputControl, NumberInputDecrementTrigger, NumberInputIncrementTrigger, NumberInputInput } from '@legalio/ui-components/number-input';
interface IOModalProps {
  ioToEdit?: InsertionOrder | null;
  contracts: Contract[];
  partners: Partner[];
  /** All service orders, for duplicate-number and parent-contract budget checks. */
  ios: InsertionOrder[];
  onClose: () => void;
  onSave: (ioData: any) => Promise<void>;
  /** An existing SO's review was stored by the server; keep the list in sync. */
  onRedlineSaved?: (ioId: string, analysis: RedlineAnalysisData, analyzedAt: string) => void;
}

const CHECK_ICON: Record<Exclude<CheckStatus, 'ok'>, React.ReactNode> = {
  warn: <AlertTriangle className="mt-g2 size-g13 shrink-0 text-status-warning" aria-hidden />,
  fail: <XCircle className="mt-g2 size-g13 shrink-0 text-status-danger" aria-hidden />,
};

/** English fallback per flagged check. */
const CHECK_TEXT: Record<string, string> = {
  active: 'Parent contract is expired or terminated',
  period: 'SO period falls outside the contract term',
  partner: 'Partner differs from the parent contract',
  currency: 'Currency differs from the parent contract',
  budget: 'Total SO value exceeds the contract value',
  number: 'SO number is already used',
};

export const IOModal: React.FC<IOModalProps> = ({
  ioToEdit,
  contracts,
  partners,
  ios,
  onClose,
  onSave,
  onRedlineSaved,
}) => {
  const { t, language } = useLanguage();

  const [contractId, setContractId] = useState(ioToEdit?.contract_id || '');
  const [nomorIO, setNomorIO] = useState(ioToEdit?.io_number || '');
  const [partnerId, setPartnerId] = useState(ioToEdit?.partner_id || (partners[0]?.partner_id || ''));
  const [kanalMedia, setKanalMedia] = useState(ioToEdit?.media_channel || 'Digital Banner & Social Media');

  // Filter contracts based on selected partner
  const availableContracts = React.useMemo(() => {
    if (!partnerId) return [];
    return contracts.filter((c) => c.partner_id === partnerId);
  }, [contracts, partnerId]);

  const handlePartnerChange = (newPartnerId: string) => {
    setPartnerId(newPartnerId);
    if (contractId) {
      const selectedContract = contracts.find((c) => c.contract_id === contractId);
      if (selectedContract && selectedContract.partner_id !== newPartnerId) {
        setContractId('');
      }
    }
  };

  const handleContractChange = (newContractId: string) => {
    setContractId(newContractId);
    if (newContractId) {
      const selectedContract = contracts.find((c) => c.contract_id === newContractId);
      if (selectedContract && selectedContract.partner_id) {
        setPartnerId(selectedContract.partner_id);
      }
    }
  };
  const [tanggalMulai, setTanggalMulai] = useState(ioToEdit?.start_date || '2026-08-01');
  const [tanggalBerakhir, setTanggalBerakhir] = useState(ioToEdit?.end_date || '2026-11-30');
  const tenantCurrency = useTenantSettings().policy.settings.defaultCurrency;
  const [currency, setCurrency] = useState<string>(ioToEdit?.currency || tenantCurrency);
  const [nilaiIO, setNilaiIO] = useState<number>(ioToEdit?.io_value ?? 0);
  const [historicalRate, setHistoricalRate] = useState<number>(() => getDefaultUsdRate(ioToEdit?.currency || tenantCurrency));

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
    ? Number(nilaiIO || 0)
    : Math.round(Number(nilaiIO || 0) * historicalRate * 100) / 100;

  const getVendorName = (pId: string) => {
    const p = partners.find((item) => item.partner_id === pId);
    return p ? p.partner_name : 'Vendor';
  };

  const generateAutoTitle = (pId: string, kanal: string, tglMulai: string) => {
    const vendorName = getVendorName(pId);
    const kanalStr = kanal.trim() || 'Kanal';
    return `${vendorName}_IO_${kanalStr}_${tglMulai}`;
  };

  const [isAutoTitle, setIsAutoTitle] = useState(!ioToEdit?.io_title);
  const [judulIO, setJudulIO] = useState(() => {
    if (ioToEdit?.io_title) return ioToEdit.io_title;
    const initialPartnerId = ioToEdit?.partner_id || (partners[0]?.partner_id || '');
    const initialKanal = ioToEdit?.media_channel || 'Digital Banner & Social Media';
    const initialStartDate = ioToEdit?.start_date || '2026-08-01';
    return generateAutoTitle(initialPartnerId, initialKanal, initialStartDate);
  });

  useEffect(() => {
    if (isAutoTitle) {
      setJudulIO(generateAutoTitle(partnerId, kanalMedia, tanggalMulai));
    }
  }, [partnerId, kanalMedia, tanggalMulai, isAutoTitle]);

  const STANDARD_PRICING_MODELS: readonly string[] = PRICING_MODELS;
  const initialPricingModel = ioToEdit?.pricing_model || 'CPM';
  const isInitialCustom = Boolean(initialPricingModel && !STANDARD_PRICING_MODELS.includes(initialPricingModel));

  const [pricingModelSelect, setPricingModelSelect] = useState<string>(
    isInitialCustom ? '__CUSTOM__' : initialPricingModel
  );
  const [customPricingModel, setCustomPricingModel] = useState<string>(
    isInitialCustom ? initialPricingModel : ''
  );

  const effectivePricingModel = pricingModelSelect === '__CUSTOM__' ? customPricingModel.trim() : pricingModelSelect;

  const [chargingType, setChargingType] = useState<ChargingType>(ioToEdit?.charging_type || 'Milestone-based');
  const [deliverables, setDeliverables] = useState(
    ioToEdit?.deliverables || 'Guaranteed 5.000.000 Impressions banner 300x250 + 2x Native Advertorial Article'
  );
  const [noticePeriodHari, setNoticePeriodHari] = useState(ioToEdit?.notice_period_days || 14);
  const [unit, setUnit] = useState(ioToEdit?.unit || '');
  const [unitPrice, setUnitPrice] = useState<number | ''>(ioToEdit?.unit_price ?? '');
  const [unitQuantity, setUnitQuantity] = useState<number | ''>(ioToEdit?.unit_quantity ?? '');

  const [fileName, setFileName] = useState(ioToEdit?.fileName || '');
  const [rawFileName, setRawFileName] = useState(ioToEdit?.fileName || '');
  const [fileData, setFileData] = useState<string | null>(null);
  const [rawFileObj, setRawFileObj] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);
  const [redline, setRedline] = useState<{ analysis: RedlineAnalysisData; at?: string } | null>(
    ioToEdit?.redline_analysis ? { analysis: ioToEdit.redline_analysis, at: ioToEdit.redline_analyzed_at } : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const isFormValid = Boolean(
    nomorIO.trim() &&
    judulIO.trim() &&
    partnerId &&
    kanalMedia.trim() &&
    effectivePricingModel &&
    tanggalMulai &&
    tanggalBerakhir &&
    nilaiIO !== undefined && nilaiIO !== null && String(nilaiIO) !== '' &&
    deliverables.trim() &&
    noticePeriodHari !== undefined && noticePeriodHari !== null && String(noticePeriodHari) !== ''
  );

  const handleFileChange = (file: File | undefined) => {
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        setError(t('io.ukuran_file_maksimal_20mb', 'Ukuran file maksimal 20MB.'));
        return;
      }
      setRawFileObj(file);
      setRawFileName(file.name);
      const selectedPartner = partners.find((p) => p.partner_id === partnerId);
      const autoRenamed = formatIOFileName({
        partnerName: selectedPartner?.partner_name,
        mediaChannel: kanalMedia.trim(),
        ioNumber: nomorIO.trim(),
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

  const handleParseIO = async () => {
    if (!fileData && !rawFileObj) {
      setError(t('io.please_upload_a_pdf_file_first', 'Please upload a PDF file first.'));
      return;
    }
    setIsParsing(true);
    setError(null);
    setParseSuccessMsg(null);
    try {
      let response: Response;
      if (rawFileObj) {
        const formData = new FormData();
        formData.append('file', rawFileObj);
        response = await fetch('/api/ios/parse', {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch('/api/ios/parse', {
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
        throw new Error(text && text.trim().startsWith('<') ? t('io.koneksi_ai_server_timeout_atau_sibuk', 'Koneksi AI Server timeout atau sibuk. Silakan coba kembali beberapa saat lagi.') : (text || t('io.gagal_memproses_io', 'Gagal memproses IO')));
      }
      if (!response.ok) {
        throw new Error(result.error || t('io.failed_to_parse_io', 'Failed to parse IO'));
      }
      if (result.success && result.data) {
        const parsed = result.data;
        if (parsed.io_number) setNomorIO(parsed.io_number);
        if (parsed.io_title) setJudulIO(parsed.io_title);
        if (parsed.media_channel) setKanalMedia(parsed.media_channel);
        
        if (parsed.pricing_model) {
          const matched = STANDARD_PRICING_MODELS.find(m => m.toLowerCase() === parsed.pricing_model.toLowerCase());
          if (matched) {
            setPricingModelSelect(matched);
          } else {
            setPricingModelSelect('__CUSTOM__');
            setCustomPricingModel(parsed.pricing_model);
          }
        }
        
        if (parsed.start_date) setTanggalMulai(parsed.start_date);
        if (parsed.end_date) setTanggalBerakhir(parsed.end_date);
        if (parsed.io_value !== undefined && parsed.io_value !== null) setNilaiIO(Number(parsed.io_value) || 0);
        if (parsed.deliverables) setDeliverables(parsed.deliverables);

        // Match partner
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
            setPartnerId(matchedPartner.partner_id);
          }
        }

        // Match contract
        if (parsed.contract_number) {
          const rawCtr = parsed.contract_number.toLowerCase().trim();
          const matchedContract = contracts.find(c =>
            c.contract_number && (
              c.contract_number.toLowerCase().includes(rawCtr) ||
              rawCtr.includes(c.contract_number.toLowerCase())
            )
          );
          if (matchedContract) {
            setContractId(matchedContract.contract_id);
          }
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
      setError(err.message || t('io.error_parsing_document', 'Error parsing document'));
    } finally {
      setIsParsing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!nomorIO.trim()) {
      setError(t('form.io.io_number', 'Nomor IO wajib diisi.'));
      return;
    }
    if (!judulIO.trim()) {
      setError(t('form.io.judul_campaign', 'Judul Insertion Order / Campaign wajib diisi.'));
      return;
    }
    if (!partnerId) {
      setError(t('form.io.partner_media', 'Partner / Media Vendor wajib dipilih.'));
      return;
    }
    if (!kanalMedia.trim()) {
      setError(t('form.io.media_channel', 'Kanal Media / Placement wajib diisi.'));
      return;
    }
    if (!tanggalMulai || !tanggalBerakhir) {
      setError(t('io.tanggal_mulai_dan_tanggal_selesai_wajib', 'Tanggal Mulai dan Tanggal Selesai wajib diisi.'));
      return;
    }
    if (new Date(tanggalBerakhir) <= new Date(tanggalMulai)) {
      setError(t('io.tanggal_berakhir_harus_setelah_tanggal_mulai', 'Tanggal Berakhir harus setelah Tanggal Mulai.'));
      return;
    }
    if (nilaiIO === undefined || nilaiIO === null || isNaN(Number(nilaiIO))) {
      setError(t('form.io.io_value', 'Nilai IO wajib diisi.'));
      return;
    }
    if (!effectivePricingModel) {
      setError(t('form.io.pricing_model', 'Pricing Model wajib diisi.'));
      return;
    }
    if (!deliverables.trim()) {
      setError(t('form.io.deliverables', 'Rincian Deliverables wajib diisi.'));
      return;
    }

    setSubmitting(true);

    try {
      const selectedPartner = partners.find((p) => p.partner_id === partnerId);
      let finalFileName = fileName;
      if (fileName) {
        finalFileName = formatIOFileName({
          partnerName: selectedPartner?.partner_name,
          mediaChannel: kanalMedia.trim(),
          ioNumber: nomorIO.trim(),
          startDate: tanggalMulai,
          rawFileName: fileName,
        });
      }

      await onSave({
        contract_id: contractId || undefined,
        io_number: nomorIO.trim(),
        io_title: judulIO.trim(),
        partner_id: partnerId,
        media_channel: kanalMedia.trim(),
        start_date: tanggalMulai,
        end_date: tanggalBerakhir,
        completion_date: tanggalBerakhir,
        pricing_model: effectivePricingModel,
        charging_type: chargingType,
        currency,
        io_value: Number(nilaiIO),
        io_value_usd: estimatedUsd,
        deliverables: deliverables.trim(),
        unit: unit.trim() || undefined,
        unit_price: unitPrice === '' ? undefined : Number(unitPrice),
        unit_quantity: unitQuantity === '' ? undefined : Number(unitQuantity),
        notice_period_days: Number(noticePeriodHari),
        notice_type_required: 'Termination',
        fileName: finalFileName,
        fileData,
        ...(redline && { redline_analysis: redline.analysis, redline_analyzed_at: redline.at }),
      });

      onClose();
    } catch (err: any) {
      setError(err.message || t('io.gagal_menyimpan_insertion_order_coba_lagi', 'Gagal menyimpan Insertion Order. Coba lagi.'));
    } finally {
      setSubmitting(false);
    }
  };

  const parentContract = contracts.find((c) => c.contract_id === contractId);
  const checks = serviceOrderChecks({ io_id: ioToEdit?.io_id, io_number: nomorIO, partner_id: partnerId, currency, io_value: nilaiIO,
    start_date: tanggalMulai, end_date: tanggalBerakhir }, parentContract, ios);
  const issues = checks.filter((check) => check.status !== 'ok');

  return (
    <form onSubmit={handleSubmit} className="w-full min-w-0 space-y-g21" aria-labelledby="io-form-heading">
      <div className="flex flex-wrap items-center justify-between gap-g13">
        <Heading as="h2" size="md" weight="semibold" id="io-form-heading">
          {ioToEdit?.io_id ? t('form.io.title_edit', 'Edit Insertion Order') : t('so.form.page_title_new', 'Submit a new service order')}
        </Heading>
        <Button variant="link" size="sm" type="button" onClick={onClose} className="no-underline hover:underline"><ArrowLeft className="size-g13" aria-hidden />{t('so.form.back', 'Back to service order list')}</Button>
      </div>

      <div className="grid grid-cols-1 items-start gap-g21 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          <div className="flex min-w-0 flex-col gap-g13 text-foreground">
            <FormSection step={1} title={t('so.form.section_details', 'Service Order Details')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-1">
                  {t('so.form.partner', 'Partner *')}
                </FieldLabel>
                <AlphabeticalSelect id="IOModal-field-1"
                  value={partnerId}
                  onChange={(e) => handlePartnerChange(e.target.value)}
                  className="w-full" controlProps={{ className: "w-full" }}
                >
                  <option value="">{t('io.pilih_partner_vendor', '-- Pilih Partner / Vendor --')}</option>
                  {partners.map((p) => (
                    <option key={p.partner_id} value={p.partner_id}>
                      {p.partner_name}
                    </option>
                  ))}
                </AlphabeticalSelect>
              </Field>

              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-2">
                  {t('so.form.parent', 'Select Parent Contract (Optional)')}
                </FieldLabel>
                <AlphabeticalSelect id="IOModal-field-2"
                  value={contractId}
                  onChange={(e) => handleContractChange(e.target.value)}
                  className="w-full" controlProps={{ className: "w-full" }}
                >
                  <option value="">{t('so.form.parent_ph', 'Choose parent contract')}</option>
                  {availableContracts.map((c) => (
                    <option key={c.contract_id} value={c.contract_id}>
                      {c.contract_number} ({(c.contract_title || '').slice(0, 30)}...)
                    </option>
                  ))}
                </AlphabeticalSelect>
              </Field>
            </div>

            {/* Row 2: Nomor IO & Kanal Media */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-3">
                  {t('so.form.number', 'SO Number *')}
                </FieldLabel>
                <Input id="IOModal-field-3"
                  type="text"
                  required
                  placeholder={t('so.form.number_ph', 'e.g., SO/DETIK/2026/012')}
                  value={nomorIO}
                  onChange={(e) => setNomorIO(e.target.value)}
                  className="w-full"
                />
              </Field>

              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-4">
                  {t('so.form.deliverable', 'Deliverable *')}
                </FieldLabel>
                <Input id="IOModal-field-4"
                  type="text"
                  required
                  placeholder={t('so.form.deliverable_ph', 'e.g., Digital Banner & Social Media')}
                  value={kanalMedia}
                  onChange={(e) => setKanalMedia(e.target.value)}
                  className="w-full"
                />
              </Field>
            </div>

            {/* Row 3: Judul Insertion Order / Campaign */}
            <Field className="min-w-0">
              <FieldLabel htmlFor="IOModal-field-5">
                {t('so.form.title_label', 'Service Order Title *')}
              </FieldLabel>
              <Input id="IOModal-field-5"
                type="text"
                required
                placeholder={t('form.io.judul_ph', 'contoh: PT Telkomsel_IO_Digital Banner & Social Media_2026-08-01')}
                value={judulIO}
                onChange={(e) => {
                  setJudulIO(e.target.value);
                  setIsAutoTitle(false);
                }}
                className="w-full"
              />
            </Field>
            </FormSection>

            <FormSection step={2} title={t('so.form.section_pricing', 'Pricing & Period')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-6">
                  {t('form.io.pricing_model', 'Pricing Model *')}
                </FieldLabel>
                <AlphabeticalSelect id="IOModal-field-6"
                  value={pricingModelSelect}
                  onChange={(e) => setPricingModelSelect(e.target.value)}
                  className="w-full" controlProps={{ className: "w-full" }}
                >
                  {PRICING_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
                  {isInitialCustom && !STANDARD_PRICING_MODELS.includes(initialPricingModel) && (
                    <option value={initialPricingModel}>{initialPricingModel}</option>
                  )}
                  <option value="__CUSTOM__">{t('io.input_pricing_model_baru_custom', '➕ Input Pricing Model Baru / Custom...')}</option>
                </AlphabeticalSelect>

                {pricingModelSelect === '__CUSTOM__' && (
                  <div className="mt-g8">
                    <Input
                      type="text"
                      required
                      placeholder={t('form.io.pricing_model_custom_ph', 'Ketik nama pricing model baru (misal: CPV, Hybrid)...')}
                      value={customPricingModel}
                      onChange={(e) => setCustomPricingModel(e.target.value)}
                      className="w-full"
                    />
                  </div>
                )}
              </Field>

              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-7">
                  {t('so.form.charging', 'Charging Type *')}
                </FieldLabel>
                <AlphabeticalSelect id="IOModal-field-7"
                  value={chargingType}
                  onChange={(e) => setChargingType(e.target.value as ChargingType)}
                  className="w-full" controlProps={{ className: "w-full" }}
                >
                  <option value="Prepaid">{t('io.prepaid_bayar_di_awal', 'Prepaid (Bayar di Awal)')}</option>
                  <option value="Postpaid">{t('io.postpaid_bayar_di_akhir_periode', 'Postpaid (Bayar di Akhir Periode)')}</option>
                  <option value="Milestone-based">{t('io.milestone_based_sesuai_tahapan_target', 'Milestone-based (Sesuai Tahapan Target)')}</option>
                </AlphabeticalSelect>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-8">
                  {t('contract.form.start', 'Start Date *')}
                </FieldLabel>
                <DateInput id="IOModal-field-8"
                  required
                  focusColor="emerald"
                  value={tanggalMulai}
                  onChange={(val) => setTanggalMulai(val)}
                />
              </Field>

              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-9">
                  {t('contract.form.end', 'End Date *')}
                </FieldLabel>
                <DateInput id="IOModal-field-9"
                  required
                  focusColor="emerald"
                  value={tanggalBerakhir}
                  onChange={(val) => setTanggalBerakhir(val)}
                />
              </Field>

              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-10">
                  {t('form.io.currency', 'Mata Uang')}
                </FieldLabel>
                <AlphabeticalSelect id="IOModal-field-10"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full" controlProps={{ className: "w-full" }}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {currencyLabel(c.code, language)}
                    </option>
                  ))}
                </AlphabeticalSelect>
              </Field>

              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-11">
                  {t('so.form.value', 'SO Value *')}
                </FieldLabel>
                <NumberInput className="w-full" ids={{ input: "IOModal-field-11" }} required value={String(nilaiIO ?? '')} onValueChange={details => setNilaiIO(Number(details.value))}><NumberInputControl><NumberInputDecrementTrigger /><NumberInputInput  /><NumberInputIncrementTrigger /></NumberInputControl></NumberInput>
              </Field>
            </div>

            {/* Optional: lets invoices be checked against how many units they should cover. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-g13">
              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-unit">{t('so.form.unit', 'Unit')}</FieldLabel>
                <Input id="IOModal-field-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t('so.form.unit_ph', 'e.g., impressions, clicks, items')} className="w-full" />
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-unit-price">
                  {effectivePricingModel === 'CPM' ? t('so.form.unit_price_cpm', 'Price per 1,000 units') : t('so.form.unit_price', 'Price per unit')}
                </FieldLabel>
                <NumberInput className="w-full" ids={{ input: 'IOModal-field-unit-price' }} min={0} value={String(unitPrice)} onValueChange={(d) => setUnitPrice(d.value === '' ? '' : Number(d.value))}><NumberInputControl><NumberInputDecrementTrigger /><NumberInputInput /><NumberInputIncrementTrigger /></NumberInputControl></NumberInput>
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="IOModal-field-unit-qty">{t('so.form.unit_quantity', 'Agreed quantity')}</FieldLabel>
                <NumberInput className="w-full" ids={{ input: 'IOModal-field-unit-qty' }} min={0} value={String(unitQuantity)} onValueChange={(d) => setUnitQuantity(d.value === '' ? '' : Number(d.value))}><NumberInputControl><NumberInputDecrementTrigger /><NumberInputInput /><NumberInputIncrementTrigger /></NumberInputControl></NumberInput>
              </Field>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-g8 rounded-md border border-border bg-muted px-g13 py-g8" aria-live="polite"
              title={currency === 'USD' ? undefined : t('io.1_usd', '1 {currency} ≈ {value} USD', { currency, value: historicalRate.toFixed(8) })}>
              <Text as="span" size="sm" tone="muted">{t('contract.form.usd_estimate', 'Estimated USD Conversion (Rate on {date})', { date: tanggalMulai })}</Text>
              <Text as="span" size="sm" tone="muted" className="tabular-nums">{formatMoney(estimatedUsd, 'USD')}</Text>
            </div>
            </FormSection>

            <FormSection step={3} title={t('so.form.section_deliverables', 'Deliverables')}>
            <Field className="min-w-0">
              <FieldLabel htmlFor="IOModal-field-12">{t('so.form.deliverables', 'Structured Deliverables Details *')}</FieldLabel>
              <Textarea id="IOModal-field-12"
                required
                rows={3}
                placeholder={t('so.form.deliverables_ph', 'e.g., Guaranteed 5,000,000 banner impressions 300×250 + 2× native advertorial articles')}
                value={deliverables}
                onChange={(e) => setDeliverables(e.target.value)}
              />
            </Field>
            </FormSection>

            <FormSection step={4} title={t('so.form.section_document', 'Service Order Document')}>
            <FileUpload className="w-full" accept=".pdf" maxFiles={1} onFileAccept={details => handleFileChange(details.files[0])}>
              <FileUploadLabel>{t('so.form.upload', 'Upload Document')}</FileUploadLabel>
              <FileUploadDropzone>
                <FileUploadDropzoneIcon />
                <Text size="sm" weight="semibold" className="break-words">{fileData || fileName ? <>{t('form.contract.file_selected', 'File selected:')} <span className="break-all font-normal">{rawFileName || fileName}</span></> : t('contract.form.choose_reference', 'Choose a reference document')}</Text>
                <FileUploadTrigger asChild><Button size="sm">{t('contract.form.choose_file', 'Choose file')}</Button></FileUploadTrigger>
              </FileUploadDropzone>
              <FileUploadHiddenInput />
            </FileUpload>
            {fileData && <Button variant="secondary" onClick={handleParseIO} loading={isParsing} className="self-start">{isParsing ? t('io.parsing', 'Parsing...') : t('io.parse_file', 'Parse File')}</Button>}
            </FormSection>

            {parseSuccessMsg && (
              <Alert status="success" role="status"><AlertIndicator /><AlertContent><AlertDescription>{parseSuccessMsg}</AlertDescription></AlertContent></Alert>
            )}

            {error && (
              <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>
            )}
          </div>

          <ContractRedliningPanel
            title={t('so.review.panel_title', 'AI Service Order Review')}
            endpoint="/api/ios/review-analysis"
            canAnalyze={Boolean(partnerId && nomorIO.trim() && judulIO.trim())}
            analysis={redline?.analysis ?? null}
            onAnalysis={(analysis, at) => {
              setRedline({ analysis, at });
              if (ioToEdit?.io_id) onRedlineSaved?.(ioToEdit.io_id, analysis, at);
            }}
            body={{ io: {
              io_id: ioToEdit?.io_id, contract_id: contractId || undefined, io_number: nomorIO, io_title: judulIO, partner_id: partnerId,
              media_channel: kanalMedia, pricing_model: effectivePricingModel, charging_type: chargingType, currency, io_value: nilaiIO,
              start_date: tanggalMulai, end_date: tanggalBerakhir, deliverables, notice_period_days: noticePeriodHari,
            } }}
          >
            {/* Only problems are shown, so a clean SO looks like the contract panel. */}
            {issues.length > 0 && (
              <ul className="flex flex-col gap-g5">
                {issues.map((check) => (
                  <li key={check.key} className="flex items-start gap-g8">
                    {CHECK_ICON[check.status as 'warn' | 'fail']}
                    <Text size="xs">{t(`so.review.check_${check.key}_bad`, CHECK_TEXT[check.key])}</Text>
                  </li>
                ))}
              </ul>
            )}
          </ContractRedliningPanel>
      </div>

          <Card className="flex-row flex-wrap items-center justify-between gap-g8 px-g21 py-g13">
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
                  ? t('form.io.saving_btn', 'Menyimpan IO...')
                  : t('so.form.save', 'Save Service Order')}
              </Button></TooltipTrigger><TooltipBody>{!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : ''}</TooltipBody></Tooltip>
            </div>
          </Card>
    </form>
  );
};
