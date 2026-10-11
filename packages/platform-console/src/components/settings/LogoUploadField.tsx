import React, { useState } from 'react';
import { Link2, Trash2, Upload } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';

import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Card } from '@legalio/ui-components/card';
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
}

export const LogoUploadField: React.FC<LogoUploadFieldProps> = ({
  logo,
  name,
  onChange,
  label,
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
    <Field className="gap-g8">
      <div className="flex items-center justify-between gap-g8">
        <FieldLabel>{fieldLabel}</FieldLabel>
        <Button variant="link" size="sm" onClick={() => setIsUrlMode(!isUrlMode)}>
          <Link2 aria-hidden="true" />
          {isUrlMode ? t('admin.logo_mode_upload', 'Unggah File Gambar') : t('admin.logo_mode_url', 'Gunakan URL Gambar')}
        </Button>
      </div>

      <Card size="sm" className="flex-row items-center gap-g13 p-g8">
        <div className="relative shrink-0">
          <Avatar size="lg">
            {logo && <AvatarImage src={logo} alt={name || t('admin.logo', 'Logo')} />}
            <AvatarFallback className="bg-primary text-primary-foreground">{fallbackLetter}</AvatarFallback>
          </Avatar>
          {logo && (
            <Tooltip><TooltipTrigger asChild><Button variant="destructive" size="icon-sm" onClick={handleRemove} className="absolute -end-g8 -top-g8 size-g26 min-w-g26 rounded-full"
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
              <FileUploadDropzone className="min-h-g55 flex-row gap-g5 p-g8">
                <Upload className="size-g13 text-accent-foreground" aria-hidden="true" />
                <Text as="span" size="xs" tone="muted">{t('admin.logo_upload_cta', 'Pilih atau Tarik Logo')}</Text>
              </FileUploadDropzone>
              <FileUploadHiddenInput aria-label={fieldLabel} />
            </FileUpload>
          ) : (
            <div className="flex items-center gap-g5">
              <Input aria-label={fieldLabel} type="url" placeholder="https://example.com/logo.png" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} className="flex-1" />
              <Button variant="outline" onClick={handleApplyUrl}>{t('admin.btn_apply', 'Terapkan')}</Button>
            </div>
          )}
        </div>
      </Card>
    </Field>
  );
};
