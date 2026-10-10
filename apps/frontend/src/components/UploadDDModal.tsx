import { ModalFrame, ModalTitle } from './ui/modal-frame';
import React, { useState, useRef } from 'react';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { Upload, FileText, X, AlertCircle, Calendar, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTenantSettings } from '../context/TenantSettingsContext';
import { localizeDueDiligenceDocument } from '@legalio/shared/dueDiligence';
import { useConfirm } from '../context/ConfirmDialogContext';
import { Partner, DDDokumenItem, DDFileItem } from '@legalio/types';
import { formatDueDiligenceFileName } from '@legalio/shared/fileNaming';
import { DateInput } from './DateInput';

interface UploadDDModalProps {
  partner: Partner;
  docName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedPartner: Partner) => void;
  getAuthHeaders: () => Record<string, string>;
  userEmail?: string;
  userName?: string;
  userRole?: string;
}

export const UploadDDModal: React.FC<UploadDDModalProps> = ({
  partner,
  docName,
  isOpen,
  onClose,
  onSuccess,
  getAuthHeaders,
  userEmail,
  userName,
  userRole,
}) => {
  const { t, language } = useLanguage();
  const { policy } = useTenantSettings();
  const confirmDialog = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingDoc: DDDokumenItem | undefined = (partner.daftar_dokumen_dd || []).find((d) => d.nama === docName);
  const displayName = localizeDueDiligenceDocument(existingDoc || { nama: docName }, policy.dueDiligenceChecklist, language);

  // Normalize existing files
  const existingFiles: DDFileItem[] = existingDoc?.files && existingDoc.files.length > 0
    ? existingDoc.files
    : existingDoc?.linkDrive
    ? [
        {
          id: 'legacy_' + docName,
          fileName: `${docName}.pdf`,
          linkDrive: existingDoc.linkDrive,
          uploadedAt: existingDoc.uploadedAt || new Date().toISOString(),
          year: existingDoc.uploadedAt ? new Date(existingDoc.uploadedAt).getFullYear().toString() : new Date().getFullYear().toString(),
          tanggalKadaluarsa: existingDoc.tanggalKadaluarsa,
        },
      ]
    : [];

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>('');
  const [tanggalKadaluarsa, setTanggalKadaluarsa] = useState<string>(existingDoc?.tanggalKadaluarsa || '');
  const [tahunDokumen, setTahunDokumen] = useState<string>(new Date().getFullYear().toString());
  const [isUploading, setIsUploading] = useState(false);
  const [isDeletingFileId, setIsDeletingFileId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFile = (file: File) => {
    // 25MB limit
    if (file.size > 25 * 1024 * 1024) {
      setError(t('dd_upload.ukuran_file_melebihi_batas_maksimal_25mb', 'Ukuran file melebihi batas maksimal 25MB.'));
      return;
    }
    setError(null);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setFileBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDeleteExistingFile = async (fileId: string) => {
    const ok = await confirmDialog({ description: t('dd_upload.hapus_file_dokumen_ini', 'Hapus file dokumen ini?'), tone: 'danger', confirmLabel: t('io.action_delete', 'Hapus') });
    if (!ok) return;
    setIsDeletingFileId(fileId);
    setError(null);
    try {
      const res = await fetch(`/api/partners/${partner.partner_id}/dd-file`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          docName,
          fileId,
          userEmail: userEmail || 'user@app',
          userName: userName || 'User',
          userRole: userRole || 'Legal',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t('dd_upload.gagal_menghapus_file', 'Gagal menghapus file.'));
      }
      if (data.partner) {
        onSuccess(data.partner);
      }
    } catch (err: any) {
      setError(err?.message || t('dd_upload.terjadi_kesalahan_saat_menghapus_file', 'Terjadi kesalahan saat menghapus file.'));
    } finally {
      setIsDeletingFileId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !fileBase64) {
      setError(t('dd_upload.silakan_pilih_file_dokumen_terlebih_dahulu', 'Silakan pilih file dokumen terlebih dahulu.'));
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const docDate = tanggalKadaluarsa || (tahunDokumen ? `${tahunDokumen}-01-01` : new Date().toISOString());
      const nextSequence = existingFiles.length + 1;
      const finalFileName = formatDueDiligenceFileName({
        vendorName: partner.nama_partner,
        documentName: docName,
        documentDate: docDate,
        sequence: nextSequence,
        rawFileName: selectedFile.name,
      });

      const payload = {
        docName,
        fileName: finalFileName,
        fileData: fileBase64,
        tanggalKadaluarsa: tanggalKadaluarsa.trim(),
        userEmail: userEmail || 'user@app',
        userName: userName || 'User',
        userRole: userRole || 'Legal',
      };

      const res = await fetch(`/api/partners/${partner.partner_id}/upload-dd`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t('dd_upload.gagal_mengunggah_dokumen_ke_google_drive', 'Gagal mengunggah dokumen ke Google Drive.'));
      }

      if (data.partner) {
        onSuccess(data.partner);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || t('dd_upload.terjadi_kesalahan_saat_mengunggah', 'Terjadi kesalahan saat mengunggah.'));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} className="w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[92dvh]">

        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-hairline flex items-center justify-between bg-surface/50 dark:bg-surface-2/50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-md bg-accent-soft border border-accent/30 flex items-center justify-center shrink-0 text-accent-text">
              <Upload className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <ModalTitle className="ds-modal-title flex items-center gap-2">
                {t('partners.upload_dd_modal_title', 'Upload Dokumen Due Diligence')}
              </ModalTitle>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-bold text-accent-text truncate">
                  {displayName}
                </span>
                <span className="text-xs text-ink-soft">•</span>
                <span className="text-xs text-ink-soft truncate font-medium">
                  {partner.nama_partner}
                </span>
              </div>
            </div>
          </div>
          <button aria-label={t('common.close', 'Tutup')}
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="inline-flex items-center justify-center size-8 rounded-md text-ink-soft hover:text-ink-soft dark:hover:text-ink hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* List of previously uploaded annual/versioned files */}
          {existingFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink">
                  {t('dd_upload.file_dokumen_terunggah', 'File Dokumen Terunggah ({existingFiles})', { existingFiles: existingFiles.length })}
                </span>
                <span className="text-xs text-ink-soft">{t('dd_upload.mendukung_multi_file_tahunan', 'Mendukung multi-file tahunan')}</span>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {existingFiles.map((f, idx) => (
                  <div
                    key={f.id || idx}
                    className="ds-panel p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-accent-text shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink truncate">
                          {f.fileName || `${docName}.pdf`}
                        </p>
                        <p className="text-xs text-ink-soft">
                          {f.year ? t('dd_upload.tahun', 'Tahun {year} • ', { year: f.year }) : ''}
                          {t('dd_upload.diunggah', 'Diunggah:')} {f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString(getActiveFormattingLocale()) : '-'}
                          {f.tanggalKadaluarsa ? t('dd_upload.exp', ' • Exp: {tanggalKadaluarsa}', { tanggalKadaluarsa: f.tanggalKadaluarsa }) : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {f.linkDrive && (
                        <a
                          href={f.linkDrive}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 bg-status-success-soft hover:bg-status-success-soft text-accent-text rounded-lg text-xs font-medium flex items-center gap-1 border border-status-success-border/30 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>{t('settings.org_open_folder', 'Buka')}</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteExistingFile(f.id)}
                        disabled={isDeletingFileId === f.id}
                        className="p-1 text-ink-soft hover:text-status-danger rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors disabled:opacity-50"
                        title={t('dd_upload.hapus_file', 'Hapus File')}
                      >
                        {isDeletingFileId === f.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-status-danger" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File Picker / Dropzone */}
          <div>
            <label className="block text-xs font-bold text-ink mb-1.5">
              {t('dd_upload.pilih_file_dokumen_dd', 'Pilih File Dokumen DD *')}
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`ds-upload text-center cursor-pointer ${
                isDragOver
                  ? 'bg-status-success-soft/60 '
                  : selectedFile
                  ? 'bg-accent-soft/40 '
                  : ''
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.csv"
                onChange={handleFileChange}
                className="hidden"
              />

              {selectedFile ? (
                <div className="ds-panel flex items-center justify-between gap-3 p-2.5">
                  <div className="flex items-center gap-2.5 min-w-0 text-left">
                    <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent-text flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-ink truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {t('dd_upload.kb', '{value} KB', { value: (selectedFile.size / 1024).toFixed(1) })}
                      </p>
                    </div>
                  </div>
                  <button aria-label={t('common.close', 'Tutup')}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setFileBase64('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="inline-flex items-center justify-center size-8 text-ink-soft hover:text-status-danger rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <Upload className="w-6 h-6 text-accent-text mx-auto mb-1" />
                  <p className="text-xs font-bold text-ink">
                    {t('partners.drag_file', 'Pilih atau drag file dokumen ke sini')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Metadata: Tahun / Periode & Expiry (Nomor Dokumen intentionally removed per request) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ds-grid">
            <div>
              <label className="block text-xs font-bold text-ink mb-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-ink-soft" />
                  {t('dd_upload.tahun_periode', 'Tahun / Periode')}
                </span>
              </label>
              <input
                type="text"
                value={tahunDokumen}
                onChange={(e) => setTahunDokumen(e.target.value)}
                placeholder={t('dd_upload.contoh_2026', 'contoh: 2026')}
                className="ds-input w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-ink mb-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-ink-soft" />
                  {t('partners.expiry_date_label', 'Tanggal Kadaluarsa (Opsional)')}
                </span>
              </label>
              <DateInput
                value={tanggalKadaluarsa}
                onChange={setTanggalKadaluarsa}
                focusColor="emerald"
              />
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 bg-status-danger-soft dark:bg-status-danger-soft/40 border border-status-danger-border text-status-danger rounded-xl text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-hairline shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="ui-button ui-button-lg cursor-pointer disabled:opacity-50 ds-button ds-button-lg ds-button-ghost"
            >
              {t('eval.btn_cancel', 'Batal')}
            </button>
            <button
              type="submit"
              disabled={!selectedFile || isUploading}
              className="ui-button ui-button-lg flex items-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ds-button ds-button-lg ds-button-default"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t('partners.uploading_to_drive', 'Mengunggah ke Drive...')}</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t('partners.upload_to_drive_btn', 'Upload ke Google Drive')}</span>
                </>
              )}
            </button>
          </div>
        </form>

    </ModalFrame>
  );
};
