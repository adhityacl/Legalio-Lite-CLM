import React from 'react';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import {
  Users,
  Radio,
  Building2,
  Layers,
  ShieldCheck,
  KeyRound,
  Plus,
  Clock,
  ArrowUpRight,
  ExternalLink,
} from 'lucide-react';
import {
  ConsoleMetrics,
  ConsoleOrganization,
  ConsoleSession,
  ConsoleSubmenu,
  ConsoleUser,
} from './types';
import { useLanguage } from '../../context/LanguageContext';

import { Button } from '@legalio/ui-components/button';
import { Card, CardHeader } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Badge, BadgeDot } from '@legalio/ui-components/badge';
import { Text } from '@legalio/ui-components/text';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
interface AdminDashboardTabProps {
  metrics: ConsoleMetrics | null;
  activeOrg: ConsoleOrganization | null;
  recentUsers: ConsoleUser[];
  recentSessions: ConsoleSession[];
  onNavigateTab: (tab: ConsoleSubmenu) => void;
  onOpenCreateOrg: () => void;
  onOpenCreateTeam: () => void;
  onOpenCreateApiKey: () => void;
  onRevokeSession: (sessionId: string) => void;
}

export const AdminDashboardTab: React.FC<AdminDashboardTabProps> = ({
  metrics,
  activeOrg,
  recentUsers,
  recentSessions,
  onNavigateTab,
  onOpenCreateOrg,
  onOpenCreateTeam,
  onOpenCreateApiKey,
  onRevokeSession,
}) => {
  const { t, language } = useLanguage();
  const activeSessions = recentSessions.filter((session) => new Date(session.expiresAt) >= new Date());

  const statCards = [
    {
      label: t('admin.card_total_users', 'Total Pengguna'),
      value: metrics?.totalUsers ?? 0,
      sub: `${metrics?.activeUsers ?? 0} ${t('admin.status_active', 'aktif')}, ${metrics?.bannedUsers ?? 0} ${t('admin.status_banned', 'dicekal')}`,
      icon: Users,
      tab: 'users' as ConsoleSubmenu,
      accent: 'emerald',
    },
    {
      label: t('admin.card_active_sessions', 'Sesi Aktif'),
      value: metrics?.activeSessions ?? 0,
      sub: t('admin.sub_valid_tokens', 'Token valid realtime'),
      icon: Radio,
      tab: 'sessions' as ConsoleSubmenu,
      accent: 'blue',
      pulse: true,
    },
    {
      label: t('admin.card_enterprise_orgs', 'Organisasi Enterprise'),
      value: metrics?.totalOrgs ?? 0,
      sub: activeOrg ? `${t('admin.active_prefix', 'Aktif:')} ${activeOrg.name}` : t('admin.sub_tenant_isolate', 'Multi-tenant isolate'),
      icon: Building2,
      tab: 'organizations' as ConsoleSubmenu,
      accent: 'purple',
    },
    {
      label: t('admin.card_departments_teams', 'Departemen / Teams'),
      value: metrics?.totalTeams ?? 0,
      sub: 'Legal, Finance, Commercial',
      icon: Layers,
      tab: 'teams' as ConsoleSubmenu,
      accent: 'amber',
    },
    {
      label: t('admin.card_verified_accounts', 'Akun Terverifikasi'),
      value: metrics?.verifiedUsers ?? 0,
      sub: `${metrics?.credentialAccounts ?? 0} Password / ${metrics?.googleAccounts ?? 0} Google`,
      icon: ShieldCheck,
      tab: 'users' as ConsoleSubmenu,
      accent: 'teal',
    },
    {
      label: t('admin.card_active_apikeys', 'API Keys Aktif'),
      value: metrics?.totalApiKeys ?? 0,
      sub: t('admin.sub_machine_integration', 'Integrasi mesin & webhook'),
      icon: KeyRound,
      tab: 'apikeys' as ConsoleSubmenu,
      accent: 'slate',
    },
  ];

  return (
    <div className="space-y-g21">
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-g13">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <Card
              key={idx}
              onClick={() => onNavigateTab(card.tab)}
              className="p-g13 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-g8">
                <Text as="span" size="xs" weight="medium" tone="muted">
                  {card.label}
                </Text>
                <Avatar size="md" className="shrink-0 rounded-md border bg-card text-muted-foreground group-hover:bg-status-success-soft group-hover:text-status-success transition-colors"><AvatarFallback className="bg-transparent text-inherit"><Icon className="w-g16 h-g16" /></AvatarFallback></Avatar>
              </div>
              <div className="flex items-baseline gap-g8">
                <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {card.value}
                </span>
                {card.pulse && (
                  <span className="inline-flex items-center gap-g3 text-xs font-medium text-status-success">
                    <BadgeDot className="size-g5 text-status-success animate-ping" />
                    {t('admin.online_status', 'Online')}
                  </span>
                )}
              </div>
              <div className="mt-g8 flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{card.sub}</span>
                <ArrowUpRight className="w-g13 h-g13 text-muted-foreground group-hover:text-muted-foreground transition-transform group-hover:translate-x-g2 group-hover:-translate-y-g2" />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Two Columns: Recent Users & Recent Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-g21">
        {/* Recent Users Card */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-g13 border-b border-border pb-g13">
            <div className="flex items-center gap-g8">
              <Users className="w-g16 h-g16 text-status-success" />
              <Heading as="h3" size="xs" weight="semibold">
                {t('admin.recent_users_title', 'Pengguna Terbaru')}
              </Heading>
            </div>
            <Button variant="ghost" size="sm"
              type="button"
              onClick={() => onNavigateTab('users')}
            >
              {t('admin.view_all', 'Lihat Semua')}
              <ArrowUpRight className="w-g13 h-g13" />
            </Button>
          </CardHeader>

          <div className="divide-y divide-border">
            {recentUsers.length === 0 ? (
              <div className="p-g21 text-center text-xs text-muted-foreground">
                {t('admin.no_users_found', 'Belum ada pengguna terdaftar.')}
              </div>
            ) : (
              recentUsers.slice(0, 5).map((user) => (
                <div
                  key={user.id}
                  className="p-g13 flex items-center justify-between hover:bg-card transition-colors"
                >
                  <div className="flex items-center gap-g13 min-w-0">
                    <Avatar size="sm" className="bg-muted text-foreground shrink-0"><AvatarFallback className="bg-transparent text-inherit">{user.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
                    <div className="truncate">
                      <div className="font-medium text-xs text-foreground truncate">
                        {user.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-g8">
                    <span
                      className={`text-xs px-g8 py-g2 rounded-full font-medium ${
 user.role === 'superuser'
 ? 'bg-status-danger-soft text-status-danger '
 : user.role === 'admin'
 ? 'bg-status-special-soft text-status-special '
 : user.role === 'manager' || user.role === 'legal'
 ? 'bg-status-info-soft text-status-info '
 : user.role === 'editor' || user.role === 'finance'
 ? 'bg-status-success-soft text-status-success '
 : 'bg-muted text-foreground '
 }`}
                    >
                      {user.role.toUpperCase()}
                    </span>
                    {user.banned ? (
                      <Badge tone="danger">{t('admin.status_banned', 'Dicekal')}</Badge>
                    ) : (
                      <Text as="span" size="xs" tone="muted">
                        {new Date(user.createdAt).toLocaleDateString(getActiveFormattingLocale(), {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </Text>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Recent Active Sessions Card */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-g13 border-b border-border pb-g13">
            <div className="flex items-center gap-g8">
              <Radio className="w-g16 h-g16 text-status-info" />
              <Heading as="h3" size="xs" weight="semibold">
                {t('admin.active_login_sessions_title', 'Sesi Login Aktif')}
              </Heading>
            </div>
            <Button variant="ghost" size="sm"
              type="button"
              onClick={() => onNavigateTab('sessions')}
            >
              {t('admin.view_all', 'Lihat Semua')} ({activeSessions.length})
              <ArrowUpRight className="w-g13 h-g13" />
            </Button>
          </CardHeader>

          <div className="divide-y divide-border">
            {activeSessions.length === 0 ? (
              <div className="p-g21 text-center text-xs text-muted-foreground">
                {t('admin.no_sessions_found', 'Tidak ada sesi login aktif saat ini.')}
              </div>
            ) : (
              activeSessions.slice(0, 5).map((session) => (
                <div
                  key={session.id}
                  className="p-g13 flex items-center justify-between hover:bg-card transition-colors"
                >
                  <div className="min-w-0 pr-g8">
                    <div className="flex items-center gap-g8">
                      <Text as="span" size="xs" weight="medium">
                        {session.userName || t('admin.generic_user', 'Pengguna')}
                      </Text>
                      <Badge tone="neutral" className="font-mono">{session.ipAddress || t('admin.not_available', 'Tidak tersedia')}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-g2 font-mono">
                      {t('admin.token', 'Token:')} {session.token ? `${session.token.slice(0, 10)}...` : (session.id || '').slice(0, 10)}
                    </div>
                  </div>

                  <div className="flex items-center gap-g8 shrink-0">
                    <Text as="span" size="xs" tone="muted" className="hidden sm:inline">
                      {t('admin.expires_prefix', 'Kadaluarsa:')} {new Date(session.expiresAt).toLocaleDateString(getActiveFormattingLocale())}
                    </Text>
                    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm"
                      type="button"
                      onClick={() => onRevokeSession(session.id)}
                      className="text-destructive"
                    >
                      {t('admin.btn_revoke', 'Cabut')}
                    </Button></TooltipTrigger><TooltipBody>{t('admin.btn_revoke_session', 'Cabut sesi login ini')}</TooltipBody></Tooltip>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
