import React from 'react';
import { PROVIDER_FIELDS, PROVIDER_HINTS, PROVIDER_KEY_LABELS, PROVIDER_LABELS, STORAGE_PROVIDERS, type StorageProvider } from '@legalio/shared/storageProviders';
import { useLanguage } from '../../context/LanguageContext';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Input } from '@legalio/ui-components/input';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { PasswordInput, PasswordInputControl, PasswordInputIndicator, PasswordInputInput, PasswordInputLabel, PasswordInputVisibilityTrigger } from '@legalio/ui-components/password-input';

export interface StorageValues { provider: StorageProvider; accessKeyId: string; secretAccessKey: string; bucket: string; region: string; prefix: string; accountId: string; endpoint: string }
export const EMPTY_STORAGE: StorageValues = { provider: 'tencent', accessKeyId: '', secretAccessKey: '', bucket: '', region: '', prefix: '', accountId: '', endpoint: '' };

/** Form fields of one file-storage provider, shared by first-run setup and the System Console Storage page. */
export const StorageFields: React.FC<{ idPrefix: string; values: StorageValues; onChange: (patch: Partial<StorageValues>) => void; lockProvider?: boolean }> = ({ idPrefix, values, onChange, lockProvider }) => {
  const { t } = useLanguage();
  const provider = values.provider;
  const shows = PROVIDER_FIELDS[provider];
  const hints = PROVIDER_HINTS[provider];
  const keys = PROVIDER_KEY_LABELS[provider];
  const set = (key: keyof StorageValues) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [key]: e.target.value });
  return (
    <>
      <Field required>
        <FieldLabel htmlFor={`${idPrefix}-provider`}>{t('storage.provider', 'Provider')}</FieldLabel>
        <NativeSelect id={`${idPrefix}-provider`} value={provider} disabled={lockProvider} onChange={(e) => onChange({ provider: e.target.value as StorageProvider })}>
          {STORAGE_PROVIDERS.map((name) => <option key={name} value={name}>{PROVIDER_LABELS[name]}</option>)}
        </NativeSelect>
      </Field>
      <Field required>
        <FieldLabel htmlFor={`${idPrefix}-access`}>{keys.access}</FieldLabel>
        <Input id={`${idPrefix}-access`} required autoComplete="off" spellCheck={false} value={values.accessKeyId} onChange={set('accessKeyId')} />
      </Field>
      <PasswordInput ids={{ input: `${idPrefix}-secret` }} autoComplete="new-password">
        <PasswordInputLabel>{keys.secret}</PasswordInputLabel>
        <PasswordInputControl>
          <PasswordInputInput className="text-sm" required value={values.secretAccessKey} onChange={set('secretAccessKey')} />
          <PasswordInputVisibilityTrigger><PasswordInputIndicator /></PasswordInputVisibilityTrigger>
        </PasswordInputControl>
      </PasswordInput>
      <Field required>
        <FieldLabel htmlFor={`${idPrefix}-bucket`}>Bucket</FieldLabel>
        <Input id={`${idPrefix}-bucket`} required spellCheck={false} placeholder={hints.bucket} value={values.bucket} onChange={set('bucket')} />
      </Field>
      {shows.region && (
        <Field required>
          <FieldLabel htmlFor={`${idPrefix}-region`}>Region</FieldLabel>
          <Input id={`${idPrefix}-region`} required spellCheck={false} placeholder={hints.region} value={values.region} onChange={set('region')} />
        </Field>
      )}
      {shows.accountId && (
        <Field required>
          <FieldLabel htmlFor={`${idPrefix}-account`}>{t('storage.account_id', 'Account ID')}</FieldLabel>
          <Input id={`${idPrefix}-account`} required spellCheck={false} placeholder="0123456789abcdef0123456789abcdef" value={values.accountId} onChange={set('accountId')} />
        </Field>
      )}
      {shows.endpoint && (
        <Field required>
          <FieldLabel htmlFor={`${idPrefix}-endpoint`}>{t('storage.endpoint', 'Endpoint')}</FieldLabel>
          <Input id={`${idPrefix}-endpoint`} required type="url" spellCheck={false} placeholder="https://minio.example.com:9000" value={values.endpoint} onChange={set('endpoint')} />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-prefix`}>{t('cos_setup.prefix', 'Prefix (optional)')}</FieldLabel>
        <Input id={`${idPrefix}-prefix`} spellCheck={false} placeholder="legalio/" value={values.prefix} onChange={set('prefix')} />
      </Field>
    </>
  );
};
