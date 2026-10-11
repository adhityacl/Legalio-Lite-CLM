import { UserRole } from '@legalio/types';

/** Tabs grouped under the System Admin dashboard submenu. */
export type ConsoleDashboardTab =
  | 'dashboard'
  | 'users'
  | 'sessions'
  | 'organizations'
  | 'apikeys';

/** Configuration pages exposed directly in the System Admin sidebar. */
export type ConsoleConfigurationSection = 'google' | 'google-drive' | 'google-credentials' | 'ai' | 'smtp' | 'ui-texts' | 'database' | 'reset';

/** System Admin console sections (platform-only, PRD §6.6). */
export type ConsoleSubmenu = ConsoleDashboardTab | ConsoleConfigurationSection | 'accounts';

export interface ConsoleUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
  role: string;
  department?: string;
  banned: boolean;
  banReason?: string;
  banExpires?: string;
  createdAt: string;
  updatedAt?: string;
  sessionCount?: number;
  primaryProvider?: string;
  organizationId?: string;
  organizationName?: string;
}

export interface ConsoleAccount {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  createdAt: string;
  updatedAt?: string;
  hasPassword: boolean;
  userName?: string;
  userEmail?: string;
  userRole?: string;
}

export interface ConsoleSession {
  id: string;
  token: string;
  tokenPreview: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  updatedAt?: string;
  expiresAt: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  userRole?: string;
  isExpired?: boolean;
  activeOrganizationId?: string;
}

export interface ConsoleOrganization {
  id: string;
  version?: number;
  name: string;
  slug: string;
  logo?: string;
  createdAt: string;
  metadata?: {
    currency?: string;
    brandName?: string;
    legalEntity?: string;
    tagline?: string;
    driveFolderId?: string;
    [key: string]: any;
  };
  memberCount?: number;
  teamCount?: number;
}

export interface ConsoleTeamMember {
  membershipId: string;
  userId: string;
  joinedAt: string;
  name: string;
  email: string;
  role: string;
}

export interface ConsoleTeam {
  id: string;
  name: string;
  organizationId: string;
  organizationName?: string;
  memberCount: number;
  createdAt: string;
  updatedAt?: string;
  members: ConsoleTeamMember[];
}

export interface ConsoleInvitation {
  id: string;
  organizationId: string;
  organizationName?: string;
  email: string;
  role: string;
  teamId?: string;
  teamName?: string;
  status: 'pending' | 'accepted' | 'canceled' | 'expired';
  expiresAt: string;
  createdAt: string;
  inviterId?: string;
  inviterName?: string;
}

export interface ConsoleApiKey {
  id: string;
  name: string;
  keyPreview: string;
  rawSecret?: string;
  scopes: string[];
  status: 'active' | 'revoked';
  createdAt: string;
  expiresAt?: string;
}

export interface ConsoleMetrics {
  totalUsers: number;
  activeUsers: number;
  bannedUsers: number;
  verifiedUsers: number;
  activeSessions: number;
  totalAccounts: number;
  credentialAccounts: number;
  googleAccounts: number;
  totalOrgs: number;
  totalTeams: number;
  pendingInvitations: number;
  totalApiKeys: number;
}
