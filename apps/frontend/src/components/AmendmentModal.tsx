import { ModalFrame } from './ui/modal-frame';
import { AlphabeticalSelect } from './ui/alphabetical-select';
import { useLanguage } from '../context/LanguageContext';
import React, { useState } from 'react';
import { Contract, InsertionOrder } from '@legalio/types';
import { GitCommit, Upload, X } from 'lucide-react';
import { DateInput } from './DateInput';
import { formatContractFileName, formatIOFileName } from '@legalio/shared/fileNaming';

import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Textarea } from '@legalio/ui-components/textarea';
import { DialogBody, DialogCloseIcon, DialogFooter, DialogHeader, DialogTitle } from '@legalio/ui-components/dialog';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { FileUpload, FileUploadDropzone, FileUploadDropzoneIcon, FileUploadHiddenInput, FileUploadLabel, FileUploadTrigger } from '@legalio/ui-components/file-upload';
import { Text } from '@legalio/ui-components/text';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { Fieldset, FieldsetLegend } from '@legalio/ui-components/fieldset';
import { ToggleGroup, ToggleGroupItem } from '@legalio/ui-components/toggle-group';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
interface AmendmentModalProps {
  initialParent?: Contract | InsertionOrder;
  contracts: Contract[];
  ios: InsertionOrder[];
  onClose: () => void;
  onSave: (amendmentData: any) => Promise<void>;
}

export const AmendmentModal: React.FC<AmendmentModalProps> = ({
  initialParent,
  contracts,
  ios,
  onClose,
  onSave,
}) => {
  const { t } = useLanguage();
  const isInitialIO = initialParent && 'io_id' in initialParent;
  const [parentType, setParentType] = useState<'Contract' | 'IO'>(isInitialIO ? 'IO' : 'Contract');
  const [parentId, setParentId] = useState<string>(
    initialParent
      ? 'contract_id' in initialParent
        ? initialParent.contract_id
        : initialParent.io_id
      : contracts[0]?.contract_id || ''
  );

  const [nomorAddendum, setNomorAddendum] = useState(`ADD/01/${Date.now().toString().slice(-6)}`);
  const [tanggalAddendum, setTanggalAddendum] = useState(new Date().toISOString().split('T')[0]);
  const [selectedFields, setSelectedFields] = useState<string[]>(['Nilai Kontrak', 'Jangka Waktu']);
  const [ringkasanPerubahan, setRingkasanPerubahan] = useState('');

  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleParseAmendment = async () => {
    if (!fileData) {
      setError(t('amendments.please_upload_a_pdf_file_first', 'Please upload a PDF file first.'));
      return;
    }
    setIsParsing(true);
    setError(null);
    setParseSuccessMsg(null);
    try {
      const response = await fetch('/api/contracts/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: fileData })
      });
      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        throw new Error(text && text.trim().startsWith('<') ? t('amendments.koneksi_ai_server_timeout_atau_sibuk', 'Koneksi AI Server timeout atau sibuk. Silakan coba kembali beberapa saat lagi.') : (text || t('amendments.gagal_memproses_dokumen', 'Gagal memproses dokumen')));
      }
      if (!response.ok) {
        throw new Error(result.error || t('amendments.failed_to_parse_document', 'Failed to parse document'));
      }
      if (result.success && result.data) {
        const parsed = result.data;
        if (parsed.nomor_kontrak) setNomorAddendum(parsed.nomor_kontrak);
        if (parsed.tanggal_mulai) setTanggalAddendum(parsed.tanggal_mulai);
        if (parsed.ringkasan_perubahan) setRingkasanPerubahan(parsed.ringkasan_perubahan);
        if (Array.isArray(parsed.field_yang_berubah) && parsed.field_yang_berubah.length > 0) {
          setSelectedFields(parsed.field_yang_berubah);
        }

        // Match parent contract if available
        if (parsed.nomor_kontrak_induk) {
          const rawInduk = parsed.nomor_kontrak_induk.toLowerCase().trim();
          const matchedContract = contracts.find(c =>
            c.nomor_kontrak && (
              c.nomor_kontrak.toLowerCase().includes(rawInduk) ||
              rawInduk.includes(c.nomor_kontrak.toLowerCase())
            )
          );
          if (matchedContract) {
            setParentType('Contract');
            setParentId(matchedContract.contract_id);
          }
        }

        if (result.performance) {
          setParseSuccessMsg(`⚡ Auto-fill berhasil diekstrak dalam ${(result.performance.durationMs / 1000).toFixed(1)}s!`);
          setTimeout(() => setParseSuccessMsg(null), 6000);
        }
      }
    } catch (err: any) {
      setError(err.message || t('amendments.gagal_memproses_dokumen_2', 'Gagal memproses dokumen.'));
    } finally {
      setIsParsing(false);
    }
  };

  const isFormValid = Boolean(
    parentId &&
    nomorAddendum.trim() &&
    tanggalAddendum &&
    selectedFields.length > 0 &&
    ringkasanPerubahan.trim()
  );

  const handleFileChange = (file: File | undefined) => {
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFileData(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!parentId) {
      setError(t('amendments.pilih_perjanjian_induk_terlebih_dahulu', 'Pilih Perjanjian Induk terlebih dahulu.'));
      return;
    }
    if (!nomorAddendum.trim()) {
      setError(t('amendments.nomor_addendum_wajib_diisi', 'Nomor Addendum wajib diisi.'));
      return;
    }
    if (!tanggalAddendum) {
      setError(t('amendments.tanggal_addendum_wajib_diisi', 'Tanggal Addendum wajib diisi.'));
      return;
    }
    if (selectedFields.length === 0) {
      setError(t('amendments.pilih_minimal_1_elemen_field_yang', 'Pilih minimal 1 elemen / field yang berubah.'));
      return;
    }
    if (!ringkasanPerubahan.trim()) {
      setError(t('amendments.ringkasan_detail_track_change_perubahan_wajib', 'Ringkasan detail track-change perubahan wajib diisi dengan jelas.'));
      return;
    }

    setSubmitting(true);

    let finalFileName = fileName;
    if (fileName) {
      if (parentType === 'Contract') {
        const parentContract = contracts.find((c) => c.contract_id === parentId);
        finalFileName = formatContractFileName({
          partnerName: parentContract?.partner_nama,
          documentType: 'Agreement Addendum',
          contractNumber: nomorAddendum.trim(),
          startDate: tanggalAddendum,
          rawFileName: fileName,
        });
      } else {
        const parentIO = ios.find((i) => i.io_id === parentId);
        finalFileName = formatIOFileName({
          partnerName: parentIO?.partner_nama,
          mediaChannel: parentIO?.kanal_media || 'Addendum',
          ioNumber: nomorAddendum.trim(),
          startDate: tanggalAddendum,
          rawFileName: fileName,
        });
      }
    }

    await onSave({
      parent_type: parentType,
      parent_id: parentId,
      nomor_addendum: nomorAddendum.trim(),
      tanggal_addendum: tanggalAddendum,
      field_yang_berubah: selectedFields,
      ringkasan_perubahan: ringkasanPerubahan.trim(),
      fileName: finalFileName,
      fileData,
    });

    setSubmitting(false);
    onClose();
  };

  return (
    <ModalFrame size="form" onClose={onClose} className="flex flex-col overflow-hidden">

        {/* Header */}
        <DialogHeader className="flex items-center justify-between gap-g13 border-b border-border px-g21 py-g13">
          <div>
            <DialogTitle className="flex items-center gap-g8">
              <GitCommit className="w-g21 h-g21 text-accent-foreground" />
              <span>{t('amendments.tambah_addendum_amendment_baru', 'Tambah Addendum / Amendment Baru')}</span>
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('common.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <DialogBody className="mt-0 flex flex-1 flex-col gap-g13 overflow-y-auto px-g21 py-g21 text-foreground">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
              <Field>
                <FieldLabel>{t('amendments.tipe_induk_perjanjian', 'Tipe Induk Perjanjian *')}</FieldLabel>
                <AlphabeticalSelect
                  value={parentType}
                  onChange={(e) => {
                    const val = e.target.value as 'Contract' | 'IO';
                    setParentType(val);
                    setParentId(val === 'Contract' ? contracts[0]?.contract_id || '' : ios[0]?.io_id || '');
                  }}
                  className="w-full" controlProps={{ className: "w-full" }}
                >
                  <option value="Contract">{t('amendments.kontrak_utama_master_contract', 'Kontrak Utama (Master Contract)')}</option>
                  <option value="IO">{t('import.type_io', 'Insertion Order (IO)')}</option>
                </AlphabeticalSelect>
              </Field>

              <Field>
                <FieldLabel>{t('amendments.pilih_perjanjian_induk', 'Pilih Perjanjian Induk *')}</FieldLabel>
                <AlphabeticalSelect
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full" controlProps={{ className: "w-full" }}
                >
                  {parentType === 'Contract'
                    ? contracts.map((c) => (
                        <option key={c.contract_id} value={c.contract_id}>
                          {c.nomor_kontrak} ({c.partner_nama})
                        </option>
                      ))
                    : ios.map((i) => (
                        <option key={i.io_id} value={i.io_id}>
                          {i.nomor_io} ({i.partner_nama})
                        </option>
                      ))}
                </AlphabeticalSelect>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
              <Field>
                <FieldLabel>{t('form.contract.nomor_addendum', 'Nomor Addendum *')}</FieldLabel>
                <Input
                  type="text"
                  required
                  value={nomorAddendum}
                  onChange={(e) => setNomorAddendum(e.target.value)}
                  className="w-full"
                />
              </Field>

              <Field>
                <FieldLabel>{t('amendments.tanggal_addendum', 'Tanggal Addendum *')}</FieldLabel>
                <DateInput
                  required
                  value={tanggalAddendum}
                  onChange={(val) => setTanggalAddendum(val)}
                />
              </Field>
            </div>

            <Fieldset>
              <FieldsetLegend>{t('form.contract.changed_fields', 'Elemen / Field Yang Berubah *')}</FieldsetLegend>
              <ToggleGroup multiple value={selectedFields} onValueChange={details => setSelectedFields(details.value)} aria-label={t('form.contract.changed_fields', 'Elemen / Field Yang Berubah *')} className="flex-wrap">
                {['Nilai Kontrak / IO', 'Jangka Waktu Periode', 'Ruang Lingkup / Deliverables', 'Syarat Pembayaran', 'Pihak Berwenang'].map((f) => (
                  <ToggleGroupItem key={f} value={f}>{f}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Fieldset>

            <Field>
              <FieldLabel>
                {t('form.contract.track_change_summary', 'Ringkasan Detail Track-Change Perubahan * (Wajib)')}
              </FieldLabel>
              <Textarea
                required
                rows={4}
                placeholder={t('form.amendment.notes_ph', 'Jelaskan secara eksplisit nilai lama -> nilai baru, tanggal lama -> tanggal baru, atau perubahan pasal...')}
                value={ringkasanPerubahan}
                onChange={(e) => setRingkasanPerubahan(e.target.value)}
                className="w-full"
              />
            </Field>

            <FileUpload accept=".pdf" maxFiles={1} onFileAccept={details => handleFileChange(details.files[0])}>
              <FileUploadLabel>{t('amendments.file_dokumen_addendum_pdf_drive_upload', 'File Dokumen Addendum PDF (Drive Upload)')}</FileUploadLabel>
              <FileUploadDropzone>
                <FileUploadDropzoneIcon />
                <Text size="sm" weight="semibold">{fileName ? t('amendments.file_terpilih', 'File terpilih: {fileName}', { fileName }) : t('amendments.pilih_file_pdf_addendum', 'Pilih File PDF Addendum')}</Text>
                <FileUploadTrigger asChild><Button variant="outline" size="sm">{t('form.contract.choose_file', 'Pilih File')}</Button></FileUploadTrigger>
              </FileUploadDropzone>
              <FileUploadHiddenInput />
            </FileUpload>
            {fileData && <Button variant="secondary" onClick={handleParseAmendment} loading={isParsing} className="self-start">{isParsing ? t('amendments.parsing', 'Parsing...') : t('amendments.parse_file', 'Parse File')}</Button>}

            {parseSuccessMsg && (
              <Alert status="success" role="status"><AlertIndicator /><AlertContent><AlertDescription>{parseSuccessMsg}</AlertDescription></AlertContent></Alert>
            )}

            {error && (
              <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>
            )}
          </DialogBody>

          <DialogFooter className="mt-0 flex-wrap items-center justify-between border-t border-border px-g21 py-g13">
            <Text size="xs" tone="muted" className="hidden sm:block">{t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}</Text>
            <div className="flex items-center gap-g8 ml-auto">
              <Button variant="outline" onClick={onClose}>
                {t('eval.btn_cancel', 'Batal')}
              </Button>
              <Tooltip disabled={!(!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : '')}><TooltipTrigger asChild><Button
                type="submit"
                disabled={submitting || !isFormValid}
              >
                {submitting ? t('eval.btn_saving', 'Menyimpan...') : t('amendments.simpan_track_change_addendum', 'Simpan Track-Change Addendum')}
              </Button></TooltipTrigger><TooltipBody>{!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : ''}</TooltipBody></Tooltip>
            </div>
          </DialogFooter>
        </form>

    </ModalFrame>
  );
};
