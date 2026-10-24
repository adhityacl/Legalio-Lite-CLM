import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../lib/permissions';
import { DataExportPanel } from './DataExportPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import { WebhooksPanel } from './WebhooksPanel';
import { SsoPanel } from './SsoPanel';
import { ApprovalSettingsPanel } from './ApprovalSettingsPanel';
import { DigestDefaultsPanel } from './DigestDefaultsPanel';

/**
 * Data & automation (administrators): approval SLA, digest default, API keys, webhooks and data export.
 * Each panel is shown only with its permission and the server rechecks every call.
 */
export const DataApiTab: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const { t } = useLanguage();
  const { hasPermission } = usePermissions();
  return (
    <div className="flex min-w-0 flex-col gap-g21" aria-label={t('tb.data_title', 'Data & API')}>
      {hasPermission('tenant.settings.read') && <ApprovalSettingsPanel organizationId={organizationId} />}
      {hasPermission('tenant.settings.read') && <DigestDefaultsPanel organizationId={organizationId} />}
      {hasPermission('tenant.sso.manage') && <SsoPanel organizationId={organizationId} />}
      {hasPermission('tenant.apikey.manage') && <ApiKeysPanel organizationId={organizationId} />}
      {hasPermission('tenant.webhook.manage') && <WebhooksPanel organizationId={organizationId} />}
      {hasPermission('tenant.data.export') && <DataExportPanel organizationId={organizationId} />}
    </div>
  );
};
