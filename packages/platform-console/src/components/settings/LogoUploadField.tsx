import React, { useState } from 'react';
import { Info, Link2, Trash2, Upload } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';

import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Avatar, AvatarFallback, AvatarImage } from '@legalio/ui-components/avatar';
import { FileUpload, FileUploadDropzone, FileUploadHiddenInput } from '@legalio/ui-components/file-upload';
import { Text } from '@legalio/ui-components/text';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
// Logo upload helper component
interface LogoUploadFieldProps {
  logo: string;
  name: string;
  onChange: (logo: string) => void;
  label?: string;
  /** Hide the field label when a dialog title already names the field. */
  hideLabel?: boolean;
}

export const LogoUploadField: React.FC<LogoUploadFieldProps> = ({
  logo,
  name,
  onChange,
  label,
  hideLabel = false,
}) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const [isUrlMode, setIsUrlMode] = useState(false);
  const [urlInput, setUrlInput] = useState(logo || '');
  // Remounting the upload clears zag's accepted files so the same file can be picked again.
  const [uploadKey, setUploadKey] = useState(0);

  const fallbackLetter = (name.trim() || 'O').charAt(0).toUpperCase();

  const handleFileChange = (file?: File | null) => {
    setUploadKey(key => key + 1);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showAlert({ title: t('admin.logo_raster_type', 'PNG, JPG, WebP. Max 2 MB.'), variant: 'warning' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showAlert({ title: t('admin.err_image_size', 'Ukuran file gambar maksimal 2MB.'), variant: 'warning' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        onChange(result);
        setUrlInput(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileReject = (errors: readonly string[] = []) => {
    setUploadKey(key => key + 1);
    showAlert({
      title: errors.includes('FILE_TOO_LARGE')
        ? t('admin.err_image_size', 'Ukuran file gambar maksimal 2MB.')
        : t('admin.logo_raster_type', 'PNG, JPG, WebP. Max 2 MB.'),
      variant: 'warning',
    });
  };

  const handleRemove = () => {
    setUploadKey(key => key + 1);
    onChange('');
    setUrlInput('');
  };

  const handleApplyUrl = () => {
    onChange(urlInput.trim());
  };

  const fieldLabel = label || t('admin.org_logo_label', 'Logo Organisasi / Workspace');
  return (
    <Field className="gap-g13">
      {!hideLabel && <FieldLabel>{fieldLabel}</FieldLabel>}

      <div className="flex w-full items-center gap-g13 rounded-lg border border-border bg-muted p-g13">
        <div className="relative shrink-0">
          <Avatar size="xl" className="size-g68 rounded-md sm:size-g89">
            {logo && <AvatarImage src={logo} alt={name || t('admin.logo', 'Logo')} className="rounded-md bg-card object-contain" />}
            <AvatarFallback className="rounded-md bg-primary text-primary-foreground">{fallbackLetter}</AvatarFallback>
          </Avatar>
          {logo && (
            <Tooltip><TooltipTrigger asChild><Button variant="destructive" size="icon-sm" onClick={handleRemove} className="absolute -end-g8 -top-g8 rounded-full"
              aria-label={t('admin.btn_remove_logo', 'Hapus Logo')}>
              <Trash2 className="size-g13" aria-hidden="true" />
            </Button></TooltipTrigger><TooltipBody>{t('admin.btn_remove_logo', 'Hapus Logo')}</TooltipBody></Tooltip>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!isUrlMode ? (
            <FileUpload key={uploadKey} accept="image/png,image/jpeg,image/webp" maxFiles={1} maxFileSize={2 * 1024 * 1024}
              onFileAccept={details => handleFileChange(details.files[0])}
              onFileReject={details => handleFileReject(details.files[0]?.errors)}>
              <FileUploadDropzone className="flex min-h-g89 flex-col justify-center gap-g3 border-solid bg-card p-g13">
                <Upload className="size-g16 text-muted-foreground" aria-hidden="true" />
                <Text as="span" size="sm" weight="medium" className="text-foreground">{t('admin.logo_choose_drag', 'Choose or drag a logo')}</Text>
                <Text as="span" size="sm" tone="muted">{t('admin.logo_dropzone_hint', 'PNG, JPG, or WebP up to 2 MB')}</Text>
              </FileUploadDropzone>
              <FileUploadHiddenInput aria-label={fieldLabel} />
            </FileUpload>
          ) : (
            <div className="flex min-h-g89 flex-wrap items-center gap-g5">
              <Input aria-label={fieldLabel} type="url" placeholder="https://example.com/logo.png" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="min-w-0 flex-1 basis-full sm:basis-0" />
              <Button variant="outline" onClick={handleApplyUrl}>{t('admin.btn_apply', 'Terapkan')}</Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-g8">
        <Text as="span" size="sm" tone="muted" className="flex items-center gap-g5">
          <Info className="size-g13 shrink-0" aria-hidden="true" />{t('admin.logo_raster_type', 'PNG, JPG, WebP. Max 2 MB.')}
        </Text>
        <Button variant="outline" size="sm" className="bg-background" aria-pressed={isUrlMode} onClick={() => setIsUrlMode(!isUrlMode)}>
          {isUrlMode ? <Upload aria-hidden="true" /> : <Link2 aria-hidden="true" />}
          {isUrlMode ? t('admin.logo_mode_upload', 'Unggah File Gambar') : t('admin.logo_mode_url', 'Gunakan URL Gambar')}
        </Button>
      </div>
    </Field>
  );
};
