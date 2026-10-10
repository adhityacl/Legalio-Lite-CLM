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
import { DialogHeader, DialogTitle, DialogCloseIcon } from '@legalio/ui-components/dialog';
import { Field, FieldLabel } from '@legalio/ui-components/field';
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

  const handleFieldToggle = (field: string) => {
    if (selectedFields.includes(field)) {
      setSelectedFields(selectedFields.filter((f) => f !== field));
    } else {
      setSelectedFields([...selectedFields, field]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
    <ModalFrame onClose={onClose} className="max-w-4xl w-full max-h-[92dvh] flex flex-col overflow-hidden">

        {/* Header */}
        <DialogHeader className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <GitCommit className="w-5 h-5 text-accent-foreground" />
              <span>{t('amendments.tambah_addendum_amendment_baru', 'Tambah Addendum / Amendment Baru')}</span>
            </DialogTitle>
          </div>
          <DialogCloseIcon aria-label={t('common.close', 'Tutup')} />
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1 text-foreground">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-foreground mb-1.5 text-xs">{t('amendments.tipe_induk_perjanjian', 'Tipe Induk Perjanjian *')}</label>
                <AlphabeticalSelect
                  value={parentType}
                  onChange={(e) => {
                    const val = e.target.value as 'Contract' | 'IO';
                    setParentType(val);
                    setParentId(val === 'Contract' ? contracts[0]?.contract_id || '' : ios[0]?.io_id || '');
                  }}
                  className="w-full cursor-pointer"
                >
                  <option value="Contract">{t('amendments.kontrak_utama_master_contract', 'Kontrak Utama (Master Contract)')}</option>
                  <option value="IO">{t('import.type_io', 'Insertion Order (IO)')}</option>
                </AlphabeticalSelect>
              </div>

              <div>
                <label className="block font-bold text-foreground mb-1.5 text-xs">{t('amendments.pilih_perjanjian_induk', 'Pilih Perjanjian Induk *')}</label>
                <AlphabeticalSelect
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full cursor-pointer"
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
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div>
              <label className="block font-bold text-foreground mb-1.5 text-xs">{t('form.contract.changed_fields', 'Elemen / Field Yang Berubah *')}</label>
              <div className="flex flex-wrap gap-1.5">
                {['Nilai Kontrak / IO', 'Jangka Waktu Periode', 'Ruang Lingkup / Deliverables', 'Syarat Pembayaran', 'Pihak Berwenang'].map(
                  (f) => (
                    <label
                      key={f}
                      onClick={() => handleFieldToggle(f)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer select-none transition-all ${
 selectedFields.includes(f)
 ? 'bg-primary text-accent-foreground border-primary/40 font-bold'
 : 'bg-background text-muted-foreground border-border hover:border-border '
 }`}
                    >
                      {selectedFields.includes(f) ? '✓ ' : '+ '}
                      {f}
                    </label>
                  )
                )}
              </div>
            </div>

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

            <div>
              <label className="block font-bold text-foreground mb-1.5 text-xs">{t('amendments.file_dokumen_addendum_pdf_drive_upload', 'File Dokumen Addendum PDF (Drive Upload)')}</label>
              <div className="ds-upload text-center">
                <Upload className="w-6 h-6 text-accent-foreground mx-auto mb-1.5" />
                <p className="text-xs font-bold text-foreground">
                  {fileName ? t('amendments.file_terpilih', 'File terpilih: {fileName}', { fileName }) : t('amendments.pilih_file_pdf_addendum', 'Pilih File PDF Addendum')}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-3">
                  {fileData && (
                    <Button variant="ghost" size="sm"
                      type="button"
                      onClick={handleParseAmendment}
                      disabled={isParsing}
                    >
                      {isParsing ? t('amendments.parsing', 'Parsing...') : t('amendments.parse_file', 'Parse File')}
                    </Button>
                  )}
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileChange}
                    className="w-[220px] text-xs text-muted-foreground file:mr-2 file:py-1.5 file:px-3.5 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-primary file:text-accent-foreground hover:file:bg-primary/20 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {parseSuccessMsg && (
              <div className="p-3 bg-status-success-soft border border-status-success-border text-status-success rounded-xl text-xs font-semibold flex items-center gap-2">
                <span>{parseSuccessMsg}</span>
              </div>
            )}

            {error && (
              <div className="p-3.5 bg-status-danger-soft border border-status-danger-border text-status-danger rounded-xl text-xs font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="p-4 sm:p-5 bg-card border-t border-border flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs text-muted-foreground font-medium hidden sm:inline">
              {t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan')}
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="ghost"
                type="button"
                onClick={onClose}
              >
                {t('eval.btn_cancel', 'Batal')}
              </Button>
              <Button
                type="submit"
                disabled={submitting || !isFormValid}
                title={!isFormValid ? t('form.common.required_hint', 'Lengkapi semua kolom wajib (*) untuk menyimpan') : ''}
              >
                {submitting ? t('eval.btn_saving', 'Menyimpan...') : t('amendments.simpan_track_change_addendum', 'Simpan Track-Change Addendum')}
              </Button>
            </div>
          </div>
        </form>

    </ModalFrame>
  );
};
