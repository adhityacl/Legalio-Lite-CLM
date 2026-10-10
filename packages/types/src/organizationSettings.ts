import type { TenantSettings } from './policy';

export interface OrganizationProfile {
  legalEntity: string;
  brandName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
}

export interface OrganizationNotifications {
  notificationEmails: string[];
  legalNotificationEmail: string | null;
  financeNotificationEmail: string | null;
}

export interface OrganizationSettingsPayload {
  profile: OrganizationProfile;
  policy: TenantSettings;
  notifications: OrganizationNotifications;
}

/** GET/PATCH /api/organizations/:id/settings; shared by producer and consumers. */
export interface OrganizationSettingsDto extends OrganizationSettingsPayload {
  organizationId: string;
  name: string;
  slug: string;
  version: number;
}
