import React, { useState } from 'react';
import { Link2, Trash2, Upload } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';

import { Button } from '@legalio/ui-components/button';
import { Input } from '@legalio/ui-components/input';
import { Card } from '@legalio/ui-components/card';
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
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const fallbackLetter = (name.trim() || 'O').charAt(0).toUpperCase();

  const handleFileChange = (file?: File | null) => {
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleRemove = () => {
    onChange('');
    setUrlInput('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleApplyUrl = () => {
    onChange(urlInput.trim());
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-foreground">
          {label || t('admin.org_logo_label', 'Logo Organisasi / Workspace')}
        </label>
        <Button variant="link" size="sm"
          type="button"
          onClick={() => setIsUrlMode(!isUrlMode)}
        >
          <Link2 className="w-3 h-3" />
          {isUrlMode
            ? t('admin.logo_mode_upload', 'Unggah File Gambar')
            : t('admin.logo_mode_url', 'Gunakan URL Gambar')}
        </Button>
      </div>

      <Card className="flex items-center gap-3.5 p-2">
        {/* Preview Container */}
        <div className="relative shrink-0 group">
          <div className="w-14 h-14 rounded-full border border-border bg-card flex items-center justify-center overflow-hidden shadow-xs">
            {logo ? (
              <img
                src={logo}
                alt={name || t('admin.logo', 'Logo')}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-full h-full bg-linear-to-br from-indigo-500 to-purple-600 text-white font-bold text-lg flex items-center justify-center">
                {fallbackLetter}
              </div>
            )}
          </div>
          {logo && (
            <button
              type="button"
              onClick={handleRemove}
              title={t('admin.btn_remove_logo', 'Hapus Logo')}
              className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-status-danger text-white hover:bg-status-danger shadow-md transition-all cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Input / Dropzone Area */}
        <div className="flex-1 min-w-0">
          {!isUrlMode ? (
            <Card
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={` flex min-h-14 items-center justify-center p-2.5 text-center cursor-pointer transition-colors ${
 isDragging
 ? 'bg-accent'
 : ''
 }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label={label || t('admin.org_logo_label', 'Logo Organisasi / Workspace')}
                onChange={(e) => handleFileChange(e.target.files?.[0])}
                className="hidden"
              />
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground font-medium">
                <Upload className="w-3.5 h-3.5 text-accent-foreground" />
                <span>{t('admin.logo_upload_cta', 'Pilih atau Tarik Logo')}</span>
              </div>
            </Card>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Input aria-label={t('admin.org_logo_label', 'Logo Organisasi / Workspace')}
                  type="url"
                  placeholder="https://example.com/logo.png"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="flex-1"
                />
                <Button variant="ghost"
                  type="button"
                  onClick={handleApplyUrl}
                >
                  {t('admin.btn_apply', 'Terapkan')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
